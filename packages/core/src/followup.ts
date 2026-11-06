/**
 * 跟进规则引擎（ARCHITECTURE 5.4）。
 *
 * 纯函数、不落库：每次读「今日待办」时现算。
 * 这样没有后台定时任务、没有脏任务需要清理；用户点「完成」只写一条事件，
 * 下次计算时条件已不成立，任务自然消失。副作用小，可单测到边界值。
 */

export type FollowupKind = 'no_reply' | 'thanks_letter' | 'offer_deadline' | 'stale'

export const FOLLOWUP_LABELS: Record<FollowupKind, string> = {
  no_reply: '投递无回音',
  thanks_letter: '面试后未复盘',
  offer_deadline: 'Offer 即将到期',
  stale: '长期停滞',
}

export interface FollowupTask {
  /** 稳定 key：同一条投递同一种规则只出现一次 */
  id: string
  kind: FollowupKind
  priority: 'high' | 'normal'
  title: string
  detail: string
  /** 触发该任务的时间点（用于排序与展示「已经 N 天」） */
  since: string
  days: number
  targetType: 'application' | 'interview' | 'offer'
  targetId: string
  applicationId: string
  companyName: string | null
  jobTitle: string | null
}

export interface FollowupApplication {
  id: string
  status: string
  statusAt: string
  appliedAt?: string | null
  nextActionAt?: string | null
  companyName?: string | null
  jobTitle?: string | null
}

export interface FollowupInterview {
  id: string
  applicationId: string
  scheduledAt: string | null
  feedback?: string | null
  result?: string | null
}

export interface FollowupOffer {
  id: string
  applicationId: string
  deadline: string | null
  status: string
  companyName?: string | null
}

export interface FollowupThresholds {
  noReplyDays: number
  thanksLetterDays: number
  offerDeadlineDays: number
  staleDays: number
}

export const DEFAULT_THRESHOLDS: FollowupThresholds = {
  noReplyDays: 7,
  thanksLetterDays: 3,
  offerDeadlineDays: 2,
  staleDays: 30,
}

export interface FollowupInput {
  applications: FollowupApplication[]
  interviews?: FollowupInterview[]
  offers?: FollowupOffer[]
  now?: Date
  thresholds?: Partial<FollowupThresholds>
}

const DAY_MS = 86_400_000

/** 精确毫秒差。阈值判定不能用「天数整数」，否则 7 天零 1 秒会被 floor 成 7 而漏判 */
function ageMs(from: string, now: number): number {
  const ms = now - Date.parse(from)
  return Number.isNaN(ms) ? 0 : ms
}

/** 展示用天数：向上取整，「超过 7 天」在第 8 天显示为 8 天，符合口语 */
function displayDays(ms: number): number {
  return Math.max(0, Math.ceil(ms / DAY_MS))
}

/**
 * 判定「超过 N 天」用严格的 `>`，恰好第 7 天不触发。
 *
 * 这不是抠细节：规则如果是 `>=`，那么第 7 天当天催办一次、第 8 天又触发一次，
 * 用户会连收两条同样的提醒；而边界写成 `>` 后，语义也更贴近口语的「超过 7 天」。
 */
export function evaluateFollowups(input: FollowupInput): FollowupTask[] {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds }
  const nowDate = input.now ?? new Date()
  const now = nowDate.getTime()
  const tasks: FollowupTask[] = []
  const appById = new Map(input.applications.map((app) => [app.id, app]))

  for (const app of input.applications) {
    const elapsed = ageMs(app.statusAt, now)
    const days = displayDays(elapsed)
    // 用户已经手动排了下一次动作的，不再催——否则提醒会跟用户的计划打架
    const hasScheduledNext = app.nextActionAt ? Date.parse(app.nextActionAt) > now : false

    if (app.status === 'applied' && elapsed > thresholds.noReplyDays * DAY_MS && !hasScheduledNext) {
      tasks.push({
        id: `no_reply:${app.id}`,
        kind: 'no_reply',
        priority: 'normal',
        title: `催一下 ${app.companyName ?? '这家公司'}`,
        detail: `${app.jobTitle ?? '该岗位'} 已投 ${days} 天没有回音，建议发一封跟进邮件或换渠道触达。`,
        since: app.statusAt,
        days,
        targetType: 'application',
        targetId: app.id,
        applicationId: app.id,
        companyName: app.companyName ?? null,
        jobTitle: app.jobTitle ?? null,
      })
    }

    if ((app.status === 'applied' || app.status === 'screening') && elapsed > thresholds.staleDays * DAY_MS) {
      tasks.push({
        id: `stale:${app.id}`,
        kind: 'stale',
        priority: 'normal',
        title: `${app.companyName ?? '这条投递'} 停滞 ${days} 天`,
        detail: '超过一个月没有推进。确认对方是否已关闭岗位；确认后可标记为「无回音」以释放注意力。',
        since: app.statusAt,
        days,
        targetType: 'application',
        targetId: app.id,
        applicationId: app.id,
        companyName: app.companyName ?? null,
        jobTitle: app.jobTitle ?? null,
      })
    }
  }

  for (const interview of input.interviews ?? []) {
    if (!interview.scheduledAt) continue
    if (interview.feedback && interview.feedback.trim().length > 0) continue
    if (interview.result === 'cancelled') continue
    const elapsed = ageMs(interview.scheduledAt, now)
    if (elapsed <= thresholds.thanksLetterDays * DAY_MS) continue
    const days = displayDays(elapsed)
    const app = appById.get(interview.applicationId)
    tasks.push({
      id: `thanks_letter:${interview.id}`,
      kind: 'thanks_letter',
      priority: 'normal',
      title: `补一次面试复盘 · ${app?.companyName ?? '面试'}`,
      detail: `面试已过去 ${days} 天还没记反馈。趁记忆还新，把被问到的题与答得不好的点写下来。`,
      since: interview.scheduledAt,
      days,
      targetType: 'interview',
      targetId: interview.id,
      applicationId: interview.applicationId,
      companyName: app?.companyName ?? null,
      jobTitle: app?.jobTitle ?? null,
    })
  }

  for (const offer of input.offers ?? []) {
    if (offer.status !== 'pending' || !offer.deadline) continue
    const remaining = Math.ceil((Date.parse(offer.deadline) - now) / DAY_MS)
    if (Number.isNaN(remaining) || remaining > thresholds.offerDeadlineDays) continue
    const app = appById.get(offer.applicationId)
    tasks.push({
      id: `offer_deadline:${offer.id}`,
      kind: 'offer_deadline',
      priority: 'high',
      title: remaining < 0 ? `Offer 已过期 · ${offer.companyName ?? ''}` : `Offer 还剩 ${remaining} 天答复 · ${offer.companyName ?? ''}`,
      detail: '答复窗口很短，先算清总包再回话；需要延期就直接提，多数公司可以给 3–5 天。',
      since: offer.deadline,
      days: remaining,
      targetType: 'offer',
      targetId: offer.id,
      applicationId: offer.applicationId,
      companyName: offer.companyName ?? app?.companyName ?? null,
      jobTitle: app?.jobTitle ?? null,
    })
  }

  return tasks.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1
    return b.days - a.days
  })
}
