import { AUTO_DEFAULTS } from './constants.js'

/**
 * 全自动流程的调度层：**只做决策，不碰浏览器**。
 *
 * 为什么单独一层：全自动最容易出的两类事故是「停不下来」和「在错误的时间加速」。
 * 把"现在该不该动、该动哪一步、下次什么时候动"变成可单测的纯函数，
 * 就能在没有浏览器的环境里把闸门全部跑一遍，而不是等到真实页面上才发现漏了某个判断。
 */

export type AutoPhase = 'idle' | 'scan' | 'greet' | 'send'

/** 需要用户显式开启的自动化开关；默认全关（保守档） */
export interface AutoSettings {
  /** 总开关 */
  enabled: boolean
  /** 自动翻页浏览列表，发现新岗位（纯滚动，零点击） */
  scan: boolean
  /**
   * 自动点开岗位详情读 JD。
   * 默认关：实测搜索页点卡片会**整页导航**到详情页，打断当前浏览；
   * 而列表响应本身就带活跃度，读详情只是为补 JD，可以由用户自己点。
   */
  scanDetail: boolean
  /** 自动点「立即沟通」发默认招呼语 */
  greet: boolean
  /** 自动发定制招呼语 */
  sendGreeting: boolean
  /** 自动发简历 */
  sendResume: boolean
  /** 时段窗口，用「当天第几分钟」表示：570 = 09:30 */
  windowStartMin: number
  windowEndMin: number
  /** 每日上限：远低于平台硬限（120/150 位），打满本身就是异常信号 */
  dailyScanLimit: number
  dailyGreetLimit: number
  dailyMessageLimit: number
  /** 相邻动作间隔区间（毫秒），实际值在区间内随机 */
  gapMinMs: number
  gapMaxMs: number
  /** 两次翻页的最小间隔：翻页太密就是在刷接口 */
  scrollGapMs: number
  /** 每做几个动作强制休息一次 */
  restEvery: number
  restMinMs: number
  restMaxMs: number
}

export interface AutoState {
  phase: AutoPhase
  /** 本轮开始时间（0 表示没在跑） */
  startedAt: number
  lastTickAt: number
  /** 上一次「真实动作」完成的时间，用来算最小间隔 */
  lastActionAt: number
  /** 今日计数按 day 归零 */
  day: string
  scannedToday: number
  greetedToday: number
  sentToday: number
  actionsInRun: number
  /** 上次翻页时间：翻页不能太密，否则像在刷接口 */
  lastScrollAt: number
  /** 连续失败次数：到 5 就停，避免一直在同一个坏页面上重试 */
  failStreak: number
  /** 强制休息到什么时候 */
  restUntil: number
  /** 停下来等下一轮的原因（给用户看） */
  waitReason?: string
  lastStep?: { at: number; text: string }
}

export interface AutoContext {
  now: number
  settings: AutoSettings
  state: AutoState
  /** 风控熔断（RateLimiter.tripped） */
  tripped: boolean
  /**
   * 需要读详情的岗位 key，按抓取时间从早到晚。
   * 含两类：还没判活跃度的 `needs_detail`，以及已经判过但**没有 JD 正文**的
   * `ready` / `greeted`——后者不定制简历就没法投，同样要补。
   */
  detailTargets: string[]
  /** 可打招呼但还没打的岗位 key */
  ready: string[]
  /** 已打过招呼、还没发定制招呼语的 key */
  pendingGreeting: string[]
  /** 已达发送条件、还没发简历的 key */
  pendingResume: string[]
  rng?: () => number
}

export type AutoDecision =
  | { kind: 'idle'; reason: string }
  | { kind: 'wait'; until: number; reason: string }
  /** 往下翻一屏列表，让页面自己加载下一页（零点击） */
  | { kind: 'scroll'; reason: string }
  | { kind: 'openDetail'; jobKey: string; reason: string }
  | { kind: 'greet'; jobKey: string; reason: string }
  | { kind: 'sendGreeting'; jobKey: string; reason: string }
  | { kind: 'sendResume'; jobKey: string; reason: string }

export function emptyAutoState(day: string): AutoState {
  return {
    phase: 'idle',
    startedAt: 0,
    lastTickAt: 0,
    lastActionAt: 0,
    day,
    scannedToday: 0,
    greetedToday: 0,
    sentToday: 0,
    actionsInRun: 0,
    lastScrollAt: 0,
    failStreak: 0,
    restUntil: 0,
  }
}

/** 本地日期（不是 UTC）：跨时区、跨零点都按用户看到的日期算 */
export function localDay(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function minutesOfDay(now: number): number {
  const d = new Date(now)
  return d.getHours() * 60 + d.getMinutes()
}

/** 支持跨零点（start > end，例如 22:00–02:00） */
export function inWindow(now: number, startMin: number, endMin: number): boolean {
  const m = minutesOfDay(now)
  return startMin <= endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin
}

/** 下一个窗口开始的时间戳；当前已在窗口内时返回 now */
export function nextWindowStart(now: number, startMin: number): number {
  const target = new Date(now)
  target.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
  if (target.getTime() <= now) target.setDate(target.getDate() + 1)
  return target.getTime()
}

/** 动作间隔：区间内随机，并带一点向中间聚集的倾向（均匀分布看起来太规律） */
export function nextGapMs(settings: AutoSettings, rng: () => number = Math.random): number {
  const { gapMinMs, gapMaxMs } = settings
  const a = rng()
  const b = rng()
  const mix = (a + b) / 2
  return Math.round(gapMinMs + (gapMaxMs - gapMinMs) * mix)
}

function dayRoll(state: AutoState, now: number): AutoState {
  const today = localDay(now)
  if (state.day === today) return state
  return { ...state, day: today, scannedToday: 0, greetedToday: 0, sentToday: 0 }
}

/**
 * 该做什么。
 *
 * 判断顺序刻意是「能不能动」优先于「动什么」：熔断、时段、预算、休息、间隔任意一条不满足，
 * 就直接返回 wait/idle，绝不让后面更"具体"的步骤绕过闸门。
 */
export function decideAuto(ctx: AutoContext): AutoDecision {
  const { now, settings, tripped } = ctx
  const state = dayRoll(ctx.state, now)

  if (!settings.enabled) return { kind: 'idle', reason: '自动化总开关未开启' }
  if (tripped) return { kind: 'idle', reason: '已触发风控熔断，先解除保护再继续' }
  if (state.failStreak >= 5) {
    return { kind: 'idle', reason: `连续失败 ${state.failStreak} 次，已暂停（检查 BOSS 页面是否还在岗位列表）` }
  }
  if (!inWindow(now, settings.windowStartMin, settings.windowEndMin)) {
    return {
      kind: 'wait',
      until: nextWindowStart(now, settings.windowStartMin),
      reason: `不在时段内（${clock(settings.windowStartMin)}–${clock(settings.windowEndMin)}）`,
    }
  }
  if (state.restUntil > now) {
    return { kind: 'wait', until: state.restUntil, reason: '本轮小憩中' }
  }

  const gap = nextGapMs(settings, ctx.rng)
  if (state.lastActionAt && now - state.lastActionAt < gap) {
    return { kind: 'wait', until: state.lastActionAt + gap, reason: '等最小间隔' }
  }

  const detailKey = ctx.detailTargets[0]
  const greetKey = ctx.ready[0]
  const messageKey = ctx.pendingGreeting[0]
  const resumeKey = ctx.pendingResume[0]

  /** 补详情放最前：它决定后面该不该打招呼。默认关（点卡片会整页导航） */
  if (settings.scanDetail && state.scannedToday < settings.dailyScanLimit && detailKey) {
    return { kind: 'openDetail', jobKey: detailKey, reason: '补一条候选的详情与 JD' }
  }
  /**
   * 翻页：只是滚动，让页面自己请求下一页岗位。
   * 间隔刻意长（默认 2 分钟以上）——连续翻页比连续点击更像在刷数据。
   */
  if (settings.scan && now - state.lastScrollAt > settings.scrollGapMs) {
    return { kind: 'scroll', reason: '翻一屏，看看有没有新岗位' }
  }
  if (settings.greet && state.greetedToday < settings.dailyGreetLimit && greetKey) {
    return { kind: 'greet', jobKey: greetKey, reason: '给一条通过闸门的岗位打招呼' }
  }
  if (settings.sendGreeting && state.sentToday < settings.dailyMessageLimit && messageKey) {
    return { kind: 'sendGreeting', jobKey: messageKey, reason: '发定制招呼语' }
  }
  if (settings.sendResume && state.sentToday < settings.dailyMessageLimit && resumeKey) {
    return { kind: 'sendResume', jobKey: resumeKey, reason: '发简历' }
  }

  if (settings.scanDetail && state.scannedToday >= settings.dailyScanLimit) {
    return { kind: 'idle', reason: `今日已读 ${state.scannedToday} 条详情，达到上限` }
  }
  return { kind: 'idle', reason: '当前没有待处理项' }
}

/** 动作成功后推进计数；返回新状态（不改入参） */
export function afterAction(
  state: AutoState,
  decision: AutoDecision,
  now: number,
  settings: AutoSettings,
  rng: () => number = Math.random,
): AutoState {
  const next = dayRoll({ ...state }, now)
  next.lastActionAt = now
  next.actionsInRun += 1
  next.failStreak = 0
  next.lastStep = { at: now, text: describe(decision) }

  if (decision.kind === 'openDetail') {
    next.scannedToday += 1
    next.phase = 'scan'
  } else if (decision.kind === 'scroll') {
    next.lastScrollAt = now
    next.phase = 'scan'
  } else if (decision.kind === 'greet') {
    next.greetedToday += 1
    next.phase = 'greet'
  } else if (decision.kind === 'sendGreeting' || decision.kind === 'sendResume') {
    next.sentToday += 1
    next.phase = 'send'
  }

  /**
   * 连续动作会让"节奏"暴露：每 N 个动作插一次随机休息。
   * 休息时长也在区间内随机，不用固定值。
   */
  if (settings.restEvery > 0 && next.actionsInRun % settings.restEvery === 0) {
    const span = Math.max(0, settings.restMaxMs - settings.restMinMs)
    next.restUntil = now + settings.restMinMs + Math.round(span * rng())
  }
  return next
}

/**
 * 动作失败：不推进业务计数，但**必须推进 lastActionAt**。
 * 否则下次 tick 立刻重试同一个坏页面，一分钟内能打十几次，比正常动作还密集。
 */
export function afterFailure(state: AutoState, now: number, reason: string): AutoState {
  const next = dayRoll({ ...state }, now)
  next.lastActionAt = now
  next.failStreak += 1
  next.waitReason = reason
  if (next.failStreak >= 5) next.phase = 'idle'
  return next
}

export function startAutoState(state: AutoState, now: number): AutoState {
  const fresh = dayRoll({ ...state }, now)
  /** 用户主动点「开始」＝愿意再试一次，把上次的连续失败清掉 */
  return { ...fresh, phase: 'scan', startedAt: now, restUntil: 0, failStreak: 0, waitReason: undefined }
}

export function stopAutoState(state: AutoState, reason?: string): AutoState {
  return { ...state, phase: 'idle', startedAt: 0, waitReason: reason }
}

function clock(min: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
}

function describe(decision: AutoDecision): string {
  switch (decision.kind) {
    case 'scroll': return '翻了一屏列表'
    case 'openDetail': return '读了一条岗位详情'
    case 'greet': return '打了一次招呼'
    case 'sendGreeting': return '发了一条定制招呼语'
    case 'sendResume': return '发了一份简历'
    default: return ''
  }
}

/** 存进 storage 的默认值；和 constants 同源，避免两处各写一份 */
export function defaultAutoSettings(): AutoSettings {
  return { ...AUTO_DEFAULTS }
}

/** 给 popup 的只读快照：字段扁平，UI 不再二次计算 */
export interface AutoSnapshot {
  enabled: boolean
  phase: string
  day: string
  scannedToday: number
  greetedToday: number
  sentToday: number
  restUntil: number
  waitReason?: string
  lastStepText?: string
  lastStepAt?: number
  limits: { scan: number; greet: number; send: number }
  windowLabel: string
  switches: { scan: boolean; scanDetail: boolean; greet: boolean; sendGreeting: boolean; sendResume: boolean }
}

export function toAutoSnapshot(state: AutoState, settings: AutoSettings, now: number): AutoSnapshot {
  const rolled = dayRoll(state, now)
  return {
    enabled: settings.enabled,
    phase: rolled.phase,
    day: rolled.day,
    scannedToday: rolled.scannedToday,
    greetedToday: rolled.greetedToday,
    sentToday: rolled.sentToday,
    restUntil: rolled.restUntil,
    waitReason: rolled.waitReason,
    lastStepText: rolled.lastStep?.text,
    lastStepAt: rolled.lastStep?.at,
    limits: {
      scan: settings.dailyScanLimit,
      greet: settings.dailyGreetLimit,
      send: settings.dailyMessageLimit,
    },
    windowLabel: `${clock(settings.windowStartMin)}–${clock(settings.windowEndMin)}`,
    switches: {
      scan: settings.scan,
      scanDetail: settings.scanDetail,
      greet: settings.greet,
      sendGreeting: settings.sendGreeting,
      sendResume: settings.sendResume,
    },
  }
}
