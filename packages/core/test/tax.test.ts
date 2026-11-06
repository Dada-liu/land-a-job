import { describe, expect, it } from 'vitest'
import {
  BASIC_DEDUCTION,
  SOCIAL_RATE_TOTAL,
  annualIncomeTax,
  estimateNet,
  socialBaseCap,
} from '../src/tax.js'

describe('annualIncomeTax：七级累进的边界', () => {
  it('应纳税所得额为 0 或负数时税额为 0', () => {
    expect(annualIncomeTax(0).tax).toBe(0)
    expect(annualIncomeTax(-5000).tax).toBe(0)
  })

  it('3.6 万边界：恰好 3% 档顶格', () => {
    expect(annualIncomeTax(36_000).tax).toBeCloseTo(1_080, 2)
    expect(annualIncomeTax(36_000).bracket.rate).toBe(0.03)
  })

  it('刚过 3.6 万就跳到 10% 档，但因为速算扣除，税额连续', () => {
    const below = annualIncomeTax(36_000).tax
    const above = annualIncomeTax(36_001).tax
    expect(above).toBeGreaterThan(below)
    // 跨档不该出现税额断层（速算扣除数的存在意义）
    expect(above - below).toBeLessThan(1)
    expect(annualIncomeTax(36_001).bracket.rate).toBe(0.1)
  })

  it('14.4 万 / 30 万 / 42 万 / 66 万 / 96 万各档顶格与速算扣除对得上', () => {
    const cases: [number, number, number][] = [
      [144_000, 0.1, 2_520],
      [300_000, 0.2, 16_920],
      [420_000, 0.25, 31_920],
      [660_000, 0.3, 52_920],
      [960_000, 0.35, 85_920],
    ]
    for (const [taxable, rate, quick] of cases) {
      const hit = annualIncomeTax(taxable)
      expect(hit.bracket.rate).toBe(rate)
      expect(hit.tax).toBeCloseTo(taxable * rate - quick, 2)
    }
  })

  it('超过 96 万走 45% 档', () => {
    const hit = annualIncomeTax(1_200_000)
    expect(hit.bracket.rate).toBe(0.45)
    expect(hit.tax).toBeCloseTo(1_200_000 * 0.45 - 181_920, 2)
  })

  it('税额单调递增', () => {
    let previous = 0
    for (let taxable = 0; taxable <= 1_000_000; taxable += 10_000) {
      const tax = annualIncomeTax(taxable).tax
      expect(tax).toBeGreaterThanOrEqual(previous)
      previous = tax
    }
  })
})

describe('socialBaseCap：按城市取缴费上限', () => {
  it('常见城市命中，未知城市回落到默认值', () => {
    expect(socialBaseCap('杭州')).toBeGreaterThan(20_000)
    expect(socialBaseCap('杭州市西湖区')).toBe(socialBaseCap('杭州'))
    expect(socialBaseCap('某个小城')).toBe(25_000)
    expect(socialBaseCap(null)).toBe(25_000)
  })
})

describe('estimateNet：到手现金', () => {
  const caseA = estimateNet({ baseMonthly: 30_000, monthsPerYear: 12, city: '杭州' })

  it('四个分项加总等于税前（不能凭空多出或少掉钱）', () => {
    const sum = caseA.socialAnnual + caseA.housingFundAnnual + caseA.taxAnnual + caseA.netAnnual
    expect(sum).toBeCloseTo(caseA.grossAnnual, 2)
  })

  it('年现金 36 万在杭州的估算：税后月到手约 2.3 万', () => {
    expect(caseA.grossAnnual).toBe(360_000)
    // 手工核算：社保 24930×10.5%×12=31411.8；公积金 24930×7%×12=20941.2
    expect(caseA.socialAnnual).toBeCloseTo(31_411.8, 1)
    expect(caseA.housingFundAnnual).toBeCloseTo(20_941.2, 1)
    const taxable = 360_000 - BASIC_DEDUCTION - caseA.socialAnnual - caseA.housingFundAnnual
    expect(caseA.taxableAnnual).toBeCloseTo(taxable, 1)
    expect(caseA.netMonthly).toBeGreaterThan(22_000)
    expect(caseA.netMonthly).toBeLessThan(24_000)
    expect(caseA.effectiveRate).toBeGreaterThan(0.2)
    expect(caseA.effectiveRate).toBeLessThan(0.3)
  })

  it('高薪时社保封顶：月薪翻倍不等于社保翻倍', () => {
    const low = estimateNet({ baseMonthly: 24_930, city: '杭州' })
    const high = estimateNet({ baseMonthly: 100_000, city: '杭州' })
    expect(high.socialAnnual).toBeCloseTo(low.socialAnnual, 1)
    expect(high.taxAnnual).toBeGreaterThan(low.taxAnnual)
  })

  it('专项附加扣除能降低税负', () => {
    const withDeduction = estimateNet({ baseMonthly: 30_000, city: '杭州', specialDeductionAnnual: 24_000 })
    expect(withDeduction.taxAnnual).toBeLessThan(caseA.taxAnnual)
    expect(withDeduction.netAnnual).toBeGreaterThan(caseA.netAnnual)
  })

  it('零收入不产生负税', () => {
    const zero = estimateNet({ baseMonthly: 0 })
    expect(zero.grossAnnual).toBe(0)
    expect(zero.taxAnnual).toBe(0)
    expect(zero.netAnnual).toBe(0)
    expect(zero.effectiveRate).toBe(0)
  })

  it('口径必须随结果返回', () => {
    const text = caseA.assumptions.join('\n')
    expect(text).toContain('个税')
    expect(text).toContain('公积金')
    expect(text).toContain('缴费基数上限')
    expect(text).toContain('±5%')
    expect(caseA.assumptions.length).toBeGreaterThanOrEqual(4)
  })

  it('五险比例常量与口径文案一致', () => {
    expect(SOCIAL_RATE_TOTAL).toBeCloseTo(0.105, 5)
    expect(caseA.socialAnnual).toBeCloseTo(Math.min(30_000, 24_930) * SOCIAL_RATE_TOTAL * 12, 2)
  })
})
