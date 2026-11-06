/**
 * Offer 总包模型与对比（ARCHITECTURE 5.3，P5 起用于 compare_offers，P6 的对比页复用同一份）。
 *
 * 一条硬规则：**所有数字都必须能由「口径」复现**。所以每个返回值都自带
 * `assumptions`，页面与 Agent 都只能照着它解释，不能自己另起一套算法口径。
 *
 * 纯函数、零 I/O：前端本地算、MCP 本地算，结果必然一致——这就是「不新增接口」的做法。
 */

export interface OfferLike {
  id?: string
  companyName?: string | null
  baseMonthly: number
  monthsPerYear: number
  perfMonths: number
  subsidyMonthly: number
  signon: number
  equityShares: number
  equityStrike: number
  equityFmv: number
  vestYears: number
  cliffMonths?: number
  /** 公积金比例（0.07 = 7%），仅展示，不计入总包 */
  housingFund?: number
  /** 城市（税后估算用，P6） */
  city?: string | null
  /** 人工给出的定性评分 1–5，缺省表示「没评」而不是「评 0」 */
  manualScores?: Partial<Record<QualitativeDimension, number>> | null
}

export interface OfferBreakdown {
  /** 年现金 = 月薪 × 12 + 月薪 × 绩效月 + 补贴 × 12 */
  annualCash: number
  firstYearCash: number
  fourYearCash: number
  /** 期权年化价值 = 股数 × max(FMV − 行权价, 0) / 归属年数 */
  equityAnnual: number
  equityFourYear: number
  /** 公积金年额（仅展示） */
  housingFundAnnual: number
  /** 4 年总包（含期权风险折扣） */
  fourYearTotal: number
  assumptions: string[]
}

export const DEFAULT_RISK_FACTOR = 0.5

export const QUALITATIVE_DIMENSIONS = ['growth', 'wlb', 'stability'] as const
export type QualitativeDimension = (typeof QUALITATIVE_DIMENSIONS)[number]

export const COMPARE_DIMENSIONS = ['cash', 'equity', 'welfare', ...QUALITATIVE_DIMENSIONS] as const
export type CompareDimension = (typeof COMPARE_DIMENSIONS)[number]

/** 默认权重：现金为王是现实，但把「成长」压到 0 会让结论失去意义 */
export const DEFAULT_WEIGHTS: Record<CompareDimension, number> = {
  cash: 0.45,
  equity: 0.15,
  welfare: 0.1,
  growth: 0.15,
  wlb: 0.1,
  stability: 0.05,
}

export const DIMENSION_LABELS: Record<CompareDimension, string> = {
  cash: '4 年现金',
  equity: '期权价值',
  welfare: '公积金/补贴',
  growth: '成长空间',
  wlb: '工作强度',
  stability: '稳定性',
}

export interface BreakdownOptions {
  /** 期权风险折扣，0 表示完全不认期权，1 表示按 FMV 全额认 */
  riskFactor?: number
}

export function offerBreakdown(offer: OfferLike, options: BreakdownOptions = {}): OfferBreakdown {
  const riskFactor = options.riskFactor ?? DEFAULT_RISK_FACTOR
  const base = Math.max(0, offer.baseMonthly || 0)
  const monthsPerYear = offer.monthsPerYear || 12
  const subsidy = Math.max(0, offer.subsidyMonthly || 0)

  const annualCash = base * monthsPerYear + base * Math.max(0, offer.perfMonths || 0) + subsidy * 12
  const signon = Math.max(0, offer.signon || 0)
  const firstYearCash = annualCash + signon
  // 基准口径：假设不涨薪。涨薪是承诺不是事实，不能拿来当分母
  const fourYearCash = firstYearCash + annualCash * 3

  const spread = Math.max(0, (offer.equityFmv || 0) - (offer.equityStrike || 0))
  const vestYears = Math.max(1, offer.vestYears || 4)
  const equityAnnual = ((offer.equityShares || 0) * spread) / vestYears
  const equityFourYear = equityAnnual * 4 * riskFactor

  // 公积金按「个人 + 单位」双份估：只算个人那份会让福利看起来少一半
  const housingFundAnnual = base * (offer.housingFund ?? 0) * 2 * 12

  return {
    annualCash,
    firstYearCash,
    fourYearCash,
    equityAnnual,
    equityFourYear,
    housingFundAnnual,
    fourYearTotal: fourYearCash + equityFourYear,
    assumptions: [
      '未计涨薪：4 年现金按当前年现金 × 4 估算（首年含签字费）',
      `期权按当前 FMV 计，风险折扣 ${riskFactor}`,
      '公积金仅展示，不计入总包',
    ],
  }
}

export interface OfferComparisonRow {
  id: string
  companyName: string
  breakdown: OfferBreakdown
  /** 各维度 0–1 归一化分数；定性维度缺失时为 null */
  scores: Record<CompareDimension, number | null>
  /** 加权总分（0–1），缺失维度不计入并按比例重分配权重 */
  totalScore: number
  /** 参与了加权的维度，方便解释「这个排序凭什么」 */
  usedDimensions: CompareDimension[]
  notes: string[]
}

export interface CompareResult {
  rows: OfferComparisonRow[]
  weights: Record<CompareDimension, number>
  assumptions: string[]
}

function normalizeWeights(weights: Partial<Record<CompareDimension, number>> | undefined) {
  const merged = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) }
  const sum = COMPARE_DIMENSIONS.reduce((total, key) => total + Math.max(0, merged[key] ?? 0), 0)
  if (sum <= 0) return { ...DEFAULT_WEIGHTS }
  const normalized = {} as Record<CompareDimension, number>
  for (const key of COMPARE_DIMENSIONS) normalized[key] = Math.max(0, merged[key] ?? 0) / sum
  return normalized
}

/**
 * 多 offer 对比。
 *
 * 归一化用「相对最优」，而不是「相对最优-最差」：只有一个 offer 时后者会除以 0。
 * 定性维度（成长/强度/稳定性）没有客观数据，只有人工评分，缺失就明确置空并重分配权重——
 * 假装有分数比缺分数更糟，用户会照着假数字做决定。
 */
export function compareOffers(
  offers: readonly OfferLike[],
  options: { weights?: Partial<Record<CompareDimension, number>>; riskFactor?: number } = {},
): CompareResult {
  const weights = normalizeWeights(options.weights)
  const breakdowns = offers.map((offer) => offerBreakdown(offer, { riskFactor: options.riskFactor }))

  const maxOf = (pick: (item: OfferBreakdown) => number) =>
    breakdowns.reduce((max, item) => Math.max(max, pick(item)), 0)

  const maxCash = maxOf((item) => item.fourYearCash)
  const maxEquity = maxOf((item) => item.equityFourYear)
  const maxWelfare = maxOf((item) => item.housingFundAnnual)

  const rows: OfferComparisonRow[] = offers.map((offer, index) => {
    const breakdown = breakdowns[index]!
    const scores = {} as Record<CompareDimension, number | null>
    scores.cash = maxCash > 0 ? breakdown.fourYearCash / maxCash : null
    scores.equity = maxEquity > 0 ? breakdown.equityFourYear / maxEquity : null
    scores.welfare = maxWelfare > 0 ? breakdown.housingFundAnnual / maxWelfare : null
    const notes: string[] = []
    for (const dimension of QUALITATIVE_DIMENSIONS) {
      const manual = offer.manualScores?.[dimension]
      // 1–5 分映射到 0–1；未评分就是 null，不按 0 处理
      scores[dimension] = typeof manual === 'number' && manual > 0 ? Math.min(5, manual) / 5 : null
      if (scores[dimension] === null) notes.push(`${DIMENSION_LABELS[dimension]} 未评分，未计入总分`)
    }

    const usedDimensions = COMPARE_DIMENSIONS.filter((dimension) => scores[dimension] !== null)
    const usedWeight = usedDimensions.reduce((total, key) => total + weights[key], 0)
    const totalScore =
      usedWeight <= 0
        ? 0
        : usedDimensions.reduce((total, key) => total + (scores[key] ?? 0) * weights[key], 0) / usedWeight

    return {
      id: offer.id ?? `offer-${index + 1}`,
      companyName: offer.companyName ?? `Offer ${index + 1}`,
      breakdown,
      scores,
      totalScore: Math.round(totalScore * 1000) / 1000,
      usedDimensions,
      notes,
    }
  })

  rows.sort((a, b) => b.totalScore - a.totalScore)

  return {
    rows,
    weights,
    assumptions: [
      '现金维度用 4 年现金（未计涨薪）',
      '期权维度已乘风险折扣；不认可期权时把 riskFactor 调到 0',
      '定性维度（成长/强度/稳定性）仅来自人工 1–5 评分，未评分的不计入并按比例重分配权重',
    ],
  }
}

/** 中文金额展示：万元为单位，避免「240000」这种要数零的写法 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const wan = value / 10_000
  const text = Math.abs(wan) >= 100 ? wan.toFixed(0) : wan.toFixed(1)
  return `${text.replace(/\.0$/, '')} 万`
}
