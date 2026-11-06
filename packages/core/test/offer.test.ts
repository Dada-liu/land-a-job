import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RISK_FACTOR,
  DEFAULT_WEIGHTS,
  compareOffers,
  formatMoney,
  offerBreakdown,
  type OfferLike,
} from '../src/offer.js'

/**
 * 六组真实形态的 offer（P6-1）。
 *
 * 断言用「手算过一遍」的绝对值而不是「再实现一遍公式」：
 * 后者只能证明代码没变，证明不了它算得对。
 */

const base: OfferLike = {
  baseMonthly: 30_000,
  monthsPerYear: 12,
  perfMonths: 0,
  subsidyMonthly: 0,
  signon: 0,
  equityShares: 0,
  equityStrike: 0,
  equityFmv: 0,
  vestYears: 4,
}

describe('offerBreakdown：六组真实形态', () => {
  it('① 纯现金：月薪 30k × 12，无年终无期权', () => {
    const result = offerBreakdown(base)
    expect(result.annualCash).toBe(360_000)
    expect(result.firstYearCash).toBe(360_000)
    expect(result.fourYearCash).toBe(1_440_000)
    expect(result.equityAnnual).toBe(0)
    expect(result.fourYearTotal).toBe(1_440_000)
  })

  it('② 带年终：月薪 30k × 12 + 绩效 3 个月 = 年薪 45 万', () => {
    const result = offerBreakdown({ ...base, perfMonths: 3 })
    expect(result.annualCash).toBe(450_000)
    expect(result.firstYearCash).toBe(450_000)
    expect(result.fourYearCash).toBe(1_800_000)
  })

  it('③ 签字费：只影响首年与 4 年总额，不进年现金', () => {
    const result = offerBreakdown({ ...base, signon: 50_000 })
    expect(result.annualCash).toBe(360_000)
    expect(result.firstYearCash).toBe(410_000)
    // 410k + 360k × 3
    expect(result.fourYearCash).toBe(1_490_000)
  })

  it('④ 期权价内：1 万股、行权 1 元、FMV 21 元、4 年归属', () => {
    const result = offerBreakdown({
      ...base,
      equityShares: 10_000,
      equityStrike: 1,
      equityFmv: 21,
      vestYears: 4,
    })
    // 每股价差 20 元 × 1 万股 / 4 年 = 5 万/年
    expect(result.equityAnnual).toBe(50_000)
    // 4 年再乘风险折扣 0.5
    expect(result.equityFourYear).toBe(100_000)
    expect(result.fourYearTotal).toBe(1_440_000 + 100_000)
  })

  it('⑤ 期权价外：FMV 低于行权价时一分不值，不能算成负数', () => {
    const result = offerBreakdown({
      ...base,
      equityShares: 20_000,
      equityStrike: 30,
      equityFmv: 18,
      vestYears: 4,
    })
    expect(result.equityAnnual).toBe(0)
    expect(result.equityFourYear).toBe(0)
    expect(result.fourYearTotal).toBe(result.fourYearCash)
  })

  it('⑥ 全都要：月薪 45k × 15 + 绩效 3 + 签字 8 万 + 期权 + 补贴 + 公积金', () => {
    const result = offerBreakdown({
      baseMonthly: 45_000,
      monthsPerYear: 15,
      perfMonths: 3,
      subsidyMonthly: 2_000,
      signon: 80_000,
      equityShares: 50_000,
      equityStrike: 1,
      equityFmv: 11,
      vestYears: 4,
      housingFund: 0.12,
    })
    // 45k × 15 + 45k × 3 + 2k × 12 = 675k + 135k + 24k
    expect(result.annualCash).toBe(834_000)
    expect(result.firstYearCash).toBe(914_000)
    expect(result.fourYearCash).toBe(914_000 + 834_000 * 3)
    // 每股 10 元 × 5 万股 / 4 年 = 12.5 万/年
    expect(result.equityAnnual).toBe(125_000)
    expect(result.equityFourYear).toBe(125_000 * 4 * DEFAULT_RISK_FACTOR)
    expect(result.housingFundAnnual).toBe(45_000 * 0.12 * 2 * 12)
    expect(result.assumptions.length).toBeGreaterThanOrEqual(3)
  })
})

describe('口径必须随结果返回', () => {
  it('默认三条口径都在', () => {
    const result = offerBreakdown(base)
    expect(result.assumptions.join('\n')).toContain('未计涨薪')
    expect(result.assumptions.join('\n')).toContain('风险折扣')
    expect(result.assumptions.join('\n')).toContain('公积金仅展示')
  })

  it('风险折扣可调到 0（完全不认期权）', () => {
    const offer = { ...base, equityShares: 10_000, equityStrike: 1, equityFmv: 21 }
    expect(offerBreakdown(offer, { riskFactor: 0 }).equityFourYear).toBe(0)
    expect(offerBreakdown(offer, { riskFactor: 1 }).equityFourYear).toBe(200_000)
  })
})

describe('compareOffers', () => {
  const rich: OfferLike = { ...base, id: 'a', companyName: '高现金', baseMonthly: 50_000 }
  const equity: OfferLike = {
    ...base,
    id: 'b',
    companyName: '高期权',
    baseMonthly: 30_000,
    equityShares: 200_000,
    equityStrike: 1,
    equityFmv: 11,
  }

  it('默认权重下现金多的排前面', () => {
    const result = compareOffers([equity, rich])
    expect(result.rows[0]!.id).toBe('a')
    expect(result.rows[0]!.totalScore).toBeGreaterThan(result.rows[1]!.totalScore)
  })

  it('定性维度未评分时置空并计入 notes，不按 0 处理', () => {
    const result = compareOffers([rich, equity])
    const row = result.rows[0]!
    expect(row.scores.growth).toBeNull()
    expect(row.notes.some((note) => note.includes('未评分'))).toBe(true)
    // 两份都没有公积金数据 → 福利维度无从比较，也应为 null
    expect(row.scores.welfare).toBeNull()
    expect(row.usedDimensions).toEqual(['cash', 'equity'])
  })

  it('有公积金数据时福利维度参与加权', () => {
    const result = compareOffers([
      { ...rich, housingFund: 0.07 },
      { ...equity, housingFund: 0.12 },
    ])
    const row = result.rows.find((item) => item.id === 'b')!
    expect(row.scores.welfare).toBe(1)
    expect(row.usedDimensions).toContain('welfare')
  })

  it('给了人工评分就要参与排序（期权换成长的故事能翻身）', () => {
    const withGrowth: OfferLike = { ...equity, manualScores: { growth: 5, wlb: 5, stability: 4 } }
    const result = compareOffers([rich, withGrowth], {
      weights: { cash: 0.2, equity: 0.1, welfare: 0.05, growth: 0.4, wlb: 0.2, stability: 0.05 },
    })
    expect(result.rows[0]!.id).toBe('b')
  })

  it('权重会被归一化，权重全 0 时回落到默认', () => {
    const result = compareOffers([rich], { weights: { cash: 0, equity: 0, welfare: 0, growth: 0, wlb: 0, stability: 0 } })
    expect(Object.values(result.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
    expect(result.weights.cash).toBeCloseTo(DEFAULT_WEIGHTS.cash, 5)
  })

  it('单个 offer 也不除以 0（归一化用相对最优）', () => {
    const result = compareOffers([rich])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]!.scores.cash).toBe(1)
    expect(Number.isFinite(result.rows[0]!.totalScore)).toBe(true)
  })

  it('空输入不崩', () => {
    const result = compareOffers([])
    expect(result.rows).toEqual([])
    expect(result.assumptions.length).toBeGreaterThan(0)
  })
})

describe('formatMoney', () => {
  it('用万元而不是让人数零', () => {
    expect(formatMoney(1_440_000)).toBe('144 万')
    expect(formatMoney(301_000)).toBe('30.1 万')
    expect(formatMoney(0)).toBe('0 万')
    expect(formatMoney(Number.NaN)).toBe('—')
  })
})
