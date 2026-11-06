import type { JobDto, JobPatch, JobSummaryDto } from '@land/core'
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
import { safeCanonicalJdUrl } from '../../jd/sources.js'

const spec = TABLES.job
const toDto = (row: Row): JobDto => rowToDto(spec, row) as unknown as JobDto

/** 列表不返回 jdText / jdSnapshot：一份大厂 JD 能到 50KB，20 条就是 1MB */
function toSummary(row: Row): JobSummaryDto {
  const dto = toDto(row) as JobSummaryDto
  delete (dto as Partial<JobDto>).jdText
  delete (dto as Partial<JobDto>).jdSnapshot
  return dto
}

export interface JobListQuery {
  limit: number
  cursor?: string
  companyId?: string
  status?: string
  q?: string
  minFit?: number
  withApplication?: boolean
  /** 按 JD 链接去重：同一个岗位被 Agent 或 ⌘K 重复登记时能先查出来 */
  jdUrl?: string
  /** 列表排序：fit 按匹配度、priority 按期望、updated 按最近改动 */
  sort?: 'fit' | 'priority' | 'updated'
}

const ORDER_BY: Record<NonNullable<JobListQuery['sort']>, string> = {
  // fit_score 为 null 的排最后，否则空值会占据榜首
  fit: 'fit_score IS NULL, fit_score DESC, updated_at DESC, id DESC',
  priority: 'priority ASC, updated_at DESC, id DESC',
  updated: 'updated_at DESC, id DESC',
}

export function listJobs(db: Db, query: JobListQuery): Page<JobSummaryDto> {
  const where: string[] = []
  const params: unknown[] = []
  if (query.companyId) {
    where.push('company_id = ?')
    params.push(query.companyId)
  }
  if (query.status) {
    where.push('status = ?')
    params.push(query.status)
  }
  if (query.minFit !== undefined) {
    where.push('fit_score >= ?')
    params.push(query.minFit)
  }
  if (query.q) {
    where.push('(title LIKE ? OR keywords_json LIKE ? OR jd_text LIKE ?)')
    const like = `%${query.q}%`
    params.push(like, like, like)
  }
  if (query.jdUrl) {
    // 库里存的是用户给的原始链接，而 utm_/hash/尾斜杠不该影响「是不是同一个岗位」。
    // 单用户库最多几百条，这里取回全部非空链接在内存里做归一化比对，够用且不必加列或索引。
    const target = safeCanonicalJdUrl(query.jdUrl)
    const rows = db
      .prepare('SELECT id, jd_url AS jdUrl FROM job WHERE deleted_at IS NULL AND jd_url IS NOT NULL')
      .all() as { id: string; jdUrl: string }[]
    const ids = rows.filter((row) => safeCanonicalJdUrl(row.jdUrl) === target).map((row) => row.id)
    if (ids.length === 0) where.push('1 = 0')
    else {
      where.push(`id IN (${ids.map(() => '?').join(', ')})`)
      params.push(...ids)
    }
  }

  const { rows, nextCursor } = listPage(db, spec, {
    limit: query.limit,
    cursor: query.cursor,
    where: where.join(' AND ') || undefined,
    params,
    orderBy: ORDER_BY[query.sort ?? 'priority'],
  })

  const items = rows.map(toSummary)
  attachCompanyNames(db, items)
  if (query.withApplication) attachActiveApplications(db, items)
  return { items, nextCursor }
}

/** 批量补公司名（最多 limit 条），避免 join 与游标别名打架 */
function attachCompanyNames(db: Db, items: JobSummaryDto[]): void {
  const ids = [...new Set(items.map((j) => j.companyId))]
  if (ids.length === 0) return
  const rows = db
    .prepare(`SELECT id, name FROM company WHERE id IN (${ids.map(() => '?').join(', ')})`)
    .all(...ids) as { id: string; name: string }[]
  const names = new Map(rows.map((r) => [r.id, r.name]))
  for (const job of items) job.companyName = names.get(job.companyId)
}

/** 每个岗位是否已有活跃投递：看板要据此禁用「再投一次」 */
function attachActiveApplications(db: Db, items: JobSummaryDto[]): void {
  const ids = items.map((j) => j.id)
  if (ids.length === 0) return
  const rows = db
    .prepare(
      `SELECT job_id AS jobId, id FROM application
       WHERE deleted_at IS NULL
         AND status NOT IN ('rejected','ghosted','withdrawn','accepted')
         AND job_id IN (${ids.map(() => '?').join(', ')})`,
    )
    .all(...ids) as { jobId: string; id: string }[]
  const map = new Map(rows.map((r) => [r.jobId, r.id]))
  for (const job of items) job.applicationId = map.get(job.id) ?? null
}

export function getJob(db: Db, id: string): JobDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('岗位', id)
  const dto = toDto(row)
  // 详情页标题旁的副标题要显示公司名：列表走 listJobs 补了，单条不走这条路会恒为 undefined
  attachCompanyNames(db, [dto])
  return dto
}

function assertCompanyExists(db: Db, companyId: string): void {
  if (!getById(db, TABLES.company, companyId)) throw new NotFoundError('公司', companyId)
}

export function createJob(db: Db, input: Record<string, unknown>): JobDto {
  assertCompanyExists(db, String(input.companyId))
  return toDto(insertRow(db, spec, input))
}

export function updateJob(db: Db, id: string, patch: JobPatch): JobDto {
  if (patch.companyId) assertCompanyExists(db, patch.companyId)
  const row = updateRow(db, spec, id, patch as Record<string, unknown>, {
    expectedUpdatedAt: patch.expectedUpdatedAt,
  })
  if (!row) throw new NotFoundError('岗位', id)
  return toDto(row)
}

/** 有投递记录的岗位不能删：投递历史是主账本，宁可让用户先撤投递 */
export function deleteJob(db: Db, id: string): void {
  if (!getById(db, spec, id)) throw new NotFoundError('岗位', id)
  const applications = countRows(db, TABLES.application, 'job_id = ?', [id])
  if (applications > 0) {
    throw new ConflictError(`该岗位已有 ${applications} 条投递记录，不能删除`, { applications })
  }
  softDeleteRow(db, spec, id)
}
