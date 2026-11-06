import type { InterviewDto, InterviewPatch } from '@land/core'
import { NotFoundError } from '../../errors.js'
import type { Db } from '../index.js'
import { getById, hardDeleteRow, insertRow, nowIso, rowToDto, updateRow, type Row } from '../repo.js'
import { TABLES } from '../tables.js'

const spec = TABLES.interview
const toDto = (row: Row): InterviewDto => rowToDto(spec, row) as unknown as InterviewDto

export interface InterviewQuery {
  limit: number
  applicationId?: string
  /** 只要未来的（面试日历 / 今日待办用） */
  upcoming?: boolean
}

/**
 * 面试条数天然少（一场求职几十条），所以不分页，只限条数。
 * 需要分页时再加游标，现在加只是负担。
 */
export function listInterviews(db: Db, query: InterviewQuery): InterviewDto[] {
  const where: string[] = []
  const params: unknown[] = []
  if (query.applicationId) {
    where.push('application_id = ?')
    params.push(query.applicationId)
  }
  if (query.upcoming) {
    where.push('scheduled_at IS NOT NULL AND scheduled_at >= ?')
    params.push(nowIso())
  }
  const sql = `SELECT * FROM interview${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY scheduled_at IS NULL, scheduled_at ASC, round ASC LIMIT ?`
  const rows = db.prepare(sql).all(...(params as never[]), query.limit) as Row[]
  return rows.map(toDto)
}

export function getInterview(db: Db, id: string): InterviewDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('面试', id)
  return toDto(row)
}

export function createInterview(db: Db, input: Record<string, unknown>): InterviewDto {
  if (!getById(db, TABLES.application, String(input.applicationId))) {
    throw new NotFoundError('投递', String(input.applicationId))
  }
  return toDto(insertRow(db, spec, input))
}

export function updateInterview(db: Db, id: string, patch: InterviewPatch): InterviewDto {
  const row = updateRow(db, spec, id, patch as Record<string, unknown>)
  if (!row) throw new NotFoundError('面试', id)
  return toDto(row)
}

export function deleteInterview(db: Db, id: string): void {
  if (!hardDeleteRow(db, spec, id)) throw new NotFoundError('面试', id)
}
