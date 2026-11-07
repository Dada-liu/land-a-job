import {
  FUNNEL_LABELS,
  STAGE_ORDER,
  buildFunnel,
  buildResumePerformance,
  evaluateFollowups,
  responseTimeStats,
  type FollowupTask,
  type FunnelStep,
  type ResumePerformance,
  type ResponseTimeStats,
  type Status,
} from '@land/core'
import { overview, type OverviewStats } from './application.js'
import { readSettings } from './settings.js'
import type { Db } from '../index.js'

/**
 * Dashboard 聚合（P3-1）。
 *
 * 全部在 SQL 里聚合一次、在 core 里算一次，不退化成「查所有行到 JS 里循环」：
 * 数据量到几千条时，前者仍是一次索引扫描，后者会拖慢首屏。
 */

export interface WeeklyCounts {
  /** 本周一 00:00（本地时区） */
  start: string
  newJobs: number
  newApplications: number
  /** 本周登记为「已投」的数量 */
  submitted: number
  /** 北极星：本周有效投递 = 已投 且 fit ≥ 60 且绑定了定制简历 */
  effective: number
}

export interface DashboardStats {
  northStar: {
    label: string
    value: number
    target: number
    hint: string
  }
  funnel: FunnelStep[]
  today: FollowupTask[]
  week: WeeklyCounts
  totals: OverviewStats
  upcoming: { interviews: number; offersPending: number }
  /** 投出 → 首次有推进 的中位天数（P7-3） */
  responseTime: ResponseTimeStats
}

/** 周起点：周一 00:00。用本地时间而不是 UTC——用户看到的是自己的「本周」 */
export function weekStart(now: Date): Date {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  const weekday = (date.getDay() + 6) % 7 // 周一 = 0
  date.setDate(date.getDate() - weekday)
  return date
}

interface AppRow {
  id: string
  status: string
  statusAt: string
  appliedAt: string | null
  resumeId: string | null
  resumeTitle: string | null
  nextActionAt: string | null
  jobTitle: string | null
  companyName: string | null
  fitScore: number | null
  createdAt: string
}

function loadApplications(db: Db): AppRow[] {
  return db
    .prepare(
      `SELECT a.id, a.status, a.status_at AS statusAt, a.applied_at AS appliedAt, a.resume_id AS resumeId,
              r.title AS resumeTitle, a.next_action_at AS nextActionAt, a.created_at AS createdAt,
              j.title AS jobTitle, j.fit_score AS fitScore, c.name AS companyName
       FROM application a
       LEFT JOIN job j ON j.id = a.job_id
       LEFT JOIN company c ON c.id = j.company_id
       LEFT JOIN resume r ON r.id = a.resume_id AND r.deleted_at IS NULL
       WHERE a.deleted_at IS NULL`,
    )
    .all() as AppRow[]
}

interface EventRow {
  applicationId: string
  toStatus: string | null
  at: string
}

function loadEvents(db: Db): EventRow[] {
  return db
    .prepare(
      `SELECT e.application_id AS applicationId, e.to_status AS toStatus, e.at AS at
       FROM application_event e
       JOIN application a ON a.id = e.application_id
       WHERE a.deleted_at IS NULL`,
    )
    .all() as EventRow[]
}

/**
 * 响应时长（P7-3）。
 *
 * 「首次有推进」= 事件流里最早一次进入 screening 或更靠后阶段的时刻；
 * 没有任何事件但有 applied_at 的（导入数据、或状态被直接改过）记为「还在等」。
 * 两者必须分开：把「还没回」当成 0 天，会让海投的人指标看起来更漂亮。
 */
function buildResponseTime(applications: AppRow[], events: EventRow[]): ResponseTimeStats {
  const ADVANCE_FROM = STAGE_ORDER.screening ?? 200
  const firstAdvance = new Map<string, string>()

  for (const event of events) {
    if (stageOrder(event.toStatus) < ADVANCE_FROM) continue
    const current = firstAdvance.get(event.applicationId)
    if (!current || Date.parse(event.at) < Date.parse(current)) firstAdvance.set(event.applicationId, event.at)
  }

  const samples: { appliedAt: string; firstAdvanceAt: string }[] = []
  let waiting = 0
  for (const app of applications) {
    if (!app.appliedAt) continue
    const advance = firstAdvance.get(app.id)
    if (advance) samples.push({ appliedAt: app.appliedAt, firstAdvanceAt: advance })
    else waiting += 1
  }

  const stats = responseTimeStats(samples)
  return { ...stats, waiting }
}

export function dashboard(db: Db, now = new Date()): DashboardStats {
  const applications = loadApplications(db)
  const events = loadEvents(db)
  const start = weekStart(now).toISOString()
  const { weeklyTarget } = readSettings(db)

  const funnel = buildFunnel(
    applications.map((app) => ({
      id: app.id,
      status: app.status,
      appliedAt: app.appliedAt,
      createdAt: app.createdAt,
    })),
    events,
  )

  // interview / offer 是硬删除（无 deleted_at），只按投递的软删状态过滤
  const interviews = db
    .prepare(
      `SELECT i.id, i.application_id AS applicationId, i.scheduled_at AS scheduledAt,
              i.feedback, i.result
       FROM interview i
       JOIN application a ON a.id = i.application_id
       WHERE a.deleted_at IS NULL`,
    )
    .all() as { id: string; applicationId: string; scheduledAt: string | null; feedback: string | null; result: string }[]

  const offers = db
    .prepare(
      `SELECT o.id, o.application_id AS applicationId, o.deadline, o.status
       FROM offer o
       JOIN application a ON a.id = o.application_id
       WHERE a.deleted_at IS NULL`,
    )
    .all() as { id: string; applicationId: string; deadline: string | null; status: string }[]

  const today = evaluateFollowups({
    applications: applications.map((app) => ({
      id: app.id,
      status: app.status,
      statusAt: app.statusAt,
      appliedAt: app.appliedAt,
      nextActionAt: app.nextActionAt,
      companyName: app.companyName,
      jobTitle: app.jobTitle,
    })),
    interviews,
    offers,
    now,
  })

  const submittedThisWeek = applications.filter((app) => (app.appliedAt ?? '') >= start)
  const effective = submittedThisWeek.filter((app) => app.resumeId !== null && (app.fitScore ?? 0) >= 60)

  const newJobsRow = db
    .prepare(`SELECT count(*) AS n FROM job WHERE deleted_at IS NULL AND created_at >= ?`)
    .get(start) as { n: number }

  const upcomingInterviews = interviews.filter(
    (item) => item.scheduledAt && Date.parse(item.scheduledAt) >= now.getTime() && item.result === 'pending',
  ).length

  return {
    northStar: {
      label: '本周有效投递',
      value: effective.length,
      // 目标是用户自己定的（总览页点数字就能改），默认 8 份是 PRD 里「认真投」的下限
      target: weeklyTarget,
      hint: `只算匹配度 60 分以上、并且绑了简历的投递。一周 ${weeklyTarget} 份是「认真投」的下限，点数字可以改`,
    },
    funnel: funnel.steps.map((step) => ({ ...step, label: FUNNEL_LABELS[step.stage] })),
    today,
    week: {
      start,
      newJobs: newJobsRow.n,
      newApplications: applications.filter((app) => app.createdAt >= start).length,
      submitted: submittedThisWeek.length,
      effective: effective.length,
    },
    totals: overview(db),
    upcoming: {
      interviews: upcomingInterviews,
      offersPending: offers.filter((offer) => offer.status === 'pending').length,
    },
    responseTime: buildResponseTime(applications, events),
  }
}

function stageOrder(status: string | null | undefined): number {
  if (!status) return -1
  return STAGE_ORDER[status as Status] ?? -1
}

/**
 * 版本胜率（P7-2 的数据部分，P5 就有工具要用）。
 *
 * 「到达过某阶段」的判定必须和漏斗同源：只看当前 status 会把「进过三面后挂了」
 * 那条算成没进面试，简历版本胜率就会系统性偏低。
 *
 * 分母也用同一把尺子：`order >= applied` 才算投出去过。待投（queued）只是排队，
 * 把它算成一次投递会稀释转化率——母版「7 投 1 面」和「5 投 1 面」是两个结论。
 */
export function resumePerformance(db: Db): ResumePerformance[] {
  const applications = loadApplications(db)
  const events = loadEvents(db)
  const byApp = new Map<string, EventRow[]>()
  for (const event of events) {
    const list = byApp.get(event.applicationId)
    if (list) list.push(event)
    else byApp.set(event.applicationId, [event])
  }
  const appliedOrder = STAGE_ORDER.applied ?? 100

  return buildResumePerformance(
    applications.map((app) => {
      let order = stageOrder(app.status)
      for (const event of byApp.get(app.id) ?? []) order = Math.max(order, stageOrder(event.toStatus))
      if (order < appliedOrder && app.appliedAt) order = appliedOrder
      return {
        resumeId: app.resumeId,
        resumeTitle: app.resumeTitle,
        reachedApplied: order >= appliedOrder,
        reachedInterview: order >= (STAGE_ORDER.interview ?? Infinity),
        reachedOffer: order >= (STAGE_ORDER.offer ?? Infinity),
      }
    }),
  )
}
