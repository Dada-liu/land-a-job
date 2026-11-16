import { describe, expect, it } from 'vitest'
import { platformHardLimitCount, RateLimiter, type RateLimitOptions } from '../src/lib/rate-limit.js'

function harness(overrides: Partial<RateLimitOptions> = {}) {
  let clock = 1000
  const limiter = new RateLimiter(null, {
    now: () => clock,
    day: () => '2026-11-12',
    rng: () => 0.5,
    ...overrides,
  })
  return { limiter, advance: (ms: number) => { clock += ms } }
}

describe('限速与熔断（提案 §8）', () => {
  it('本轮第一次动作不需要先等待', () => {
    const { limiter } = harness()
    expect(limiter.canAct().ok).toBe(true)
  })

  it('两次动作间隔不足 1.5s 时拒绝，并给出等待时长', () => {
    const { limiter, advance } = harness()
    limiter.recordAction()
    advance(400)
    const check = limiter.canAct()
    expect(check.ok).toBe(false)
    expect(check.waitMs).toBe(1100)
  })

  it('间隔满足后可以继续', () => {
    const { limiter, advance } = harness()
    limiter.recordAction()
    advance(1600)
    expect(limiter.canAct().ok).toBe(true)
  })

  it('nextDelayMs 永远不低于 1.5s', () => {
    const { limiter } = harness({ rng: () => 0.99 })
    for (let i = 0; i < 20; i += 1) expect(limiter.nextDelayMs()).toBeGreaterThanOrEqual(1500)
  })

  it('单批 ≤10', () => {
    const { limiter, advance } = harness()
    for (let i = 0; i < 10; i += 1) {
      limiter.recordAction()
      advance(2000)
    }
    expect(limiter.snapshot.actionsInBatch).toBe(10)
    expect(limiter.canAct().reason).toContain('单批上限')
  })

  it('每日 ≤30，startRun 不重置当日总量', () => {
    const { limiter, advance } = harness({ limits: { batchSize: 100 } })
    for (let i = 0; i < 30; i += 1) {
      limiter.recordAction()
      advance(2000)
    }
    expect(limiter.canAct().reason).toContain('每日上限')
    limiter.startRun()
    expect(limiter.canAct().reason).toContain('每日上限')
  })

  it('跨天自动重置当日计数，但保留熔断状态', () => {
    let day = '2026-11-12'
    const limiter = new RateLimiter(null, {
      now: () => 1000,
      day: () => day,
      limits: { dailyLimit: 1 },
    })
    limiter.recordAction()
    expect(limiter.canAct().ok).toBe(false)
    day = '2026-11-13'
    expect(limiter.canAct().ok).toBe(true)
  })

  it('code 9/31/37 触发熔断，退避逐级递增且不自动恢复', () => {
    const { limiter } = harness()
    expect(limiter.noteRisk(9, '')).toBe(true)
    expect(limiter.backoffMs).toBe(10_000)
    limiter.noteRisk(31, '')
    expect(limiter.backoffMs).toBe(20_000)
    expect(limiter.canAct().reason).toContain('熔断')
    expect(limiter.snapshot.tripped).toBe(true)
  })

  it('嵌套业务编码（P0 第二轮的假风控码）不触发熔断', () => {
    const { limiter } = harness()
    expect(limiter.noteRisk(101094, '')).toBe(false)
    expect(limiter.canAct().ok).toBe(true)
  })

  it('频繁/环境异常/硬限额文案立即停机', () => {
    const { limiter } = harness()
    expect(limiter.noteRisk(0, '操作过于频繁，请稍后再试')).toBe(true)
    expect(limiter.canAct().ok).toBe(false)
  })

  it('「今天已与 120 位 BOSS 沟通」触发硬限额', () => {
    const { limiter } = harness()
    expect(limiter.notePlatformHardLimit(119)).toBe(false)
    expect(limiter.notePlatformHardLimit(120)).toBe(true)
    expect(limiter.snapshot.tripReason).toContain('120')
  })

  it('从平台文案里读出硬限额数字（两种写法 + 文案变动都能认）', () => {
    expect(platformHardLimitCount('今天已与 120 位 BOSS 沟通')).toBe(120)
    expect(platformHardLimitCount('今日已沟通 150 位 BOSS，请明天再来')).toBe(150)
    expect(platformHardLimitCount('操作过于频繁')).toBeNull()
    expect(platformHardLimitCount('')).toBeNull()
  })

  it('硬限额提示挂在 code=0 的正常响应里也要熔断', () => {
    const { limiter } = harness()
    expect(limiter.noteRiskSignal(0, '今天已与 120 位 BOSS 沟通')).toBe(true)
    expect(limiter.snapshot.tripped).toBe(true)
    // 原因要说清「不是扩展的每日上限」，否则用户会去改 dailyLimit
    expect(limiter.snapshot.tripReason).toContain('不是扩展的每日上限')
  })

  it('单轮请求预算 500', () => {
    const { limiter } = harness()
    limiter.noteRequest(500)
    expect(limiter.canAct().reason).toContain('请求预算')
  })

  it('序列化后可恢复，reset 才清除熔断', () => {
    const { limiter } = harness()
    limiter.noteRisk(37, '')
    const restored = new RateLimiter(limiter.serialize(), { now: () => 1000, day: () => '2026-11-12' })
    expect(restored.snapshot.tripped).toBe(true)
    restored.reset()
    expect(restored.canAct().ok).toBe(true)
  })
})
