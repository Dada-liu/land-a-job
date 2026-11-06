/**
 * 税后估算（P6-2）。
 *
 * 目标不是精确报税，而是**让「总包 40 万」和「每月到手多少」不再混为一谈**。
 * 所有口径都随结果返回（`assumptions`），页面必须显示——估算器最危险的地方
 * 不是误差，而是让人以为那个数字是承诺。
 *
 * 口径（刻意保持朴素，便于用户自己复核）：
 * - 个税：年度综合所得七级累进，起征点 6 万/年，不含专项附加扣除（可传，默认 0）
 * - 五险一金：只算个人部分（养老 8% / 医疗 2% / 失业 0.5%）+ 公积金
 * - 缴费基数按当地上限截断（默认表为估算值，可覆盖）
 */

/** 年度综合所得税率表（速算扣除数为年额） */
export const TAX_BRACKETS = [
  { upTo: 36_000, rate: 0.03, quick: 0 },
  { upTo: 144_000, rate: 0.1, quick: 2_520 },
  { upTo: 300_000, rate: 0.2, quick: 16_920 },
  { upTo: 420_000, rate: 0.25, quick: 31_920 },
  { upTo: 660_000, rate: 0.3, quick: 52_920 },
  { upTo: 960_000, rate: 0.35, quick: 85_920 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.45, quick: 181_920 },
] as const

/** 起征点：6 万/年 */
export const BASIC_DEDUCTION = 60_000

/** 五险个人部分比例（公积金单列） */
export const SOCIAL_RATES = {
  pension: 0.08,
  medical: 0.02,
  unemployment: 0.005,
} as const

export const SOCIAL_RATE_TOTAL =
  SOCIAL_RATES.pension + SOCIAL_RATES.medical + SOCIAL_RATES.unemployment

export const DEFAULT_HOUSING_FUND_RATE = 0.07

/**
 * 社保缴费基数上限（元/月）。
 *
 * 这些是**估算值**（按各地社平工资 3 倍量级），只用于算「高薪时社保封顶」这一现象。
 * 真实值每年调整且各区不同，所以允许调用方覆盖，并写进 assumptions 提示用户核对。
 */
export const SOCIAL_BASE_CAPS: Record<string, number> = {
  北京: 35_283,
  上海: 36_549,
  深圳: 31_500,
  广州: 30_567,
  杭州: 24_930,
  成都: 21_264,
}

export const DEFAULT_SOCIAL_BASE_CAP = 25_000

export function socialBaseCap(city?: string | null): number {
  if (!city) return DEFAULT_SOCIAL_BASE_CAP
  // 「杭州市」「杭州 西湖」这类写法都要能命中
  for (const [name, cap] of Object.entries(SOCIAL_BASE_CAPS)) {
    if (city.includes(name)) return cap
  }
  return DEFAULT_SOCIAL_BASE_CAP
}

export interface TaxBracketHit {
  rate: number
  quick: number
  upTo: number
}

/** 年应纳税额（输入是应纳税所得额，已减去起征点与各项扣除） */
export function annualIncomeTax(taxableAnnual: number): { tax: number; bracket: TaxBracketHit } {
  if (!Number.isFinite(taxableAnnual) || taxableAnnual <= 0) {
    return { tax: 0, bracket: { rate: 0, quick: 0, upTo: 0 } }
  }
  const bracket = TAX_BRACKETS.find((item) => taxableAnnual <= item.upTo) ?? TAX_BRACKETS[TAX_BRACKETS.length - 1]!
  const tax = Math.max(0, taxableAnnual * bracket.rate - bracket.quick)
  return { tax, bracket: { rate: bracket.rate, quick: bracket.quick, upTo: bracket.upTo } }
}

export interface NetEstimateInput {
  baseMonthly: number
  /** 年发月数，影响年现金总额 */
  monthsPerYear?: number
  city?: string | null
  /** 公积金个人比例，默认 7% */
  housingFundRate?: number
  /** 专项附加扣除（年额），例如租房 1.8 万、子女教育 2.4 万 */
  specialDeductionAnnual?: number
  /** 覆盖当地社保基数上限 */
  socialBaseCap?: number
}

export interface NetEstimate {
  grossAnnual: number
  /** 个人部分五险（不含公积金） */
  socialAnnual: number
  /** 个人部分公积金（钱在你账户里，但不在到手现金里） */
  housingFundAnnual: number
  taxableAnnual: number
  taxAnnual: number
  /** 到手现金 = 税前 - 五险 - 公积金 - 个税 */
  netAnnual: number
  netMonthly: number
  /** 实际税负率 = (个税 + 五险 + 公积金) / 税前 */
  effectiveRate: number
  socialBaseCap: number
  taxRate: number
  assumptions: string[]
}

export function estimateNet(input: NetEstimateInput): NetEstimate {
  const baseMonthly = Math.max(0, input.baseMonthly || 0)
  const monthsPerYear = input.monthsPerYear && input.monthsPerYear > 0 ? input.monthsPerYear : 12
  const housingFundRate = Math.max(0, Math.min(0.12, input.housingFundRate ?? DEFAULT_HOUSING_FUND_RATE))
  const cap = input.socialBaseCap ?? socialBaseCap(input.city)
  const special = Math.max(0, input.specialDeductionAnnual ?? 0)

  const grossAnnual = baseMonthly * monthsPerYear
  // 缴费基数是月薪，但封顶；年终多发的月数不额外缴社保（口径简化，写进 assumptions）
  const socialMonthlyBase = Math.min(baseMonthly, cap)
  const socialAnnual = socialMonthlyBase * SOCIAL_RATE_TOTAL * 12
  const housingFundAnnual = socialMonthlyBase * housingFundRate * 12

  const taxableAnnual = Math.max(0, grossAnnual - BASIC_DEDUCTION - socialAnnual - housingFundAnnual - special)
  const { tax: taxAnnual, bracket } = annualIncomeTax(taxableAnnual)

  const netAnnual = grossAnnual - socialAnnual - housingFundAnnual - taxAnnual
  const netMonthly = monthsPerYear > 0 ? netAnnual / monthsPerYear : 0

  return {
    grossAnnual,
    socialAnnual,
    housingFundAnnual,
    taxableAnnual,
    taxAnnual,
    netAnnual,
    netMonthly,
    effectiveRate: grossAnnual > 0 ? (taxAnnual + socialAnnual + housingFundAnnual) / grossAnnual : 0,
    socialBaseCap: cap,
    taxRate: bracket.rate,
    assumptions: [
      `个税按年度综合所得七级累进、起征点 ${BASIC_DEDUCTION / 10_000} 万/年${special > 0 ? `，专项附加扣除 ${Math.round(special)}` : '，未计专项附加扣除'}`,
      `五险个人部分 养老 8% + 医疗 2% + 失业 0.5%，公积金 ${(housingFundRate * 100).toFixed(1)}%`,
      `缴费基数上限按 ${cap.toLocaleString('zh-CN')} 元/月估算（${input.city ?? '未填城市'}），实际以当地社保局为准`,
      '公积金个人部分进了你的账户，但不在到手现金里',
      '年终奖单独计税、股权激励等情形会有偏差；估算误差约 ±5%',
    ],
  }
}
