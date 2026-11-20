import { describe, expect, it } from 'vitest'
import {
  afterAction,
  afterFailure,
  decideAuto,
  emptyAutoState,
  inWindow,
  localDay,
  nextGapMs,
  nextWindowStart,
  startAutoState,
  stopAutoState,
  toAutoSnapshot,
  type AutoContext,
  type AutoSettings,
  type AutoState,
} from '../src/lib/orchestrator.js'
import { AUTO_DEFAULTS } from '../src/lib/constants.js'

/** 本地时间 2026-11-18 10:00，避免用 UTC 字符串在别的时区跑出不同结果 */
const at = (h: number, m = 0, day = 18) => new Date(2026, 10, day, h, m, 0, 0).getTime()
const NOW = at(10)

function settings(patch: Partial<AutoSettings> = {}): AutoSettings {
  return { ...AUTO_DEFAULTS, enabled: true, scan: false, greet: true, ...patch }
}

function state(patch: Partial<AutoState> = {}): AutoState {
  return { ...emptyAutoState(localDay(NOW)), ...patch }
}

function ctx(patch: Partial<AutoContext> = {}): AutoContext {
  return {
    now: NOW,
    settings: settings(),
    state: state(),
    tripped: false,
    detailTargets: [],
    ready: [],
    pendingGreeting: [],
    pendingResume: [],
    rng: () => 0.5,
    ...patch,
  }
}

describe('时段窗口', () => {
  it('09:30–21:00 之间算窗口内，边界左闭右开', () => {
    expect(inWindow(at(9, 29), 570, 1260)).toBe(false)
    expect(inWindow(at(9, 30), 570, 1260)).toBe(true)
    expect(inWindow(at(20, 59), 570, 1260)).toBe(true)
    expect(inWindow(at(21, 0), 570, 1260)).toBe(false)
  })

  it('支持跨零点的窗口（22:00–02:00）', () => {
    expect(inWindow(at(23), 1320, 120)).toBe(true)
    expect(inWindow(at(1), 1320, 120)).toBe(true)
    expect(inWindow(at(12), 1320, 120)).toBe(false)
  })

  it('下一个窗口开始时间跳到来日 09:30', () => {
    const next = nextWindowStart(at(22), 570)
    expect(new Date(next).getHours()).toBe(9)
    expect(new Date(next).getMinutes()).toBe(30)
    expect(next).toBeGreaterThan(at(22))
  })
})

describe('decideAuto 的闸门顺序', () => {
  it('总开关关着就什么都不做', () => {
    const decision = decideAuto(ctx({ settings: settings({ enabled: false }), detailTargets: ['a'] }))
    expect(decision.kind).toBe('idle')
  })

  it('熔断期间哪怕有事可做也停', () => {
    const decision = decideAuto(ctx({ tripped: true, detailTargets: ['a'] }))
    expect(decision.kind).toBe('idle')
    expect(decision.kind === 'idle' && decision.reason).toContain('熔断')
  })

  it('不在时段内等到下一个窗口，不会偷偷跑', () => {
    const decision = decideAuto(ctx({ now: at(3), detailTargets: ['a'] }))
    expect(decision.kind).toBe('wait')
    if (decision.kind === 'wait') expect(decision.until).toBeGreaterThan(at(3))
  })

  it('最小间隔没到就等，不连续动作', () => {
    const decision = decideAuto(ctx({
      state: state({ lastActionAt: NOW - 1000 }),
      detailTargets: ['a'],
    }))
    expect(decision.kind).toBe('wait')
    expect(decision.kind === 'wait' && decision.reason).toContain('间隔')
  })

  it('小憩期间什么都不做', () => {
    const decision = decideAuto(ctx({ state: state({ restUntil: NOW + 30_000 }), detailTargets: ['a'] }))
    expect(decision.kind).toBe('wait')
    expect(decision.kind === 'wait' && decision.reason).toContain('小憩')
  })

  it('连续失败 5 次后自动停，不无限重试同一个坏页面', () => {
    const decision = decideAuto(ctx({ state: state({ failStreak: 5 }), detailTargets: ['a'] }))
    expect(decision.kind).toBe('idle')
    expect(decision.kind === 'idle' && decision.reason).toContain('连续失败')
  })
})

describe('decideAuto 的优先级与预算', () => {
  /** 只测详情与打招呼时把翻页关掉，否则 scroll 会先抢答 */
  const noScroll = { scan: false, scanDetail: false }

  it('先补详情，再考虑打招呼（详情决定它到底该不该打）', () => {
    const decision = decideAuto(ctx({
      settings: settings({ ...noScroll, scanDetail: true }),
      detailTargets: ['d1'],
      ready: ['r1'],
    }))
    expect(decision).toMatchObject({ kind: 'openDetail', jobKey: 'd1' })
  })

  it('详情读完才轮到打招呼', () => {
    const decision = decideAuto(ctx({ settings: settings(noScroll), ready: ['r1'] }))
    expect(decision).toMatchObject({ kind: 'greet', jobKey: 'r1' })
  })

  it('打招呼开关关着时不会点沟通（保守档默认如此）', () => {
    const decision = decideAuto(ctx({
      settings: settings({ ...noScroll, greet: false }),
      ready: ['r1'],
    }))
    expect(decision.kind).toBe('idle')
  })

  it('默认档只翻页：既不打招呼也不点详情', () => {
    const decision = decideAuto(ctx({
      settings: { ...AUTO_DEFAULTS, enabled: true },
      detailTargets: ['d1'],
      ready: ['r1'],
    }))
    expect(decision.kind).toBe('scroll')
  })

  it('刚翻过页就不会再翻，等间隔到', () => {
    const decision = decideAuto(ctx({
      settings: settings({ scanDetail: false }),
      state: state({ lastScrollAt: NOW - 1000 }),
      detailTargets: ['d1'],
    }))
    expect(decision.kind).toBe('idle')
  })

  it('手头有可打的岗位时先打招呼，不先翻页', () => {
    /** 翻页间隔早已到点，但屏幕上有 ready → 必须先动手，否则"开了自动却毫无动静" */
    const decision = decideAuto(ctx({
      settings: settings({ scan: true, scanDetail: false, greet: true }),
      state: state({ lastScrollAt: 0 }),
      ready: ['r1'],
    }))
    expect(decision).toMatchObject({ kind: 'greet', jobKey: 'r1' })
  })

  it('没有可打的岗位时才翻页找新的', () => {
    const decision = decideAuto(ctx({
      settings: settings({ scan: true, scanDetail: false, greet: true }),
      state: state({ lastScrollAt: 0 }),
      ready: [],
    }))
    expect(decision.kind).toBe('scroll')
  })

  it('当日达到扫描上限就停（含详情）', () => {
    const decision = decideAuto(ctx({
      settings: settings({ scan: false, scanDetail: true }),
      state: state({ scannedToday: AUTO_DEFAULTS.dailyScanLimit }),
      detailTargets: ['d1'],
    }))
    expect(decision.kind).toBe('idle')
    expect(decision.kind === 'idle' && decision.reason).toContain('上限')
  })

  it('发送类动作受消息预算约束，而不是打招呼预算', () => {
    const decision = decideAuto(ctx({
      settings: settings({ ...noScroll, sendGreeting: true }),
      state: state({ sentToday: AUTO_DEFAULTS.dailyMessageLimit }),
      pendingGreeting: ['g1'],
    }))
    expect(decision.kind).toBe('idle')
  })

  it('跨天后计数归零，新的一天可以继续', () => {
    const stale = state({ day: '2026-11-17', scannedToday: 80, greetedToday: 40, sentToday: 60, lastScrollAt: NOW })
    const decision = decideAuto(ctx({
      settings: settings({ scan: false, scanDetail: true }),
      state: stale,
      detailTargets: ['d1'],
    }))
    expect(decision).toMatchObject({ kind: 'openDetail', jobKey: 'd1' })
  })
})

describe('计数推进与休息', () => {
  it('读详情只加扫描计数，不动打招呼与消息计数', () => {
    const next = afterAction(state(), { kind: 'openDetail', jobKey: 'a', reason: '' }, NOW, settings())
    expect(next.scannedToday).toBe(1)
    expect(next.greetedToday).toBe(0)
    expect(next.sentToday).toBe(0)
    expect(next.lastActionAt).toBe(NOW)
  })

  it('打招呼加自己的计数，不清别人的', () => {
    const next = afterAction(state({ scannedToday: 3 }), { kind: 'greet', jobKey: 'a', reason: '' }, NOW, settings())
    expect(next.greetedToday).toBe(1)
    expect(next.scannedToday).toBe(3)
  })

  it('每 N 个动作插入一次休息，时长不固定', () => {
    const s = settings({ restEvery: 2, restMinMs: 60_000, restMaxMs: 180_000 })
    const first = afterAction(state(), { kind: 'openDetail', jobKey: 'a', reason: '' }, NOW, s, () => 0.5)
    expect(first.restUntil).toBe(0)
    const second = afterAction(first, { kind: 'openDetail', jobKey: 'b', reason: '' }, NOW, s, () => 0.5)
    expect(second.restUntil).toBe(NOW + 120_000)
  })

  it('成功一次就把失败计数清零', () => {
    const next = afterAction(state({ failStreak: 2 }), { kind: 'openDetail', jobKey: 'a', reason: '' }, NOW, settings())
    expect(next.failStreak).toBe(0)
  })

  it('失败要推进时间戳，避免立刻重试同一项', () => {
    const next = afterFailure(state(), NOW, '面板没切换')
    expect(next.lastActionAt).toBe(NOW)
    expect(next.failStreak).toBe(1)
    expect(next.waitReason).toContain('面板没切换')
  })

  it('失败五次标记为空闲态', () => {
    let s = state()
    for (let i = 0; i < 5; i += 1) s = afterFailure(s, NOW + i, 'x')
    expect(s.phase).toBe('idle')
    expect(s.failStreak).toBe(5)
  })
})

describe('节奏与快照', () => {
  it('间隔落在配置区间内', () => {
    for (const r of [0, 0.5, 0.999]) {
      const gap = nextGapMs(settings({ gapMinMs: 4000, gapMaxMs: 12000 }), () => r)
      expect(gap).toBeGreaterThanOrEqual(4000)
      expect(gap).toBeLessThanOrEqual(12000)
    }
  })

  it('启停只改开关与阶段，不清当天计数', () => {
    const running = startAutoState(state({ scannedToday: 5 }), NOW)
    expect(running.phase).toBe('scan')
    expect(running.scannedToday).toBe(5)
    const stopped = stopAutoState(running, '手动停止')
    expect(stopped.phase).toBe('idle')
    expect(stopped.startedAt).toBe(0)
  })

  it('快照带出上限、时段与各开关，popup 不用再算', () => {
    const snap = toAutoSnapshot(state({ scannedToday: 2 }), settings({ sendResume: false }), NOW)
    expect(snap.limits.scan).toBe(AUTO_DEFAULTS.dailyScanLimit)
    expect(snap.windowLabel).toBe('09:30–21:00')
    expect(snap.switches.sendResume).toBe(false)
    expect(snap.scannedToday).toBe(2)
  })
})
