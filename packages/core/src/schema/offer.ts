import { z } from 'zod'
import { patchOf, zId, zIso, zMoney, zRatio } from './common.js'

export const OFFER_STATUSES = ['pending', 'accepted', 'declined', 'expired'] as const

const offerFields = {
  companyName: z.string().trim().min(1).max(120),
  level: z.string().trim().max(40).nullish(),
  city: z.string().trim().max(40).nullish(),
  baseMonthly: zMoney,
  monthsPerYear: z.number().int().min(1).max(24),
  /** 绩效月数，允许 0.5 这种小数 */
  perfMonths: z.number().min(0).max(24),
  signon: zMoney,
  equityShares: z.number().int().min(0),
  equityStrike: z.number().min(0),
  equityFmv: z.number().min(0),
  vestYears: z.number().int().min(1).max(10),
  cliffMonths: z.number().int().min(0).max(48),
  housingFund: zRatio,
  subsidyMonthly: zMoney,
  deadline: zIso.nullish(),
  status: z.enum(OFFER_STATUSES),
  assumptions: z.record(z.string(), z.unknown()).nullish(),
  decisionNote: z.string().max(8000).nullish(),
}

export const zOfferCreate = z.object({
  applicationId: zId,
  ...offerFields,
  monthsPerYear: offerFields.monthsPerYear.default(12),
  perfMonths: offerFields.perfMonths.default(0),
  signon: offerFields.signon.default(0),
  equityShares: offerFields.equityShares.default(0),
  equityStrike: offerFields.equityStrike.default(0),
  equityFmv: offerFields.equityFmv.default(0),
  vestYears: offerFields.vestYears.default(4),
  cliffMonths: offerFields.cliffMonths.default(12),
  housingFund: offerFields.housingFund.default(0.07),
  subsidyMonthly: offerFields.subsidyMonthly.default(0),
  status: offerFields.status.default('pending'),
})

export const zOfferPatch = patchOf(offerFields)

export type OfferCreate = z.infer<typeof zOfferCreate>
export type OfferPatch = z.infer<typeof zOfferPatch>

export interface OfferDto {
  id: string
  applicationId: string
  companyName: string
  level: string | null
  city: string | null
  baseMonthly: number
  monthsPerYear: number
  perfMonths: number
  signon: number
  equityShares: number
  equityStrike: number
  equityFmv: number
  vestYears: number
  cliffMonths: number
  housingFund: number
  subsidyMonthly: number
  deadline: string | null
  status: string
  assumptions: unknown
  decisionNote: string | null
  createdAt: string
  updatedAt: string
}
