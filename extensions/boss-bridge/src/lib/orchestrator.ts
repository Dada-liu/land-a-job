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
  /** 两次翻页的最小间隔区间（毫秒），实际值在区间内随机：固定秒数本身就是机器特征 */
  scrollGapMinMs: number
  scrollGapMaxMs: number
  /** 每做几个动作强制休息一次 */
  restEvery: number
  restMinMs: number
  restMaxMs: number
  /** 翻页挖干后轮换的搜索词；少于 2 个就当没有兜底 */
  searchKeywords: string[]
  /** 两次换词的最小间隔区间（毫秒），同样随机 */
  searchGapMinMs: number
  searchGapMaxMs: number
  /** 每天换词上限 */
  dailySearchLimit: number
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
  /**
   * 连续「滚了一轮但卡片没变多」的次数。
   *
   * 不能用滚动位置判断到底：滚到底是页面行为，位置不会自己恢复；
   * 而「有没有新卡片」才是这个搜索词还有没有货的直接证据。
   */
  scrollStalls: number
  /** 上次换搜索词的时间与今日次数 */
  lastSearchAt: number
  searchesToday: number
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
   * 还没判活跃度的 `needs_detail` 岗位 key，按抓取时间从早到晚。
   * 这类必须先读：不读就不知道能不能打招呼，所以优先级最高。
   */
  detailTargets: string[]
  /**
   * 已经判过、只是**没有 JD 正文**的 `ready` / `greeted` 岗位。
   * 补 JD 只为之后的定制简历服务，和「能不能打招呼」无关——
   * 混进 detailTargets 会让上百条存量把每一轮都吃掉，打招呼永远轮不到。
   */
  jdTargets: string[]
  /** 可打招呼但还没打的岗位 key */
  ready: string[]
  /** 已打过招呼、还没发定制招呼语的 key */
  pendingGreeting: string[]
  /** 已达发送条件、还没发简历的 key */
  pendingResume: string[]
  /** 当前搜索页用的关键词（从地址栏读），换词时用来挑「下一个」 */
  currentKeyword?: string
  rng?: () => number
}

export type AutoDecision =
  | { kind: 'idle'; reason: string }
  | { kind: 'wait'; until: number; reason: string }
  /** 往下翻一屏列表，让页面自己加载下一页（零点击） */
  | { kind: 'scroll'; reason: string }
  /** 换一个搜索词重新搜：只在翻页确实挖干时才用，低频兜底 */
  | { kind: 'search'; keyword: string; reason: string }
  | { kind: 'openDetail'; jobKey: string; reason: string }
  /** 只为定制简历补 JD；活跃度已经判过，和打招呼无关，所以排在打招呼之后 */
  | { kind: 'readJd'; jobKey: string; reason: string }
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
    scrollStalls: 0,
    lastSearchAt: 0,
    searchesToday: 0,
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

/**
 * 伪随机 0~1：同一个种子永远得到同一个值。
 *
 * 间隔要随机（固定秒数是机器特征），但**不能每次 tick 都变**——否则第 30 秒算出
 * 要等 180 秒、第 60 秒又算出只要等 100 秒，`wait until` 会来回跳。
 * 以"上一次动作的时间"作种子，同一个间隔从头到尾只算出一个值。
 */
function hash01(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function randomBetween(min: number, max: number, seed: number): number {
  const mix = (hash01(seed + 1) + hash01(seed + 101)) / 2
  return Math.round(min + (max - min) * mix)
}

/** 这次翻页要等多久：100–200s 之间，由上次翻页时间决定 */
export function scrollGapFor(settings: AutoSettings, lastScrollAt: number): number {
  return randomBetween(settings.scrollGapMinMs, settings.scrollGapMaxMs, lastScrollAt)
}

/** 这次换词要等多久：500–800s 之间，由上次换词时间决定 */
export function searchGapFor(settings: AutoSettings, lastSearchAt: number): number {
  return randomBetween(settings.searchGapMinMs, settings.searchGapMaxMs, lastSearchAt)
}

function dayRoll(state: AutoState, now: number): AutoState {
  const today = localDay(now)
  if (state.day === today) return state
  return { ...state, day: today, scannedToday: 0, greetedToday: 0, sentToday: 0, searchesToday: 0, scrollStalls: 0 }
}

/**
 * 该换成哪个搜索词。返回 undefined 表示**现在不该换**：
 * 关键词少于两个、今日换词次数用完、或者离上次换词还不够久。
 *
 * 这些闸门和翻页分开，是因为换词是页面级导航 + 一次完整搜索请求，
 * 频率必须比滚动低一个量级，否则行为看起来就是在扫关键词。
 */
export function keywordToTry(
  settings: AutoSettings,
  state: AutoState,
  current: string | undefined,
  now: number,
): string | undefined {
  const list = settings.searchKeywords.filter((k) => k && k.trim())
  if (list.length < 2) return undefined
  if (settings.dailySearchLimit <= 0 || state.searchesToday >= settings.dailySearchLimit) return undefined
  if (state.lastSearchAt && now - state.lastSearchAt < searchGapFor(settings, state.lastSearchAt)) return undefined
  /**
   * 比较时忽略大小写和空格：地址栏里是 `agent开发`，配置里写的是 `Agent开发`，
   * 精确比较会认为「当前词不在列表里」，于是又挑回同一个词，等于换了个寂寞。
   */
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const needle = current ? norm(current) : ''
  const index = needle ? list.findIndex((k) => norm(k) === needle) : -1
  const pick = (i: number) => list[(i + list.length) % list.length] ?? ''
  const next = pick(index + 1)
  return norm(next) === needle ? (pick(index + 2) || next) : next
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
  const jdKey = ctx.jdTargets[0]
  const greetKey = ctx.ready[0]
  const messageKey = ctx.pendingGreeting[0]
  const resumeKey = ctx.pendingResume[0]

  /** 补详情放最前：它决定后面该不该打招呼。默认关（点卡片会整页导航） */
  if (settings.scanDetail && state.scannedToday < settings.dailyScanLimit && detailKey) {
    return { kind: 'openDetail', jobKey: detailKey, reason: '补一条候选的详情与 JD' }
  }
  /**
   * 顺序：先做**有明确结果**的动作，最后才是翻页。
   *
   * 翻页曾被排在打招呼前面，结果是「打开自动打招呼后第一个动作永远是翻一屏」：
   * 翻页不涨任何计数、界面毫无变化，用户以为没生效就停了。而屏幕上已经有
   * 可打的岗位时，翻页本身也没有意义——先把手头的打完再去找新的。
   */
  if (settings.greet && state.greetedToday < settings.dailyGreetLimit && greetKey) {
    return { kind: 'greet', jobKey: greetKey, reason: '给一条通过闸门的岗位打招呼' }
  }
  if (settings.sendGreeting && state.sentToday < settings.dailyMessageLimit && messageKey) {
    return { kind: 'sendGreeting', jobKey: messageKey, reason: '发定制招呼语' }
  }
  if (settings.sendResume && state.sentToday < settings.dailyMessageLimit && resumeKey) {
    return { kind: 'sendResume', jobKey: resumeKey, reason: '发简历' }
  }
  /**
   * 补 JD 排在打招呼之后：它只服务「定制简历」，不决定能不能打招呼。
   * 库里上百条存量都缺 JD，放前面会把打招呼饿死好几十轮。
   */
  if (settings.scanDetail && state.scannedToday < settings.dailyScanLimit && jdKey) {
    return { kind: 'readJd', jobKey: jdKey, reason: '给已通过闸门的岗位补 JD（供之后定制简历）' }
  }
  /**
   * 翻页：只是滚动，让页面自己请求下一页岗位。
   * 间隔在 100–200s 之间随机（由上次翻页时间决定，同一轮内不变）——
   * 固定秒数本身就是机器特征。
   *
   * 滚了两轮都没有新卡片，说明这个搜索词挖干了，才轮到换词兜底。
   * 换词比翻页更"重"（一次完整搜索 + 列表重置），所以间隔和每日次数都卡得更死。
   */
  const scrollGap = scrollGapFor(settings, state.lastScrollAt)
  if (settings.scan && now - state.lastScrollAt > scrollGap) {
    const exhausted = state.scrollStalls >= 2
    const keyword = exhausted ? keywordToTry(settings, state, ctx.currentKeyword, now) : undefined
    if (keyword) {
      return {
        kind: 'search',
        keyword,
        reason: `「${ctx.currentKeyword ?? '当前词'}」翻到底没有新岗位，换「${keyword}」再搜`,
      }
    }
    /** 挖干了但换词被闸门挡住（次数/间隔）：老实待着，别原地空滚 */
    if (exhausted) {
      return {
        kind: 'idle',
        reason: `「${ctx.currentKeyword ?? '当前词'}」已翻到底，换词还要等（今日 ${state.searchesToday}/${settings.dailySearchLimit}，间隔 ${Math.round(settings.searchGapMinMs / 60_000)}–${Math.round(settings.searchGapMaxMs / 60_000)} 分钟）`,
      }
    }
    return { kind: 'scroll', reason: '往下滚一屏，看看有没有新岗位' }
  }

  /**
   * 落到这里说明"有活但做不了"。必须说清是哪一道闸挡的——
   * 之前统一报"当前没有待处理项"，预算用满也这么显示，用户根本查不出原因。
   */
  if (settings.greet && greetKey) {
    return { kind: 'idle', reason: `今日打招呼已达上限（${state.greetedToday}/${settings.dailyGreetLimit}），明天再来` }
  }
  if ((settings.sendGreeting || settings.sendResume) && (messageKey || resumeKey)) {
    return { kind: 'idle', reason: `今日发消息已达上限（${state.sentToday}/${settings.dailyMessageLimit}），明天再来` }
  }
  if (settings.scanDetail && state.scannedToday >= settings.dailyScanLimit) {
    return { kind: 'idle', reason: `今日已读 ${state.scannedToday} 条详情，达到上限` }
  }
  const anySwitch = settings.scan || settings.scanDetail || settings.greet || settings.sendGreeting || settings.sendResume
  if (!anySwitch) return { kind: 'idle', reason: '开关全关着，先勾一项要它做什么' }
  /** 手头没活、只是翻页间隔还没到：说清楚是在等，别报成"没有待处理项" */
  if (settings.scan && now - state.lastScrollAt <= scrollGap) {
    return {
      kind: 'wait',
      until: state.lastScrollAt + scrollGap,
      reason: `等翻页间隔（${Math.round(scrollGap / 1000)} 秒）`,
    }
  }
  return { kind: 'idle', reason: '当前没有待处理项（屏幕上没有符合条件的目标，可能需要翻页或换搜索词）' }
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

  if (decision.kind === 'openDetail' || decision.kind === 'readJd') {
    next.scannedToday += 1
    next.phase = 'scan'
  } else if (decision.kind === 'scroll') {
    next.lastScrollAt = now
    next.phase = 'scan'
  } else if (decision.kind === 'search') {
    /** 换词等于把列表重置，翻页节奏也重新开始，否则下一 tick 立刻又去滚 */
    next.lastScrollAt = now
    next.lastSearchAt = now
    next.searchesToday += 1
    next.scrollStalls = 0
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

/**
 * 这条岗位做不了，但**不是环境坏了**（比如页面上根本没有「立即沟通」——
 * 多半是同一个岗位的重复记录、或已经沟通过）。
 *
 * 和失败的区别：不涨 failStreak（否则连续几条"没有按钮"就把全自动停掉），
 * 但必须推进 lastActionAt，否则下一 tick 立刻重试同一条。
 */
export function afterSkip(state: AutoState, now: number, reason: string): AutoState {
  const next = dayRoll({ ...state }, now)
  next.lastActionAt = now
  next.waitReason = reason
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
    case 'search': return `换了个搜索词（${decision.keyword}）`
    case 'openDetail': return '读了一条岗位详情'
    case 'readJd': return '补了一条岗位的 JD'
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
  /** 备用搜索词：设置页要能读出来编辑 */
  searchKeywords: string[]
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
    searchKeywords: [...settings.searchKeywords],
  }
}
