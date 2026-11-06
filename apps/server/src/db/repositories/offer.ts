import type { OfferDto, OfferPatch } from '@land/core'
import { ConflictError, NotFoundError } from '../../errors.js'
import type { Db } from '../index.js'
import { getById, insertRow, isUniqueViolation, rowToDto, updateRow, type Row } from '../repo.js'
import { TABLES } from '../tables.js'

const spec = TABLES.offer
const toDto = (row: Row): OfferDto => rowToDto(spec, row) as unknown as OfferDto

export function listOffers(db: Db, query: { limit: number; status?: string }): OfferDto[] {
  const where: string[] = []
  const params: unknown[] = []
  if (query.status) {
    where.push('status = ?')
    params.push(query.status)
  }
  const sql = `SELECT * FROM offer${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?`
  const rows = db.prepare(sql).all(...(params as never[]), query.limit) as Row[]
  return rows.map(toDto)
}

export function getOffer(db: Db, id: string): OfferDto {
  const row = getById(db, spec, id)
  if (!row) throw new NotFoundError('Offer', id)
  return toDto(row)
}

/** 一个投递只能有一份 offer：同一家给两次不该出现两条记录，涨薪走 update */
export function createOffer(db: Db, input: Record<string, unknown>): OfferDto {
  const applicationId = String(input.applicationId)
  if (!getById(db, TABLES.application, applicationId)) {
    throw new NotFoundError('投递', applicationId)
  }
  const existing = db.prepare('SELECT id FROM offer WHERE application_id = ?').get(applicationId) as
    | { id: string }
    | undefined
  if (existing) {
    throw new ConflictError('该投递已有 offer 记录，请直接修改', { offerId: existing.id })
  }

  try {
    return toDto(insertRow(db, spec, input))
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('该投递已有 offer 记录', { applicationId })
    }
    throw error
  }
}

export function updateOffer(db: Db, id: string, patch: OfferPatch): OfferDto {
  const row = updateRow(db, spec, id, patch as Record<string, unknown>)
  if (!row) throw new NotFoundError('Offer', id)
  return toDto(row)
}
