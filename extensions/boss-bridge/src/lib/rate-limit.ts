import { RATE_LIMITS, RISK_TEXT_PATTERNS } from './constants.js'
import type { RateLimitSnapshot } from './types.js'

/** 可覆盖的风控参数；用 number 而非字面量类型，单测与用户配置才能自由调小。 */
export interface RateLimitConfig {
  batchSize: number
  dailyLimit: number
  minIntervalMs: number
  jitterSigmaMs: number
  maxRequestsPerRun: number
  hardDailyPlatformLimit: number
  hardDailyPlatformCeiling: number
  backoffMs: readonly number[]
  riskCodes: readonly number[]
}

export interface RateLimitOptions {
  limits?: Partial<RateLimitConfig>
  now?: () => number
  rng?: () => number
  day?: () => string
}

export interface ActionCheck {
  ok: boolean
  reason: string
  waitMs: number
}

function emptySnapshot(day: string): RateLimitSnapshot & { day: string } {
  return {
    actionsToday: 0,
    actionsInBatch: 0,
    requestsInRun: 0,
    tripped: false,
    backoffStep: 0,
    lastActionAt: 0,
    day,
  }
}

/** Box-Muller，用可注入 rng 保证测试可复现。 */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * 从平台提示里读「今天已与 N 位 BOSS 沟通」的 N。
 *
 * boss-helper 的这条硬限额实测有两种写法（120 / 150），文案还可能变；
 * 所以只认「今天/今日 + 已与 + 数字 + 位」，不依赖具体数字，也不依赖 code 非 0
 * （实测这类提示有时挂在 `code: 0` 的正常响应里）。
 */
export function platformHardLimitCount(message: string): number | null {
  const match = /(今天|今日)已(?:与|沟通)\s*(\d{1,3})\s*位/.exec(message)
  if (!match) return null
  const count = Number(match[2])
  return Number.isFinite(count) ? count : null
}

export type PersistedRateLimit = RateLimitSnapshot & { day: string }

/**
 * 提案 §8 的限速与熔断。所有状态可序列化进 chrome.storage.local，重启后继续生效。
 * 熔断一旦触发就不自动恢复，必须用户手工 reset()（避免自动重试放大风控）。
 */
export class RateLimiter {
  private state: PersistedRateLimit
  private readonly limits: RateLimitConfig
  private readonly now: () => number
  private readonly rng: () => number
  private readonly day: () => string

  constructor(saved?: PersistedRateLimit | null, opts: RateLimitOptions = {}) {
    this.limits = { ...RATE_LIMITS, ...opts.limits }
    this.now = opts.now ?? Date.now
    this.rng = opts.rng ?? Math.random
    this.day = opts.day ?? (() => new Date(this.now()).toISOString().slice(0, 10))
    this.state = saved ?? emptySnapshot(this.day())
    this.rollDay()
  }

  private rollDay(): void {
    const today = this.day()
    if (this.state.day !== today) {
      this.state = { ...emptySnapshot(today), tripped: this.state.tripped, tripReason: this.state.tripReason }
    }
  }

  serialize(): PersistedRateLimit {
    return { ...this.state }
  }

  /** 单轮开始：重置批次计数与请求预算，不重置当日总量与熔断状态。 */
  startRun(): void {
    this.rollDay()
    this.state.actionsInBatch = 0
    this.state.requestsInRun = 0
  }

  reset(): void {
    this.state = emptySnapshot(this.day())
  }

  get snapshot(): Readonly<PersistedRateLimit> {
    return { ...this.state }
  }

  /** 顶层业务响应码与风控文案；嵌套 code 不要传进来（P0 第二轮修复）。 */
  noteRisk(code?: number, message?: string): boolean {
    const codeHit = code !== undefined && this.limits.riskCodes.includes(code)
    const textHit = Boolean(message && RISK_TEXT_PATTERNS.some((re) => re.test(message)))
    if (!codeHit && !textHit) return false
    this.state.tripped = true
    this.state.tripReason = message?.trim() || `业务响应码 ${code}`
    this.state.backoffStep = Math.min(
      this.state.backoffStep + 1,
      this.limits.backoffMs.length,
    )
    return true
  }

  /**
   * 「今天已与 120 / 150 位 BOSS 沟通」：到达硬限额立即停机，不代点确认。
   *
   * 两个数字都算触发（>= 120 即停），150 只用于把「部分账号上限更高」写进原因，
   * 免得用户看到 120 的提示以为是扩展自己的每日上限（那是 `dailyLimit`）。
   */
  notePlatformHardLimit(count: number): boolean {
    if (count < this.limits.hardDailyPlatformLimit) return false
    this.state.tripped = true
    this.state.tripReason =
      `平台提示今日已沟通 ${count} 位 BOSS（硬上限 ${this.limits.hardDailyPlatformLimit}，部分账号 ${this.limits.hardDailyPlatformCeiling}）`
      + `；这不是扩展的每日上限 ${this.limits.dailyLimit}，明天再操作，点「解除保护」后才继续`
    return true
  }

  /**
   * 统一入口：先认「今天已与 N 位」的硬限额（有确定数字），再退回 code / 文案。
   * background 与 pipeline 都走这里，避免两处判据分叉。
   */
  noteRiskSignal(code?: number, message?: string): boolean {
    const count = platformHardLimitCount(message ?? '')
    if (count !== null) return this.notePlatformHardLimit(count)
    return this.noteRisk(code, message)
  }

  get backoffMs(): number {
    const steps = this.limits.backoffMs
    return steps[Math.max(0, Math.min(this.state.backoffStep - 1, steps.length - 1))] ?? 60_000
  }

  noteRequest(count = 1): void {
    this.state.requestsInRun += count
  }

  canAct(): ActionCheck {
    this.rollDay()
    const s = this.state
    if (s.tripped) return { ok: false, reason: `已熔断：${s.tripReason ?? '风控信号'}`, waitMs: 0 }
    if (s.actionsToday >= this.limits.dailyLimit) {
      return { ok: false, reason: `已达每日上限 ${this.limits.dailyLimit}`, waitMs: 0 }
    }
    if (s.actionsInBatch >= this.limits.batchSize) {
      return { ok: false, reason: `已达单批上限 ${this.limits.batchSize}`, waitMs: 0 }
    }
    if (s.requestsInRun >= this.limits.maxRequestsPerRun) {
      return { ok: false, reason: `已达单轮请求预算 ${this.limits.maxRequestsPerRun}`, waitMs: 0 }
    }
    // 本轮还没动作过时不必先等 1.5s
    const elapsed = s.lastActionAt === 0 ? this.limits.minIntervalMs : this.now() - s.lastActionAt
    const waitMs = Math.max(0, this.limits.minIntervalMs - elapsed)
    if (waitMs > 0) return { ok: false, reason: '限速间隔未到', waitMs }
    return { ok: true, reason: '', waitMs: 0 }
  }

  recordAction(): void {
    this.rollDay()
    this.state.actionsToday += 1
    this.state.actionsInBatch += 1
    this.state.requestsInRun += 1
    this.state.lastActionAt = this.now()
  }

  /** 1.5s + Gaussian jitter，下限仍是 1.5s；禁止并行请求。 */
  nextDelayMs(): number {
    const jitter = gaussian(this.rng) * this.limits.jitterSigmaMs
    return Math.max(this.limits.minIntervalMs, Math.round(this.limits.minIntervalMs + jitter))
  }
}
