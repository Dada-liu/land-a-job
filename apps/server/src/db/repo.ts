import { randomUUID } from 'node:crypto'
import { VersionConflictError } from '../errors.js'
import type { Db } from './index.js'
import { columnOf, fieldList, type TableSpec } from './tables.js'

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export type Row = Record<string, unknown>

export const nowIso = (): string => new Date().toISOString()
export const newId = (): string => randomUUID()

interface MappableSpec extends TableSpec {
  readonly fields: string
}

/** 出库：列 → API 字段，顺带解析 JSON 与布尔 */
export function rowToDto(spec: MappableSpec, row: Row): Row {
  const out: Row = {}
  for (const key of fieldList(spec)) {
    // deletedAt 是内部标记：软删的行不会出现在任何响应里，暴露出去只会让调用方误判
    if (key === 'deletedAt') continue
    const raw = row[columnOf(spec, key)]
    if (raw === undefined) continue
    if (spec.json?.includes(key)) {
      out[key] = typeof raw === 'string' && raw.length > 0 ? safeJson(raw) : null
    } else if (spec.bool?.includes(key)) {
      out[key] = raw === 1 || raw === '1' || raw === true
    } else {
      out[key] = raw
    }
  }
  return out
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // 历史脏数据不该让整页 500：返回原文，前端显示为字符串
    return text
  }
}

/** 入库：API 字段 → 列，过滤未知键，序列化 JSON，布尔转 0/1 */
export function dtoToRow(spec: MappableSpec, input: Row): Row {
  const allowed = new Set(fieldList(spec))
  const out: Row = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key) || value === undefined) continue
    const column = columnOf(spec, key)
    if (value === null) {
      out[column] = null
    } else if (spec.json?.includes(key)) {
      out[column] = JSON.stringify(value)
    } else if (spec.bool?.includes(key)) {
      out[column] = value ? 1 : 0
    } else {
      out[column] = value as never
    }
  }
  return out
}

export function hasColumn(spec: MappableSpec, key: string): boolean {
  return fieldList(spec).includes(key)
}

export function getById(db: Db, spec: MappableSpec, id: string): Row | undefined {
  const sql = spec.softDelete
    ? `SELECT * FROM ${spec.table} WHERE id = ? AND deleted_at IS NULL`
    : `SELECT * FROM ${spec.table} WHERE id = ?`
  return db.prepare(sql).get(id) as Row | undefined
}

export function insertRow(db: Db, spec: MappableSpec, input: Row): Row {
  const now = nowIso()
  const values = dtoToRow(spec, input)
  values.id = (input.id as string | undefined) ?? newId()
  values.created_at = now
  if (hasColumn(spec, 'updatedAt')) values.updated_at = now

  const columns = Object.keys(values)
  const sql = `INSERT INTO ${spec.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  db.prepare(sql).run(...(Object.values(values) as never[]))

  const created = getById(db, spec, values.id as string)
  if (!created) throw new Error(`插入后读不到记录：${spec.table}/${String(values.id)}`)
  return created
}

export interface UpdateOptions {
  /** 乐观锁：与库里的 updated_at 不一致则视为并发冲突 */
  expectedUpdatedAt?: string | null
}

export function updateRow(
  db: Db,
  spec: MappableSpec,
  id: string,
  patch: Row,
  options: UpdateOptions = {},
): Row | undefined {
  const current = getById(db, spec, id)
  if (!current) return undefined

  if (options.expectedUpdatedAt && current.updated_at !== options.expectedUpdatedAt) {
    throw new VersionConflictError(spec.table, id)
  }
  const values = dtoToRow(spec, patch)
  delete values.id
  delete values.created_at
  const columns = Object.keys(values)
  if (columns.length === 0) return current

  if (hasColumn(spec, 'updatedAt')) values.updated_at = nowIso()
  const assignments = Object.keys(values)
    .map((c) => `${c} = ?`)
    .join(', ')

  db.prepare(`UPDATE ${spec.table} SET ${assignments} WHERE id = ?`).run(
    ...(Object.values(values) as never[]),
    id,
  )
  return getById(db, spec, id)
}

/** 软删；无 deleted_at 的表抛错，避免调用方误以为删掉了 */
export function softDeleteRow(db: Db, spec: MappableSpec, id: string): boolean {
  if (!spec.softDelete) throw new Error(`${spec.table} 不支持软删`)
  const now = nowIso()
  const result = db
    .prepare(`UPDATE ${spec.table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(now, now, id)
  return result.changes > 0
}

export function hardDeleteRow(db: Db, spec: MappableSpec, id: string): boolean {
  return db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`).run(id).changes > 0
}

/** 游标：updated_at|id，base64url 便于放进 URL */
export function encodeCursor(row: Row): string {
  return Buffer.from(`${String(row.updated_at)}|${String(row.id)}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): { updatedAt: string; id: string } | null {
  try {
    const [updatedAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (!updatedAt || !id) return null
    return { updatedAt, id }
  } catch {
    return null
  }
}

export interface ListArgs {
  limit: number
  cursor?: string
  /** 额外的 AND 条件，不含 WHERE 关键字 */
  where?: string
  params?: unknown[]
  /** 默认按 updated_at DESC, id DESC；面试这类按时间排的传自定义排序 */
  orderBy?: string
  includeDeleted?: boolean
}

/**
 * 列表分页。游标分页而不是 OFFSET：看板会边看边改，
 * OFFSET 翻页会因新增记录而重复/漏行。
 */
export function listPage(db: Db, spec: MappableSpec, args: ListArgs): { rows: Row[]; nextCursor: string | null } {
  const where: string[] = []
  const params: unknown[] = []

  if (spec.softDelete && !args.includeDeleted) where.push('deleted_at IS NULL')
  if (args.where) {
    where.push(`(${args.where})`)
    params.push(...(args.params ?? []))
  }

  const cursor = args.cursor ? decodeCursor(args.cursor) : null
  if (cursor) {
    where.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id)
  }
  // 坏游标（手工改 URL / 旧版本游标）当作第一页返回，而不是 500

  const orderBy = args.orderBy ?? 'updated_at DESC, id DESC'
  const sql = `SELECT * FROM ${spec.table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy} LIMIT ?`
  const rows = db.prepare(sql).all(...(params as never[]), args.limit + 1) as Row[]

  const pageRows = rows.slice(0, args.limit)
  const last = pageRows.at(-1)
  const nextCursor = rows.length > args.limit && last ? encodeCursor(last) : null
  return { rows: pageRows, nextCursor }
}

export function countRows(db: Db, spec: MappableSpec, where?: string, params: unknown[] = []): number {
  const base = [spec.softDelete ? 'deleted_at IS NULL' : null, where].filter(Boolean).join(' AND ')
  const sql = `SELECT count(*) AS n FROM ${spec.table}${base ? ` WHERE ${base}` : ''}`
  const row = db.prepare(sql).get(...(params as never[])) as { n: number } | undefined
  return row?.n ?? 0
}

/** 唯一约束冲突（如公司重名、重复投递）统一识别，路由层转 409 */
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: string }).code ?? ''
  return code.startsWith('SQLITE_CONSTRAINT') && /UNIQUE constraint failed/i.test(error.message)
}

/** 从 'UNIQUE constraint failed: company.name' 里取出 'company.name'，用于给出可读冲突说明 */
export function uniqueTarget(error: unknown): string | null {
  if (!(error instanceof Error)) return null
  const match = /UNIQUE constraint failed: ([^\s)]+)/i.exec(error.message)
  return match?.[1] ?? null
}
