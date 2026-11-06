import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  COMPARE_DIMENSIONS,
  DEFAULT_WEIGHTS,
  DIMENSION_LABELS,
  QUALITATIVE_DIMENSIONS,
  compareOffers,
  formatMoney,
  type CompareDimension,
  type OfferComparisonRow,
} from '@land/core/offer'
import { estimateNet } from '@land/core/tax'
import {
  createOffer,
  listApplications,
  listOffers,
  patchOffer,
  type ApplicationListItemDto,
  type OfferDto,
} from '../lib/api'
import {
  housingFundRate,
  mergeQualitativeScores,
  readQualitativeScores,
  toOfferLike,
  type QualitativeScores,
} from '../lib/offer'
import { qk } from '../lib/queries'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { Drawer } from '../components/Drawer'
import { AgentHandoff } from '../components/AgentHandoff'
import { errorText, useToast } from '../components/Toast'

const STATUS_LABELS: Record<string, string> = {
  pending: '待答复',
  accepted: '已接受',
  declined: '已拒绝',
  expired: '已过期',
}

/** 滑块的初值直接来自默认权重，避免「文档写 45%、页面写 50%」两边漂移 */
const INITIAL_WEIGHTS = Object.fromEntries(
  COMPARE_DIMENSIONS.map((dimension) => [dimension, Math.round(DEFAULT_WEIGHTS[dimension] * 100)]),
) as Record<CompareDimension, number>

const QUALITATIVE_HINTS: Record<string, string> = {
  growth: '一年后你的能力/职级会不会明显不一样',
  wlb: '按你能接受的作息强度打分，5 = 几乎不加班',
  stability: '业务确定性、裁员风险、团队是否稳定',
}

const EMPTY_FORM = {
  applicationId: '',
  companyName: '',
  level: '',
  city: '',
  baseMonthly: '',
  monthsPerYear: '12',
  perfMonths: '0',
  signon: '0',
  equityShares: '0',
  equityStrike: '0',
  equityFmv: '0',
  vestYears: '4',
  cliffMonths: '12',
  housingFund: '7',
  subsidyMonthly: '0',
  deadline: '',
  decisionNote: '',
}

const num = (value: string): number => {
  const parsed = Number(value.replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function pct(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value * 100)}%`
}

function daysLeft(deadline: string | null): string {
  if (!deadline) return ''
  const diff = Math.ceil((Date.parse(deadline) - Date.now()) / 86_400_000)
  if (Number.isNaN(diff)) return ''
  if (diff < 0) return `已过期 ${-diff} 天`
  if (diff === 0) return '今天到期'
  return `还剩 ${diff} 天`
}

export default function Offers() {
  const client = useQueryClient()
  const toast = useToast()
  const [weights, setWeights] = useState<Record<CompareDimension, number>>(INITIAL_WEIGHTS)
  // 风险折扣与专项扣除是「视角」，只活在页面状态里：换视角不该污染数据
  const [riskFactor, setRiskFactor] = useState(50)
  const [specialDeduction, setSpecialDeduction] = useState(0)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<OfferDto | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const offers = useQuery({ queryKey: qk.offers, queryFn: () => listOffers({ limit: 50 }) })
  const applications = useQuery({ queryKey: qk.applications, queryFn: () => listApplications({ limit: 200 }) })

  const scoresById = useMemo(() => {
    const map = new Map<string, QualitativeScores>()
    for (const offer of offers.data ?? []) map.set(offer.id, readQualitativeScores(offer.assumptions))
    return map
  }, [offers.data])

  const comparison = useMemo(
    () =>
      compareOffers(
        (offers.data ?? []).map((offer) => toOfferLike(offer, scoresById.get(offer.id) ?? {})),
        { weights, riskFactor: riskFactor / 100 },
      ),
    [offers.data, scoresById, weights, riskFactor],
  )

  const offerById = useMemo(() => {
    const map = new Map<string, OfferDto>()
    for (const offer of offers.data ?? []) map.set(offer.id, offer)
    return map
  }, [offers.data])

  const appById = useMemo(() => {
    const map = new Map<string, ApplicationListItemDto>()
    for (const item of applications.data ?? []) map.set(item.id, item)
    return map
  }, [applications.data])

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: qk.offers })
    void client.invalidateQueries({ queryKey: qk.dashboard })
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        companyName: form.companyName.trim(),
        level: form.level || null,
        city: form.city || null,
        baseMonthly: num(form.baseMonthly),
        monthsPerYear: num(form.monthsPerYear) || 12,
        perfMonths: num(form.perfMonths),
        signon: num(form.signon),
        equityShares: Math.round(num(form.equityShares)),
        equityStrike: num(form.equityStrike),
        equityFmv: num(form.equityFmv),
        vestYears: num(form.vestYears) || 4,
        cliffMonths: num(form.cliffMonths),
        // 表单里按百分比填（7 = 7%），落库是 0.07
        housingFund: num(form.housingFund) / 100,
        subsidyMonthly: num(form.subsidyMonthly),
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        decisionNote: form.decisionNote || null,
      }
      return editing
        ? patchOffer(editing.id, payload)
        : createOffer({ applicationId: form.applicationId, ...payload })
    },
    onSuccess: () => {
      toast.push(editing ? 'Offer 已更新' : 'Offer 已记录', 'success')
      invalidate()
      setOpen(false)
    },
    onError: (error) => toast.push(`保存失败：${errorText(error)}`, 'error'),
  })

  const rate = useMutation({
    mutationFn: ({ offer, patch }: { offer: OfferDto; patch: Record<string, unknown> }) =>
      patchOffer(offer.id, patch),
    onSuccess: () => invalidate(),
    onError: (error) => toast.push(`评分失败：${errorText(error)}`, 'error'),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => patchOffer(id, { status }),
    onSuccess: () => {
      toast.push('已记录决定', 'success')
      invalidate()
    },
    onError: (error) => toast.push(`更新失败：${errorText(error)}`, 'error'),
  })

  const openCreate = () => {
    setEditing(null)
    const firstApp = (applications.data ?? []).find(
      (item) => !['rejected', 'ghosted', 'withdrawn'].includes(item.status),
    )
    setForm({
      ...EMPTY_FORM,
      applicationId: firstApp?.id ?? '',
      companyName: firstApp?.companyName ?? '',
    })
    setOpen(true)
  }

  const openEdit = (offer: OfferDto) => {
    setEditing(offer)
    setForm({
      applicationId: offer.applicationId,
      companyName: offer.companyName,
      level: offer.level ?? '',
      city: offer.city ?? '',
      baseMonthly: String(offer.baseMonthly),
      monthsPerYear: String(offer.monthsPerYear),
      perfMonths: String(offer.perfMonths),
      signon: String(offer.signon),
      equityShares: String(offer.equityShares),
      equityStrike: String(offer.equityStrike),
      equityFmv: String(offer.equityFmv),
      vestYears: String(offer.vestYears),
      cliffMonths: String(offer.cliffMonths),
      housingFund: String(Math.round(offer.housingFund * 1000) / 10),
      subsidyMonthly: String(offer.subsidyMonthly),
      deadline: offer.deadline ? offer.deadline.slice(0, 10) : '',
      decisionNote: offer.decisionNote ?? '',
    })
    setOpen(true)
  }

  const rateDimension = (offer: OfferDto, dimension: string, value: number) => {
    const scores = { ...readQualitativeScores(offer.assumptions) }
    const key = dimension as keyof QualitativeScores
    // 再点一次同一个分数＝取消评分。没有这一步，用户点错了只能改成 3 分糊过去
    if (scores[key] === value) delete scores[key]
    else scores[key] = value
    rate.mutate({ offer, patch: { assumptions: mergeQualitativeScores(offer.assumptions, scores) } })
  }

  const list = offers.data ?? []
  const activeApp = (applications.data ?? []).filter(
    (item) => !['rejected', 'ghosted', 'withdrawn'].includes(item.status),
  )
  const totalWeight = COMPARE_DIMENSIONS.reduce((sum, dimension) => sum + weights[dimension], 0)

  if (offers.status === 'pending') return <div className="p-2 text-sm text-stone-400">读取中…</div>
  if (offers.status === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Offer 读取失败：{errorText(offers.error)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Offer 对比"
        description="两份 offer 比薪水，只看月薪会吃亏：这里按 4 年总包、扣完税来比。改一个数字立刻重算，每笔钱怎么来的都写在下面。"
        actions={
          <>
            <Button onClick={() => setWeights(INITIAL_WEIGHTS)}>恢复默认权重</Button>
            <Button variant="primary" data-testid="offer-new" onClick={openCreate}>
              记录 Offer
            </Button>
          </>
        }
      />

      {list.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            title="还没有 Offer"
            hint="口头 offer 也能先记下来：月薪、一年发几个月、签字费、期权、公积金比例。不确定的先空着，缺的部分按 0 算，下面会注明。"
            action={
              <Button variant="primary" onClick={openCreate}>
                记录第一个 Offer
              </Button>
            }
          />
        </Card>
      ) : null}

      {list.length > 0 ? (
        <>
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium text-stone-900">你更看重什么</h3>
              <span className="text-[11px] text-stone-400">
                合计 {totalWeight}%（会按比例折算）· 期权按 {(riskFactor / 100).toFixed(2)} 算钱
              </span>
            </div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {COMPARE_DIMENSIONS.map((dimension) => (
                <label key={dimension} className="block">
                  <span className="flex items-baseline justify-between text-[11px] text-stone-600">
                    <span>{DIMENSION_LABELS[dimension]}</span>
                    <span className="font-mono text-stone-900">{weights[dimension]}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={weights[dimension]}
                    data-testid={`weight-${dimension}`}
                    onChange={(event) => setWeights({ ...weights, [dimension]: Number(event.target.value) })}
                    className="mt-1 w-full accent-stone-900"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 border-t border-stone-100 pt-3 sm:grid-cols-2">
              <label className="block">
                <span className="flex items-baseline justify-between text-[11px] text-stone-600">
                  <span>期权值多少（0 = 当它不存在，1 = 全额算钱）</span>
                  <span className="font-mono text-stone-900">{(riskFactor / 100).toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={riskFactor}
                  data-testid="risk-factor"
                  onChange={(event) => setRiskFactor(Number(event.target.value))}
                  className="mt-1 w-full accent-stone-900"
                />
              </label>
              <Field label="专项附加扣除（元/年，用来估税后）" hint="租房一年 18000、子女教育一年 24000、赡养老人一年 24000，可以叠加。不确定就填 0，只是税后会估得保守一点。">
                <Input
                  data-testid="special-deduction"
                  value={String(specialDeduction)}
                  inputMode="numeric"
                  onChange={(event) => setSpecialDeduction(num(event.target.value))}
                />
              </Field>
            </div>
          </Card>

          <AgentHandoff
            skill="offer-decide"
            title="让 Agent 帮我决策 / 谈薪"
            instruction={[
              '用 offer-decide skill 帮我对比这几份 offer。',
              ...list.map((offer) => `- ${offer.companyName}：offerId ${offer.id}（state: ${offer.status}）`),
              '先用 get_offer / compare_offers 复述总包怎么算（4 年、期权折后、税后），',
              '再给倾向与理由，最后给谈薪锚点、区间与反驳素材。',
              '不要替我拍板，也不要编造市场上的薪资数据；没有把握的地方直接说不确定。',
            ].join('\n')}
            steps={[
              { label: '复制后粘到 Agent，它会按同一套算法再算一遍', hint: '和这页算出来的数一样' },
              { label: '谈完把结论记回这页的「决策备注」' },
            ]}
            note="钱还是在这台电脑上算。Agent 只帮你理理由、想话术，它手里没有外部薪资数据。"
            onDone={() => {
              void client.invalidateQueries({ queryKey: qk.offers })
              toast.push('已刷新', 'success')
            }}
          />

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50 text-[11px] text-stone-500">
                    <th className="w-8 px-3 py-2 text-left font-normal">#</th>
                    <th className="px-3 py-2 text-left font-normal">公司</th>
                    <th className="px-3 py-2 text-right font-normal">4 年总包</th>
                    <th className="px-3 py-2 text-right font-normal">年现金</th>
                    <th className="px-3 py-2 text-right font-normal">首年现金</th>
                    <th className="px-3 py-2 text-right font-normal">期权（4 年折后）</th>
                    <th className="px-3 py-2 text-right font-normal">公积金/年</th>
                    <th className="px-3 py-2 text-right font-normal">税后月均</th>
                    <th className="px-3 py-2 text-right font-normal">加权分</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row, index) => {
                    const offer = offerById.get(row.id)
                    const net = offer
                      ? estimateNet({
                          baseMonthly: offer.baseMonthly,
                          monthsPerYear: offer.monthsPerYear,
                          city: offer.city,
                          housingFundRate: housingFundRate(offer),
                          specialDeductionAnnual: specialDeduction,
                        })
                      : null
                    return (
                      <tr
                        key={row.id}
                        data-testid="offer-row"
                        data-offer-id={row.id}
                        className="border-b border-stone-100 last:border-0 hover:bg-stone-50/60"
                      >
                        <td className="px-3 py-2 font-mono text-stone-400">{index + 1}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-stone-900">{row.companyName}</div>
                          <div className="text-[10px] text-stone-400">
                            {STATUS_LABELS[offer?.status ?? 'pending'] ?? offer?.status}
                            {offer?.level ? ` · ${offer.level}` : ''}
                            {offer?.city ? ` · ${offer.city}` : ''}
                            {offer ? ` · ${daysLeft(offer.deadline)}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-stone-900">{formatMoney(row.breakdown.fourYearTotal)}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600">{formatMoney(row.breakdown.annualCash)}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600">{formatMoney(row.breakdown.firstYearCash)}</td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600">
                          {row.scores.equity === null ? '—' : formatMoney(row.breakdown.equityFourYear)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600">
                          {row.scores.welfare === null ? '—' : formatMoney(row.breakdown.housingFundAnnual)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-stone-600">
                          {net ? `${formatMoney(net.netMonthly)}/月` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            data-testid="offer-total-score"
                            data-offer-id={row.id}
                            className="font-mono text-stone-900"
                          >
                            {(row.totalScore * 100).toFixed(0)}
                          </span>
                          <span className="ml-1 inline-block h-1.5 w-10 overflow-hidden rounded-full bg-stone-100 align-middle">
                            <span
                              className="block h-full rounded-full bg-stone-800"
                              style={{ width: `${Math.round(row.totalScore * 100)}%` }}
                            />
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-stone-100 px-4 py-2.5 text-[11px] leading-relaxed text-stone-400">
              分数 0–100，只用来排序，不代表「哪份更好」。怎么算的：
              <details className="inline-block align-top" data-testid="compare-assumptions">
                <summary className="cursor-pointer text-stone-500 hover:text-stone-700">展开</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {comparison.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {comparison.rows.map((row) => {
              const offer = offerById.get(row.id)
              if (!offer) return null
              return (
                <OfferCard
                  key={row.id}
                  row={row}
                  offer={offer}
                  scores={scoresById.get(row.id) ?? {}}
                  specialDeduction={specialDeduction}
                  busy={rate.isPending}
                  onRate={(dimension, value) => rateDimension(offer, dimension, value)}
                  onEdit={() => openEdit(offer)}
                  onStatus={(status) => setStatus.mutate({ id: offer.id, status })}
                />
              )
            })}
          </div>
        </>
      ) : null}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `编辑 ${editing.companyName}` : '记录 Offer'}
        subtitle="金额都填税前、以元为单位；公积金填百分比，7 就是 7%"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              variant="primary"
              data-testid="offer-save"
              disabled={(!editing && !form.applicationId) || form.companyName.trim().length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {editing ? null : (
            <Field label="关联投递" hint="挂到哪次投递上，「投了几份、拿到几个 offer」才算得出来。">
              <Select
                data-testid="offer-application"
                value={form.applicationId}
                onChange={(event) => {
                  const app = appById.get(event.target.value)
                  setForm({
                    ...form,
                    applicationId: event.target.value,
                    companyName: app?.companyName ?? form.companyName,
                  })
                }}
              >
                <option value="">选择一条投递</option>
                {activeApp.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.companyName} · {item.jobTitle}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="公司">
              <Input
                data-testid="offer-company"
                value={form.companyName}
                onChange={(event) => setForm({ ...form, companyName: event.target.value })}
              />
            </Field>
            <Field label="职级">
              <Input value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="月薪（元）">
              <Input
                data-testid="offer-base"
                value={form.baseMonthly}
                inputMode="numeric"
                onChange={(event) => setForm({ ...form, baseMonthly: event.target.value })}
              />
            </Field>
            <Field label="年发月数" hint="一般 12 / 13 / 15">
              <Input
                value={form.monthsPerYear}
                inputMode="numeric"
                onChange={(event) => setForm({ ...form, monthsPerYear: event.target.value })}
              />
            </Field>
            <Field label="绩效月数" hint="平均能拿到几个月，不确定就填 0">
              <Input
                data-testid="offer-perf"
                value={form.perfMonths}
                inputMode="decimal"
                onChange={(event) => setForm({ ...form, perfMonths: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="签字费">
              <Input
                data-testid="offer-signon"
                value={form.signon}
                inputMode="numeric"
                onChange={(event) => setForm({ ...form, signon: event.target.value })}
              />
            </Field>
            <Field label="补贴（元/月）">
              <Input value={form.subsidyMonthly} inputMode="numeric" onChange={(event) => setForm({ ...form, subsidyMonthly: event.target.value })} />
            </Field>
            <Field label="公积金（%）">
              <Input
                data-testid="offer-housing-fund"
                value={form.housingFund}
                inputMode="decimal"
                onChange={(event) => setForm({ ...form, housingFund: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <Field label="期权股数">
              <Input
                data-testid="offer-equity-shares"
                value={form.equityShares}
                inputMode="numeric"
                onChange={(event) => setForm({ ...form, equityShares: event.target.value })}
              />
            </Field>
            <Field label="行权价">
              <Input
                data-testid="offer-equity-strike"
                value={form.equityStrike}
                inputMode="decimal"
                onChange={(event) => setForm({ ...form, equityStrike: event.target.value })}
              />
            </Field>
            <Field label="FMV">
              <Input
                data-testid="offer-equity-fmv"
                value={form.equityFmv}
                inputMode="decimal"
                onChange={(event) => setForm({ ...form, equityFmv: event.target.value })}
              />
            </Field>
            <Field label="归属年数">
              <Input value={form.vestYears} inputMode="numeric" onChange={(event) => setForm({ ...form, vestYears: event.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="城市" hint="社保基数上限跟城市走，影响税后">
              <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
            <Field label="答复截止">
              <Input type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
            </Field>
            <Field label="锁定期（月）">
              <Input value={form.cliffMonths} inputMode="numeric" onChange={(event) => setForm({ ...form, cliffMonths: event.target.value })} />
            </Field>
          </div>
          <Field label="决策备注" hint="当时在纠结什么，就写下来。两周后回看，这些才是真正影响你的理由。">
            <Textarea
              rows={3}
              value={form.decisionNote}
              onChange={(event) => setForm({ ...form, decisionNote: event.target.value })}
            />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}

function OfferCard({
  row,
  offer,
  scores,
  specialDeduction,
  busy,
  onRate,
  onEdit,
  onStatus,
}: {
  row: OfferComparisonRow
  offer: OfferDto
  scores: QualitativeScores
  specialDeduction: number
  /** 上一次评分还在落库：先禁用按钮，否则连点两次会拿着旧 assumptions 覆盖刚写的那一维 */
  busy: boolean
  onRate: (dimension: string, value: number) => void
  onEdit: () => void
  onStatus: (status: string) => void
}) {
  const net = estimateNet({
    baseMonthly: offer.baseMonthly,
    monthsPerYear: offer.monthsPerYear,
    city: offer.city,
    housingFundRate: housingFundRate(offer),
    specialDeductionAnnual: specialDeduction,
  })

  return (
    <Card className="p-4" data-testid="offer-card" data-offer-id={offer.id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">{offer.companyName}</h3>
          <div className="text-[11px] text-stone-400">
            {STATUS_LABELS[offer.status] ?? offer.status}
            {offer.city ? ` · ${offer.city}` : ''}
            {offer.level ? ` · ${offer.level}` : ''}
            {offer.deadline ? ` · ${daysLeft(offer.deadline)}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-stone-400">加权分</div>
          <div className="font-mono text-lg leading-none text-stone-900" data-testid="offer-card-score">
            {(row.totalScore * 100).toFixed(0)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        {COMPARE_DIMENSIONS.map((dimension) => {
          const score = row.scores[dimension]
          return (
            <div key={dimension} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-stone-500">{DIMENSION_LABELS[dimension]}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
                <span className="block h-full rounded-full bg-stone-700" style={{ width: `${Math.round((score ?? 0) * 100)}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right font-mono text-stone-600">{pct(score)}</span>
            </div>
          )
        })}
      </div>

      <div className="mt-3 rounded-lg bg-stone-50 p-3">
        <div className="mb-1.5 text-[11px] font-medium text-stone-600">税后估算</div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-stone-600">
          <span>
            月到手{' '}
            <span className="font-mono text-sm text-stone-900" data-testid="offer-net-monthly">
              {formatMoney(net.netMonthly)}
            </span>
          </span>
          <span>
            年到手 <span className="font-mono text-stone-900">{formatMoney(net.netAnnual)}</span>
          </span>
          <span>
            综合扣除 <span className="font-mono text-stone-900">{(net.effectiveRate * 100).toFixed(1)}%</span>
          </span>
        </div>
        <details className="mt-1.5" data-testid="offer-tax-assumptions">
          <summary className="cursor-pointer text-[10px] text-stone-400 hover:text-stone-600">怎么算的（{net.assumptions.length} 条）</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] leading-relaxed text-stone-500">
            {net.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-medium text-stone-600">定性判断（1–5，未评不计入总分）</div>
        <div className="space-y-1.5">
          {QUALITATIVE_DIMENSIONS.map((dimension) => (
            <div key={dimension} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[11px] text-stone-500" title={QUALITATIVE_HINTS[dimension]}>
                {DIMENSION_LABELS[dimension]}
              </span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={`rate-${dimension}-${value}`}
                    disabled={busy}
                    onClick={() => onRate(dimension, value)}
                    className={`h-6 w-6 rounded border text-[10px] transition-colors disabled:cursor-wait ${
                      scores[dimension] === value
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-200 bg-white text-stone-500 hover:border-stone-400'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              {scores[dimension] === undefined ? (
                <span className="text-[10px] text-stone-400">未评</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onRate(dimension, scores[dimension] ?? 0)}
                  className="text-[10px] text-stone-400 hover:text-stone-600"
                >
                  清除
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 border-t border-stone-100 pt-2.5">
        <details data-testid="offer-assumptions">
          <summary className="cursor-pointer text-[11px] text-stone-500 hover:text-stone-700">总包是怎么算的</summary>
          <ul className="mt-1.5 space-y-0.5 text-[11px] text-stone-600">
            <li>年现金 {formatMoney(row.breakdown.annualCash)}（{offer.monthsPerYear} 个月 + 绩效 {offer.perfMonths} 个月 + 补贴）</li>
            <li>首年现金 {formatMoney(row.breakdown.firstYearCash)}（含签字费 {formatMoney(offer.signon)}）</li>
            <li>
              期权年化 {formatMoney(row.breakdown.equityAnnual)} · 4 年折后 {formatMoney(row.breakdown.equityFourYear)}
            </li>
            <li>公积金 {formatMoney(row.breakdown.housingFundAnnual)}/年（个人 + 单位，不计入总包）</li>
          </ul>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] leading-relaxed text-stone-400">
            {row.breakdown.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
            {row.notes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
        {offer.decisionNote ? (
          <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-stone-500">{offer.decisionNote}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button onClick={onEdit} data-testid="offer-edit">
            编辑数字
          </Button>
          <Button
            data-testid="offer-accept"
            disabled={offer.status === 'accepted'}
            onClick={() => onStatus('accepted')}
          >
            接受
          </Button>
          <Button
            data-testid="offer-decline"
            disabled={offer.status === 'declined'}
            onClick={() => onStatus('declined')}
          >
            拒绝
          </Button>
          {offer.status === 'pending' ? (
            <Button onClick={() => onStatus('expired')}>已过期</Button>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
