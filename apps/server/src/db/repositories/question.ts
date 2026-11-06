import type { QuestionDto, QuestionPatch } from '@land/core'
import { NotFoundError } from '../../errors.js'
import type { Db } from '../index.js'
import { getById, hardDeleteRow, insertRow, rowToDto, updateRow, type Row } from '../repo.js'
import { TABLES } from '../tables.js'

const spec = TABLES.question
const toDto = (row: Row): QuestionDto => rowToDto(spec, row) as unknown as QuestionDto

export interface QuestionQuery {
  limit: number
  jobId?: string
  interviewId?: string
  category?: string
}

export function listQuestions(db: Db, query: QuestionQuery): QuestionDto[] {
  const where: string[] = []
  const params: unknown[] = []
  if (query.jobId) {
    where.push('job_id = ?')
    params.push(query.jobId)
  }
  if (query.interviewId) {
    where.push('interview_id = ?')
    params.push(query.interviewId)
  }
  if (query.category) {
    where.push('category = ?')
    params.push(query.category)
  }
  const sql = `SELECT * FROM question${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`
  const rows = db.prepare(sql).all(...(params as never[]), query.limit) as Row[]
  return rows.map(toDto)
}

export function getQuestion(db: Db, id: string): QuestionDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('题目', id)
  return toDto(row)
}

export function createQuestion(db: Db, input: Record<string, unknown>): QuestionDto {
  return toDto(insertRow(db, spec, input))
}

export function updateQuestion(db: Db, id: string, patch: QuestionPatch): QuestionDto {
  const row = updateRow(db, spec, id, patch as Record<string, unknown>)
  if (!row) throw new NotFoundError('题目', id)
  return toDto(row)
}

export function deleteQuestion(db: Db, id: string): void {
  if (!hardDeleteRow(db, spec, id)) throw new NotFoundError('题目', id)
}
