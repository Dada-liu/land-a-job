import type {
  ApplicationDto,
  ApplicationEventDto,
  ApplicationListItemDto,
  ApplicationPatch,
  Status,
  StatusChange,
} from '@land/core'
import { STATUSES, assertTransition, nextStatuses } from '@land/core'
import { ConflictError, NotFoundError } from '../../errors.js'
import type { Db } from '../index.js'
import {
  countRows,
  getById,
  insertRow,
  isUniqueViolation,
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

const spec = TABLES.application
const eventSpec = TABLES.applicationEvent

const toDto = (row: Row): ApplicationDto => rowToDto(spec, row) as unknown as ApplicationDto
const toEvent = (row: Row): ApplicationEventDto => rowToDto(eventSpec, row) as unknown as ApplicationEventDto

/** 活跃投递的 WHERE 片段：与 ux_app_active 索引条件保持同源 */
const ACTIVE_SQL = `status NOT IN ('rejected','ghosted','withdrawn','accepted')`

interface EventInput {
  type: string
  from?: string | null
  to?: string | null
  payload?: unknown
  actor: string
  source: string
  at?: string
}

function writeEvent(db: Db, applicationId: string, event: EventInput): void {
  db.prepare(
    `INSERT INTO application_event
       (id, application_id, type, from_status, to_status, payload_json, actor, source, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    applicationId,
    event.type,
    event.from ?? null,
    event.to ?? null,
    event.payload === undefined ? null : JSON.stringify(event.payload),
    event.actor,
    event.source,
    event.at ?? nowIso(),
  )
}

export interface ApplicationListQuery {
  limit: number
  cursor?: string
  status?: string
  jobId?: string
  companyId?: string
  /** 只要未结束的（看板默认视图） */
  activeOnly?: boolean
}

/** 批量补岗位标题与公司名：看板卡片必须显示「公司 · 岗位」，否则只剩一串 uuid */
function decorate(db: Db, items: ApplicationDto[]): ApplicationListItemDto[] {
  if (items.length === 0) return []
  const jobIds = [...new Set(items.map((a) => a.jobId))]
  const jobs = db
    .prepare(
      `SELECT j.id, j.title, j.company_id AS companyId, c.name AS companyName
       FROM job j LEFT JOIN company c ON c.id = j.company_id
       WHERE j.id IN (${jobIds.map(() => '?').join(', ')})`,
    )
    .all(...jobIds) as { id: string; title: string; companyId: string; companyName: string | null }[]
  const byJob = new Map(jobs.map((j) => [j.id, j]))

  const now = Date.now()
  return items.map((app) => {
    const job = byJob.get(app.jobId)
    const statusAt = Date.parse(app.statusAt)
    return {
      ...app,
      jobTitle: job?.title,
      companyId: job?.companyId,
      companyName: job?.companyName ?? undefined,
      daysInStatus: Number.isNaN(statusAt) ? undefined : Math.floor((now - statusAt) / 86_400_000),
      nextStatuses: [...nextStatuses(app.status as Status)],
    }
  })
}

export function listApplications(db: Db, query: ApplicationListQuery): Page<ApplicationListItemDto> {
  const where: string[] = []
  const params: unknown[] = []
  if (query.status) {
    where.push('status = ?')
    params.push(query.status)
  }
  if (query.activeOnly) where.push(ACTIVE_SQL)
  if (query.jobId) {
    where.push('job_id = ?')
    params.push(query.jobId)
  }
  if (query.companyId) {
    where.push(`job_id IN (SELECT id FROM job WHERE company_id = ? AND deleted_at IS NULL)`)
    params.push(query.companyId)
  }

  const { rows, nextCursor } = listPage(db, spec, {
    limit: query.limit,
    cursor: query.cursor,
    where: where.join(' AND ') || undefined,
    params,
    orderBy: 'status_at DESC, id DESC',
  })
  return { items: decorate(db, rows.map(toDto)), nextCursor }
}

export function getApplication(db: Db, id: string): ApplicationListItemDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('投递', id)
  return decorate(db, [toDto(row)])[0] as ApplicationListItemDto
}

function assertJobExists(db: Db, jobId: string): void {
  if (!getById(db, TABLES.job, jobId)) throw new NotFoundError('岗位', jobId)
}

function assertResumeExists(db: Db, resumeId: string): void {
  if (!getById(db, TABLES.resume, resumeId)) throw new NotFoundError('简历', resumeId)
}

function activeApplicationId(db: Db, jobId: string): string | null {
  const row = db
    .prepare(
      `SELECT id FROM application WHERE job_id = ? AND deleted_at IS NULL AND ${ACTIVE_SQL} LIMIT 1`,
    )
    .get(jobId) as { id: string } | undefined
  return row?.id ?? null
}

export function createApplication(db: Db, input: Record<string, unknown>): ApplicationDto {
  const jobId = String(input.jobId)
  assertJobExists(db, jobId)
  if (input.resumeId) assertResumeExists(db, String(input.resumeId))

  // 事务内先查后插，给「同一岗位重复投递」一个可读的 409，
  // 而不是把 SQLITE_CONSTRAINT 直接甩给 Agent。
  let row: Row
  try {
    row = db.transaction(() => {
      const existing = activeApplicationId(db, jobId)
      if (existing) {
        throw new ConflictError('该岗位已有进行中的投递，请直接改状态而不是重复登记', {
          applicationId: existing,
        })
      }

      const status = (input.status as Status | undefined) ?? 'queued'
      const created = insertRow(db, spec, {
        ...input,
        status,
        statusAt: (input.appliedAt as string | undefined) ?? nowIso(),
      })
      writeEvent(db, String(created.id), {
        type: 'created',
        to: status,
        payload: { channel: created.channel, resumeId: created.resume_id ?? null },
        actor: String(input.actor ?? 'user'),
        source: String(input.source ?? 'web'),
        at: String(created.created_at),
      })
      return created
    })()
  } catch (error) {
    // 兜底：并发下两条请求都通过了上面的查询，由部分唯一索引拦下第二条
    if (isUniqueViolation(error)) {
      throw new ConflictError('该岗位已有进行中的投递', { jobId })
    }
    throw error
  }

  return toDto(row)
}

export function updateApplication(db: Db, id: string, patch: ApplicationPatch): ApplicationDto {
  if (patch.resumeId) assertResumeExists(db, String(patch.resumeId))

  const updated = db.transaction(() => {
    const row = updateRow(db, spec, id, patch as Record<string, unknown>, {
      expectedUpdatedAt: patch.expectedUpdatedAt,
    })
    if (!row) return undefined
    if (patch.resumeId !== undefined && patch.resumeId !== null) {
      writeEvent(db, id, {
        type: 'resume_linked',
        payload: { resumeId: patch.resumeId },
        actor: String(patch.actor ?? 'user'),
        source: String(patch.source ?? 'web'),
      })
    }
    return row
  })()
  if (!updated) throw new NotFoundError('投递', id)
  return toDto(updated)
}

export interface StatusChangeResult {
  id: string
  from: Status
  to: Status
  /** 违反状态机但被 force 放行时为 true，事件里已留痕 */
  forced: boolean
  application: ApplicationDto
}

/**
 * 改状态：状态机校验 + 写事件必须在同一事务里。
 * 否则「状态改了但事件丢了」，时间线会永久缺一格，漏斗也就算不准。
 */
export function changeStatus(db: Db, id: string, input: StatusChange): StatusChangeResult {
  const outcome = db.transaction(() => {
    const row = getById(db, spec, id)
    if (!row) throw new NotFoundError('投递', id)

    const from = String(row.status) as Status
    const to = input.to
    if (from === to) {
      return { from, to, forced: false, row, changed: false }
    }

    const allowed = nextStatuses(from)
    const bypassed = !allowed.includes(to)
    assertTransition(from, to, input.force)

    const now = nowIso()
    const appliedAt =
      (input.appliedAt as string | undefined) ??
      (to === 'applied' && !row.applied_at ? now : (row.applied_at as string | null))

    db.prepare(`UPDATE application SET status = ?, status_at = ?, applied_at = ?, updated_at = ? WHERE id = ?`).run(
      to,
      now,
      appliedAt,
      now,
      id,
    )

    writeEvent(db, id, {
      type: 'status_changed',
      from,
      to,
      payload:
        bypassed || input.note
          ? { note: input.note ?? null, forced: bypassed, reason: input.reason ?? null }
          : { note: null, forced: false },
      actor: input.actor,
      source: input.source,
      at: now,
    })

    return { from, to, forced: bypassed, row: getById(db, spec, id) as Row, changed: true }
  })()

  return { id, from: outcome.from, to: outcome.to, forced: outcome.forced, application: toDto(outcome.row) }
}

export function appendNote(
  db: Db,
  id: string,
  input: { note: string; actor: string; source: string },
): ApplicationEventDto {
  if (!getById(db, spec, id)) throw new NotFoundError('投递', id)
  const now = nowIso()
  writeEvent(db, id, {
    type: 'note',
    payload: { note: input.note },
    actor: input.actor,
    source: input.source,
    at: now,
  })
  const row = db
    .prepare('SELECT * FROM application_event WHERE application_id = ? ORDER BY at DESC, rowid DESC LIMIT 1')
    .get(id) as Row
  return toEvent(row)
}

export function listTimeline(db: Db, id: string): ApplicationEventDto[] {
  if (!getById(db, spec, id)) throw new NotFoundError('投递', id)
  const rows = db
    .prepare('SELECT * FROM application_event WHERE application_id = ? ORDER BY at ASC, rowid ASC')
    .all(id) as Row[]
  return rows.map(toEvent)
}

/** 软删投递：保留记录但不再计入活跃，事件里留一条 deleted 便于回溯 */
export function deleteApplication(db: Db, id: string, actor: string, source: string): void {
  db.transaction(() => {
    const row = getById(db, spec, id)
    if (!row) throw new NotFoundError('投递', id)
    softDeleteRow(db, spec, id)
    writeEvent(db, id, { type: 'deleted', from: String(row.status), actor, source })
  })()
}

export interface OverviewStats {
  companies: number
  jobs: number
  resumes: number
  applications: number
  active: number
  byStatus: Record<string, number>
}

/** P1 的轻量概览：让首页 KPI 从「—」变成真数字，完整漏斗留给 P7 */
export function overview(db: Db): OverviewStats {
  const rows = db
    .prepare('SELECT status, count(*) AS n FROM application WHERE deleted_at IS NULL GROUP BY status')
    .all() as { status: string; n: number }[]

  const byStatus: Record<string, number> = {}
  for (const status of STATUSES) byStatus[status] = 0
  for (const row of rows) byStatus[row.status] = row.n

  const applications = rows.reduce((sum, r) => sum + r.n, 0)
  const terminal = (['rejected', 'ghosted', 'withdrawn', 'accepted'] as const).reduce(
    (sum, s) => sum + (byStatus[s] ?? 0),
    0,
  )

  return {
    companies: countRows(db, TABLES.company),
    jobs: countRows(db, TABLES.job),
    resumes: countRows(db, TABLES.resume),
    applications,
    active: applications - terminal,
    byStatus,
  }
}
