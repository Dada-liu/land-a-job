import type { CompanyDto, CompanyPatch } from '@land/core'
import { ConflictError, NotFoundError } from '../../errors.js'
import type { Db } from '../index.js'
import {
  countRows,
  getById,
  insertRow,
  listPage,
  rowToDto,
  softDeleteRow,
  updateRow,
  type Page,
  type Row,
} from '../repo.js'
import { TABLES } from '../tables.js'

const spec = TABLES.company
const toDto = (row: Row): CompanyDto => rowToDto(spec, row) as unknown as CompanyDto

export interface CompanyListQuery {
  limit: number
  cursor?: string
  priority?: number
  q?: string
}

/** 未删除岗位数：一次 GROUP BY 补齐，避免列表页 N+1 */
function jobCounts(db: Db): Map<string, number> {
  const rows = db
    .prepare('SELECT company_id AS id, count(*) AS n FROM job WHERE deleted_at IS NULL GROUP BY company_id')
    .all() as { id: string; n: number }[]
  return new Map(rows.map((r) => [r.id, r.n]))
}

export function listCompanies(db: Db, query: CompanyListQuery): Page<CompanyDto> {
  const where: string[] = []
  const params: unknown[] = []
  if (query.priority) {
    where.push('priority = ?')
    params.push(query.priority)
  }
  if (query.q) {
    where.push('(name LIKE ? OR industry LIKE ? OR notes LIKE ?)')
    const like = `%${query.q}%`
    params.push(like, like, like)
  }

  const { rows, nextCursor } = listPage(db, spec, {
    limit: query.limit,
    cursor: query.cursor,
    where: where.join(' AND ') || undefined,
    params,
    orderBy: 'priority ASC, updated_at DESC, id DESC',
  })

  const counts = jobCounts(db)
  return { items: rows.map((row) => ({ ...toDto(row), jobCount: counts.get(String(row.id)) ?? 0 })), nextCursor }
}

export function getCompany(db: Db, id: string): CompanyDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('公司', id)
  const jobCount = countRows(db, TABLES.job, 'company_id = ?', [id])
  return { ...toDto(row), jobCount }
}

export function createCompany(db: Db, input: Record<string, unknown>): CompanyDto {
  const row = insertRow(db, spec, input)
  // 新建公司必然没有岗位，但字段要一直在：前端不必区分「缺失」和「0」
  return { ...toDto(row), jobCount: 0 }
}

export function updateCompany(db: Db, id: string, patch: CompanyPatch): CompanyDto {
  const row = updateRow(db, spec, id, patch as Record<string, unknown>, {
    expectedUpdatedAt: patch.expectedUpdatedAt,
  })
  if (!row) throw new NotFoundError('公司', id)
  return toDto(row)
}

/**
 * 软删公司。
 *
 * 不允许「删了公司，岗位还挂在库里」的悬空引用：
 * 有岗位但没给 cascade → 409 并告诉调用方有多少个；
 * 有投递记录 → 一律拒绝，因为投递历史是求职过程的主账本，不能随公司一起消失。
 */
export function deleteCompany(db: Db, id: string, cascade: boolean): { deletedJobs: number } {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('公司', id)

  const jobIds = (
    db.prepare('SELECT id FROM job WHERE company_id = ? AND deleted_at IS NULL').all(id) as { id: string }[]
  ).map((r) => r.id)

  if (jobIds.length > 0) {
    const placeholders = jobIds.map(() => '?').join(', ')
    const activeApplications = countRows(
      db,
      TABLES.application,
      `job_id IN (${placeholders})`,
      jobIds,
    )
    if (activeApplications > 0) {
      throw new ConflictError(
        `该公司下还有 ${activeApplications} 条投递记录，请先处理投递再删除公司`,
        { applications: activeApplications },
      )
    }
    if (!cascade) {
      throw new ConflictError(`该公司下还有 ${jobIds.length} 个岗位，需显式 cascade 才能一起删除`, {
        jobs: jobIds.length,
      })
    }
  }

  db.transaction(() => {
    for (const jobId of jobIds) softDeleteRow(db, TABLES.job, jobId)
    softDeleteRow(db, spec, id)
  })()

  return { deletedJobs: jobIds.length }
}
