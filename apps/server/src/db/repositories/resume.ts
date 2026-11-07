import type { ResumeDto, ResumePatch } from '@land/core'
import { ConflictError, NotFoundError } from '../../errors.js'
import type { Db } from '../index.js'
import {
  countRows,
  getById,
  insertRow,
  listPage,
  newId,
  nowIso,
  rowToDto,
  softDeleteRow,
  updateRow,
  type Page,
  type Row,
} from '../repo.js'
import { TABLES } from '../tables.js'

const spec = TABLES.resume
const toDto = (row: Row): ResumeDto => rowToDto(spec, row) as unknown as ResumeDto

export interface ResumeListQuery {
  limit: number
  cursor?: string
  jobId?: string
  kind?: string
}

export function listResumes(db: Db, query: ResumeListQuery): Page<ResumeDto> {
  const where: string[] = []
  const params: unknown[] = []
  if (query.jobId) {
    where.push('job_id = ?')
    params.push(query.jobId)
  }
  if (query.kind) {
    where.push('kind = ?')
    params.push(query.kind)
  }

  const { rows, nextCursor } = listPage(db, spec, {
    limit: query.limit,
    cursor: query.cursor,
    where: where.join(' AND ') || undefined,
    params,
  })
  return { items: rows.map(toDto), nextCursor }
}

export function getResume(db: Db, id: string): ResumeDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('简历', id)
  return toDto(row)
}

/**
 * 默认母版的 id。定制建议没有绑定简历时用它兜底。
 * 不要拿 `listResumes({limit:1})` 当「母版」：那个按 updated_at 排，
 * 最后改过的往往是某个定制版，拿它当基础简历等于拿变体去生成变体。
 */
export function defaultResumeId(db: Db): string | null {
  const row = db
    .prepare('SELECT id FROM resume WHERE deleted_at IS NULL AND is_default = 1 ORDER BY updated_at DESC LIMIT 1')
    .get() as { id: string } | undefined
  return row?.id ?? null
}

/** 默认简历全局唯一：设置新的默认时清掉旧的，否则导出/投递会随机挑一份 */
function clearDefault(db: Db): void {
  db.prepare('UPDATE resume SET is_default = 0 WHERE is_default = 1 AND deleted_at IS NULL').run()
}

export function createResume(db: Db, input: Record<string, unknown>): ResumeDto {
  const created = db.transaction(() => {
    if (input.isDefault) clearDefault(db)
    return insertRow(db, spec, input)
  })()
  return toDto(created)
}

export function updateResume(db: Db, id: string, patch: ResumePatch): ResumeDto {
  const updated = db.transaction(() => {
    if (patch.isDefault) clearDefault(db)
    return updateRow(db, spec, id, patch as Record<string, unknown>, {
      expectedUpdatedAt: patch.expectedUpdatedAt,
    })
  })()
  if (!updated) throw new NotFoundError('简历', id)
  return toDto(updated)
}

/**
 * 复制为定制版（variant）。
 *
 * 血缘指向「母版」而不是「上一版」：否则 A→B→C 之后，
 * 「这版改自哪里」会退化成链式追溯，算版本胜率时无法归并。
 */
export function duplicateResume(
  db: Db,
  id: string,
  input: { title?: string; jobId?: string | null },
): ResumeDto {
  const source = getById(db, spec, id)
  if (!source) throw new NotFoundError('简历', id)

  // 用 INSERT ... SELECT 复制：data_json 原样搬运，避免「读出对象再序列化」时
  // 因字段顺序/精度变化产生一份内容不同但语义相同的副本。
  const newResumeId = newId()
  const now = nowIso()
  const inserted = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO resume
           (id, title, kind, template_id, data_json, base_resume_id, job_id, is_default, provenance_json, created_at, updated_at)
         SELECT ?, ?, 'variant', template_id, data_json, COALESCE(base_resume_id, id), ?, 0, NULL, ?, ?
         FROM resume WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        newResumeId,
        input.title ?? `${String(source.title)}（定制）`,
        input.jobId ?? source.job_id ?? null,
        now,
        now,
        id,
      )
    return result.changes
  })()

  if (inserted === 0) throw new NotFoundError('简历', id)
  return toDto(getById(db, spec, newResumeId) as Row)
}

export function deleteResume(db: Db, id: string): void {
  if (!getById(db, spec, id)) throw new NotFoundError('简历', id)
  const used = countRows(db, TABLES.application, 'resume_id = ?', [id])
  if (used > 0) {
    throw new ConflictError(`该简历已被 ${used} 条投递使用，删除后无法追溯「哪版简历见效」`, { applications: used })
  }
  softDeleteRow(db, spec, id)
}
