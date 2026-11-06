import { QUALITATIVE_DIMENSIONS, type OfferLike, type QualitativeDimension } from '@land/core/offer'
import { DEFAULT_HOUSING_FUND_RATE } from '@land/core/tax'
import type { OfferDto } from './api'

/**
 * Offer 的「定性判断」读写。
 *
 * 现金、期权、公积金都是从数字算出来的；成长空间 / 工作强度 / 稳定性没有客观来源，
 * 只能由人给 1–5 分。这类判断存进 `offers.assumptions` 这个 JSON 列（键名见 `SCORES_KEY`），
 * 不为它建表：它是「我当下的看法」，随时会改，也不参与任何服务端计算。
 *
 * 相对的，权重、期权风险折扣、专项附加扣除是**看问题的视角**，只存在于页面状态里、不落库——
 * 换个视角不该污染数据；这也让「同一份数据、不同结论」变成一次滑块的差别。
 *
 * 读取必须容错：这一列可能被 Agent 写成任意形状，读不到就当「没评」，
 * 绝不因为一个坏字段让整个对比页白屏。
 */
export type QualitativeScores = Partial<Record<QualitativeDimension, number>>

/** assumptions 里放定性评分的键 */
export const SCORES_KEY = 'qualitativeScores'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampScore(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value < 1 || value > 5) return undefined
  return Math.round(value)
}

export function readQualitativeScores(assumptions: unknown): QualitativeScores {
  if (!isRecord(assumptions)) return {}
  const raw = assumptions[SCORES_KEY]
  if (!isRecord(raw)) return {}
  const scores: QualitativeScores = {}
  for (const dimension of QUALITATIVE_DIMENSIONS) {
    const score = clampScore(raw[dimension])
    if (score !== undefined) scores[dimension] = score
  }
  return scores
}

/**
 * 只覆盖 `qualitativeScores` 一个键，其余（可能由 Agent 写入的说明字段）原样保留。
 * 整列覆盖会静默丢掉别人的注释，这种「顺手破坏」最难排查。
 */
export function mergeQualitativeScores(assumptions: unknown, scores: QualitativeScores): Record<string, unknown> {
  const base = isRecord(assumptions) ? { ...assumptions } : {}
  base[SCORES_KEY] = scores
  return base
}

/** DTO → 对比函数入参。缺省字段在这里补一次，页面里就不用到处写 `?? 0` */
export function toOfferLike(offer: OfferDto, scores: QualitativeScores): OfferLike {
  return {
    id: offer.id,
    companyName: offer.companyName,
    baseMonthly: offer.baseMonthly,
    monthsPerYear: offer.monthsPerYear,
    perfMonths: offer.perfMonths,
    subsidyMonthly: offer.subsidyMonthly,
    signon: offer.signon,
    equityShares: offer.equityShares,
    equityStrike: offer.equityStrike,
    equityFmv: offer.equityFmv,
    vestYears: offer.vestYears,
    cliffMonths: offer.cliffMonths,
    housingFund: offer.housingFund,
    city: offer.city,
    manualScores: scores,
  }
}

/** 公积金比例：0 是合法值（有的公司确实没有），只有「没填」才回落默认 */
export const housingFundRate = (offer: OfferDto): number =>
  typeof offer.housingFund === 'number' && offer.housingFund >= 0 ? offer.housingFund : DEFAULT_HOUSING_FUND_RATE

/** 已评几维——用来解释为什么某个 offer 的加权分看起来偏高 */
export function ratedDimensions(scores: QualitativeScores): QualitativeDimension[] {
  return QUALITATIVE_DIMENSIONS.filter((dimension) => scores[dimension] !== undefined)
}
