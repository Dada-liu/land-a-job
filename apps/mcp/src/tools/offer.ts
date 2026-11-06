import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  COMPARE_DIMENSIONS,
  DEFAULT_WEIGHTS,
  OFFER_STATUSES,
  compareOffers,
  formatMoney,
  offerBreakdown,
  type OfferLike,
} from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'
import { qs } from './shared.js'

interface OfferRow extends Record<string, unknown> {
  id: string
  applicationId: string
  companyName: string
  baseMonthly: number
  monthsPerYear: number
  perfMonths: number
  subsidyMonthly: number
  signon: number
  equityShares: number
  equityStrike: number
  equityFmv: number
  vestYears: number
  housingFund: number
  status: string
  deadline: string | null
  assumptions?: Record<string, unknown> | null
  decisionNote?: string | null
}

const toOfferLike = (row: OfferRow): OfferLike => ({
  id: row.id,
  companyName: row.companyName,
  baseMonthly: row.baseMonthly,
  monthsPerYear: row.monthsPerYear,
  perfMonths: row.perfMonths,
  subsidyMonthly: row.subsidyMonthly,
  signon: row.signon,
  equityShares: row.equityShares,
  equityStrike: row.equityStrike,
  equityFmv: row.equityFmv,
  vestYears: row.vestYears,
  housingFund: row.housingFund,
  manualScores: (row.assumptions?.manualScores ?? null) as OfferLike['manualScores'],
})

const weightsShape = Object.fromEntries(
  COMPARE_DIMENSIONS.map((key) => [key, z.number().min(0).max(1).optional()]),
) as Record<(typeof COMPARE_DIMENSIONS)[number], z.ZodOptional<z.ZodNumber>>

export function registerOfferTools(server: McpServer): void {
  server.registerTool(
    'create_offer',
    {
      title: '登记 offer',
      description:
        '登记一份 offer 的薪酬结构（月薪/月数/绩效/签字费/期权/公积金）。金额单位一律「元/月」整数。',
      inputSchema: {
        applicationId: z.string().min(1),
        companyName: z.string().min(1).max(120),
        level: z.string().optional(),
        city: z.string().optional(),
        baseMonthly: z.number().int().min(0).describe('月薪，单位元'),
        monthsPerYear: z.number().int().min(1).max(24).optional().describe('年发月数，默认 12'),
        perfMonths: z.number().min(0).max(24).optional().describe('绩效月数，可 0.5'),
        signon: z.number().int().min(0).optional(),
        equityShares: z.number().int().min(0).optional(),
        equityStrike: z.number().min(0).optional(),
        equityFmv: z.number().min(0).optional(),
        vestYears: z.number().int().min(1).max(10).optional(),
        housingFund: z.number().min(0).max(1).optional().describe('公积金比例，0.07 = 7%'),
        subsidyMonthly: z.number().int().min(0).optional(),
        deadline: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const offer = await client.post<OfferRow>('/offers', input)
        const breakdown = offerBreakdown(toOfferLike(offer))
        return ok(
          {
            id: offer.id,
            fourYearTotal: breakdown.fourYearTotal,
            fourYearTotalText: formatMoney(breakdown.fourYearTotal),
            assumptions: breakdown.assumptions,
          },
          { nextActions: ['compare_offers 拿多份对比', 'get_negotiation_brief 要谈判素材'] },
        )
      }),
  )

  server.registerTool(
    'list_offers',
    {
      title: 'offer 列表',
      description: '列出 offer 与其 4 年总包（基准口径：未计涨薪、期权按 FMV × 风险折扣）。',
      inputSchema: {
        status: z.enum(OFFER_STATUSES).optional(),
        limit: z.number().int().min(1).max(50).optional().default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const rows = await client.get<OfferRow[]>(`/offers${qs(input)}`)
        return ok({
          count: rows.length,
          offers: rows.map((row) => {
            const breakdown = offerBreakdown(toOfferLike(row))
            return {
              id: row.id,
              companyName: row.companyName,
              status: row.status,
              deadline: row.deadline,
              fourYearTotal: breakdown.fourYearTotal,
              fourYearTotalText: formatMoney(breakdown.fourYearTotal),
            }
          }),
        })
      }),
  )

  server.registerTool(
    'update_offer',
    {
      title: '更新 offer',
      description: '改薪酬组件、状态或决策备注。假设置信度相关的内容写 assumptions。',
      inputSchema: {
        id: z.string().min(1),
        baseMonthly: z.number().int().min(0).optional(),
        monthsPerYear: z.number().int().min(1).max(24).optional(),
        perfMonths: z.number().min(0).max(24).optional(),
        signon: z.number().int().min(0).optional(),
        equityShares: z.number().int().min(0).optional(),
        equityStrike: z.number().min(0).optional(),
        equityFmv: z.number().min(0).optional(),
        vestYears: z.number().int().min(1).max(10).optional(),
        housingFund: z.number().min(0).max(1).optional(),
        subsidyMonthly: z.number().int().min(0).optional(),
        deadline: z.string().nullable().optional(),
        status: z.enum(OFFER_STATUSES).optional(),
        assumptions: z.record(z.string(), z.unknown()).optional(),
        decisionNote: z.string().max(8000).nullable().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, ...patch }) =>
      guard(async () => {
        const offer = await client.patch<OfferRow>(`/offers/${id}`, patch)
        const breakdown = offerBreakdown(toOfferLike(offer))
        return ok({ id: offer.id, fourYearTotal: breakdown.fourYearTotal, changed: Object.keys(patch) })
      }),
  )

  server.registerTool(
    'compare_offers',
    {
      title: '对比 offer',
      description:
        '先算后说：返回每份的 4 年现金/期权/福利与归一化分数、排序、以及口径假设。定性维度（成长/强度/稳定性）只认人工评分，没评分就不计入并重分配权重——不要替用户编分数。',
      inputSchema: {
        ids: z.array(z.string().min(1)).optional().describe('只比这几份；不传则比全部待定 offer'),
        weights: z.object(weightsShape).optional().describe(`各维度权重，默认 ${JSON.stringify(DEFAULT_WEIGHTS)}`),
        riskFactor: z.number().min(0).max(1).optional().describe('期权风险折扣，默认 0.5；不认期权填 0'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ ids, weights, riskFactor }) =>
      guard(async () => {
        const rows = await client.get<OfferRow[]>(`/offers${qs({ limit: 50 })}`)
        const pool = ids && ids.length > 0 ? rows.filter((row) => ids.includes(row.id)) : rows
        if (pool.length === 0) {
          return ok({ rows: [], note: '没有可比对的 offer：先 create_offer 或检查 ids' })
        }
        const result = compareOffers(pool.map(toOfferLike), { weights, riskFactor })
        return ok({
          ranked: result.rows.map((row, index) => ({
            rank: index + 1,
            companyName: row.companyName,
            id: row.id,
            totalScore: row.totalScore,
            fourYearCash: row.breakdown.fourYearCash,
            fourYearCashText: formatMoney(row.breakdown.fourYearCash),
            equityFourYear: row.breakdown.equityFourYear,
            fourYearTotal: row.breakdown.fourYearTotal,
            fourYearTotalText: formatMoney(row.breakdown.fourYearTotal),
            usedDimensions: row.usedDimensions,
            notes: row.notes,
          })),
          weights: result.weights,
          assumptions: result.assumptions,
          caveat: '排序只是把权重算出来；把权重当什么很重要这件事，要由用户决定',
        })
      }),
  )

  server.registerTool(
    'get_negotiation_brief',
    {
      title: '谈判素材',
      description:
        '给出可谈判项与量化锚点（月薪、签字费、期权、绩效月数各值多少钱），以及目标区间的计算依据。话术由你组织，但数字只能用这里返回的。',
      inputSchema: {
        offerId: z.string().min(1),
        targetTotal: z.number().min(0).optional().describe('用户希望达到的 4 年总包，用于反推缺口'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ offerId, targetTotal }) =>
      guard(async () => {
        const offer = await client.get<OfferRow>(`/offers/${offerId}`)
        const breakdown = offerBreakdown(toOfferLike(offer))
        const gap = targetTotal ? targetTotal - breakdown.fourYearTotal : null

        return ok({
          offer: { id: offer.id, companyName: offer.companyName, status: offer.status, deadline: offer.deadline },
          breakdown: {
            annualCash: breakdown.annualCash,
            firstYearCash: breakdown.firstYearCash,
            fourYearCash: breakdown.fourYearCash,
            fourYearTotal: breakdown.fourYearTotal,
            fourYearTotalText: formatMoney(breakdown.fourYearTotal),
          },
          /** 每个杠杆「动 1 个单位值多少钱」，谈判时按性价比排序用 */
          levers: [
            { lever: '月薪 +1000', fourYearImpact: 1000 * (offer.monthsPerYear + offer.perfMonths) * 4, note: '复利最猛的一档' },
            { lever: '签字费 +1 万', fourYearImpact: 10_000, note: '一次性，不进基数' },
            { lever: '绩效月数 +1', fourYearImpact: offer.baseMonthly * 4, note: '取决于绩效达成，不一定兑现' },
            {
              lever: '期权 +1000 股',
              fourYearImpact: Math.max(0, offer.equityFmv - offer.equityStrike) * 1000 * 4 * 0.5,
              note: '已按 0.5 风险折扣折算',
            },
          ],
          gap: gap === null ? null : { targetTotal, gap, achievableBy: gap > 0 ? '先谈月薪（复利最大），再谈签字费补缺口' : '已达目标，重点转为确认兑现条件与书面化' },
          assumptions: breakdown.assumptions,
          mustState: ['所有数字为税前、未计涨薪', '期权价值取决于公司前景，必须明示风险折扣'],
        })
      }),
  )
}
