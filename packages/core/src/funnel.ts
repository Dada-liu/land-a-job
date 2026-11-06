/**
 * 漏斗与转化率（ARCHITECTURE 5.1 / 5.2）。
 *
 * 关键口径：按「到达过该阶段」统计，而不是「当前停在该阶段」。
 * 一个人进了 3 轮面试后又挂了，若按当前状态算，漏斗会在 interview 处凭空少一格，
 * 于是「简历 → 面试转化率」永远偏低，优化方向也就跟着错。
 */

import { STAGE_ORDER, type Status } from './application.js'

export const FUNNEL_STAGES = ['applied', 'screening', 'assessment', 'interview', 'offer', 'accepted'] as const
export type FunnelStage = (typeof FUNNEL_STAGES)[number]

export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  applied: '已投递',
  screening: '筛选中',
  assessment: '笔试/作业',
  interview: '面试',
  offer: 'Offer',
  accepted: '已接受',
}

export interface FunnelApplication {
  id: string
  status: string
  appliedAt?: string | null
  createdAt?: string
}

export interface FunnelEvent {
  applicationId: string
  /** application_event.to_status，note 类事件为 null */
  toStatus: string | null
}

export interface FunnelStep {
  stage: FunnelStage
  label: string
  /** 到达过该阶段的投递数（按 application 去重） */
  reached: number
  /** 相对上一阶段的转化率（0..1）；首阶段为 null */
  conversion: number | null
  /** 相对上一阶段的流失率 */
  dropRate: number | null
  /** 相对首阶段（已投递）的留存率 */
  retention: number | null
}

export interface FunnelResult {
  steps: FunnelStep[]
  /** 参与统计的投递总数（软删的不算） */
  total: number
  /** offer / applied，没投递时为 null 而不是 0 —— 0 会被误读成「投了但全挂」 */
  offerRate: number | null
}

function stageOrder(status: string | null | undefined): number {
  if (!status) return -1
  return STAGE_ORDER[status as Status] ?? -1
}

/**
 * 单条投递到达过的最高阶段序。
 *
 * 用「最高序」而不是「命中集合」：状态机允许 applied → interview 直跳，
 * 但业务上既然进了面试，就一定过了筛选，否则漏斗会出现「面试数 > 筛选数」的怪象。
 */
function maxStage(app: FunnelApplication, events: FunnelEvent[]): number {
  let max = stageOrder(app.status)
  for (const event of events) {
    if (event.applicationId !== app.id) continue
    max = Math.max(max, stageOrder(event.toStatus))
  }
  // 有 appliedAt 但状态被误标成 lead/queued 的历史数据，仍算「投过」
  if (max < STAGE_ORDER.applied! && app.appliedAt) max = STAGE_ORDER.applied!
  return max
}

export function buildFunnel(applications: FunnelApplication[], events: FunnelEvent[] = []): FunnelResult {
  const byApp = new Map<string, FunnelEvent[]>()
  for (const event of events) {
    const list = byApp.get(event.applicationId)
    if (list) list.push(event)
    else byApp.set(event.applicationId, [event])
  }

  const reachedByStage = new Map<FunnelStage, number>()
  for (const stage of FUNNEL_STAGES) reachedByStage.set(stage, 0)

  for (const app of applications) {
    const order = maxStage(app, byApp.get(app.id) ?? [])
    for (const stage of FUNNEL_STAGES) {
      if (order >= (STAGE_ORDER[stage] ?? Infinity)) {
        reachedByStage.set(stage, (reachedByStage.get(stage) ?? 0) + 1)
      }
    }
  }

  const base = reachedByStage.get('applied') ?? 0
  const steps: FunnelStep[] = FUNNEL_STAGES.map((stage, index) => {
    const reached = reachedByStage.get(stage) ?? 0
    const previous = index === 0 ? null : (reachedByStage.get(FUNNEL_STAGES[index - 1]!) ?? 0)
    const conversion = previous === null ? null : previous === 0 ? null : reached / previous
    return {
      stage,
      label: FUNNEL_LABELS[stage],
      reached,
      conversion,
      dropRate: conversion === null ? null : 1 - conversion,
      retention: index === 0 || base === 0 ? null : reached / base,
    }
  })

  const accepted = reachedByStage.get('accepted') ?? 0
  return {
    steps,
    total: applications.length,
    offerRate: base === 0 ? null : accepted / base,
  }
}

export interface ResumePerformance {
  resumeId: string
  resumeTitle: string
  /** 投递数 */
  applied: number
  /** 到达面试及以后的数量 */
  interviewed: number
  /** offer 数 */
  offered: number
  /** 面试转化率；样本 < 3 时为 null，UI 显示「样本不足」 */
  interviewRate: number | null
  offerRate: number | null
  /** 样本是否足够下结论 */
  enough: boolean
}

export const MIN_SAMPLE_SIZE = 3

/**
 * 版本胜率：哪份简历更容易过筛（P7-2）。
 *
 * 样本 < 3 不下结论：1 投 1 面看起来是 100%，照着优化只会过拟合。
 */
export function buildResumePerformance(
  rows: { resumeId: string | null; resumeTitle: string | null; reachedInterview: boolean; reachedOffer: boolean }[],
): ResumePerformance[] {
  const buckets = new Map<string, { title: string; applied: number; interviewed: number; offered: number }>()
  for (const row of rows) {
    if (!row.resumeId) continue
    const bucket = buckets.get(row.resumeId) ?? {
      title: row.resumeTitle ?? '未命名简历',
      applied: 0,
      interviewed: 0,
      offered: 0,
    }
    bucket.applied += 1
    if (row.reachedInterview) bucket.interviewed += 1
    if (row.reachedOffer) bucket.offered += 1
    buckets.set(row.resumeId, bucket)
  }

  return [...buckets.entries()]
    .map(([resumeId, bucket]) => {
      const enough = bucket.applied >= MIN_SAMPLE_SIZE
      return {
        resumeId,
        resumeTitle: bucket.title,
        applied: bucket.applied,
        interviewed: bucket.interviewed,
        offered: bucket.offered,
        interviewRate: enough ? bucket.interviewed / bucket.applied : null,
        offerRate: enough ? bucket.offered / bucket.applied : null,
        enough,
      }
    })
    .sort((a, b) => b.applied - a.applied)
}

/* --------------------------- 响应时长（P7-3） --------------------------- */

const DAY_MS = 86_400_000

export interface ResponseSample {
  /** 投出时间 */
  appliedAt: string
  /** 第一次被推进的时间（进入 screening 或更靠后的阶段） */
  firstAdvanceAt: string
}

export interface ResponseTimeStats {
  /** 中位数（天），样本为 0 时 null —— 0 会被读成「当天就回」 */
  medianDays: number | null
  /** 90 分位：用来回答「最慢的那批等了多久」 */
  p90Days: number | null
  /** 参与统计的样本数 */
  sample: number
  /** 有投递时间但没有推进记录的条数（还在等，不能当 0 天算） */
  waiting: number
  /** 时间早于投递时间的异常样本（导入数据里偶尔有） */
  invalid: number
  assumptions: string[]
}

/**
 * 响应时长中位数。
 *
 * 口径：`applied_at` → **首次进入 screening 或更靠后的阶段**，取事件流里最早的那一条。
 *
 * 为什么不是死盯「到 screening」：状态机允许 applied → interview 直跳，
 * 严格只认 screening 会把「一投就约面」这种最好的情况整批剔除，
 * 于是中位数被「卡在筛选里」的样本拉长，指标反而失真。
 *
 * 为什么还要 `waiting`：没推进的不是 0 天，是「还没回」。把它们当 0 算，
 * 投得越多中位数越短——这种指标会奖励海投。宁可单独计数。
 */
export function responseTimeStats(samples: ResponseSample[]): ResponseTimeStats {
  const days: number[] = []
  let invalid = 0

  for (const sample of samples) {
    const from = Date.parse(sample.appliedAt)
    const to = Date.parse(sample.firstAdvanceAt)
    if (Number.isNaN(from) || Number.isNaN(to)) {
      invalid += 1
      continue
    }
    if (to < from) {
      invalid += 1
      continue
    }
    // 保留一位小数：HR 半天回和隔天回，在「天」这个粒度上不该被抹平
    days.push(Math.round(((to - from) / DAY_MS) * 10) / 10)
  }

  days.sort((a, b) => a - b)

  return {
    medianDays: quantile(days, 0.5),
    p90Days: quantile(days, 0.9),
    sample: days.length,
    waiting: 0,
    invalid,
    assumptions: [
      '「回音时长」算的是：投出去之后，到第一次被推进到筛选或更后面，中间过了多少天',
      '还没动静的投递不算进样本，单独记成「等待中」——不然等得越久，数字反而越好看',
      '用中位数而不是平均数：一条拖了 60 天的样本就能把平均数拉歪',
    ],
  }
}

/** 线性插值分位数；空数组返回 null（不返回 0，避免被读成「零天」） */
export function quantile(sorted: readonly number[], ratio: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0] ?? null
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, ratio))
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const low = sorted[lower] ?? 0
  const high = sorted[upper] ?? low
  return Math.round((low + (high - low) * (position - lower)) * 10) / 10
}
