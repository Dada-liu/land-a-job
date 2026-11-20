import type { BridgeSettings } from './types.js'

/** 提案 §6.3：默认保守。P0 三轮只实测到「刚刚活跃」，其余标签待补样本。 */
export const ACTIVE_DESC_WHITELIST = ['在线', '刚刚活跃', '今日活跃', '3日内活跃'] as const
export const BOSS_ONLINE_AS_ACTIVE = true
export const UNKNOWN_POLICY = 'skip' as const
export const FROZEN_POLICY = 'skip' as const
export const ACTIVE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 提案 §8 风控硬指标；来源见提案表格，改动需同步提案。 */
export const RATE_LIMITS = {
  batchSize: 10,
  dailyLimit: 30,
  minIntervalMs: 1500,
  jitterSigmaMs: 400,
  maxRequestsPerRun: 500,
  hardDailyPlatformLimit: 120,
  hardDailyPlatformCeiling: 150,
  backoffMs: [10_000, 20_000, 40_000, 60_000],
  riskCodes: [9, 31, 37],
} as const

/** 逐任务超时（boss-helper）：超时记失败可续跑，不阻塞整轮。 */
export const TASK_TIMEOUT_MS = {
  ai: 120_000,
  detail: 70_000,
  delivery: 90_000,
  other: 30_000,
} as const

export const STAGING_LIMITS = {
  maxItems: 500,
  ttlMs: 60 * 24 * 60 * 60 * 1000,
  sentTtlMs: 7 * 24 * 60 * 60 * 1000,
} as const

/** P0 实测：friend/add.json 返回的 Boss 默认招呼语，用于排除「自己发的」被误判成回复。 */
export const DEFAULT_BOSS_GREETING =
  '您好，看到您的招聘信息，我很感兴趣，希望可以进一步沟通。'

/**
 * 没打过招呼时，允许「回复早于岗位被抓到」多久。
 * 用户常常先手动打招呼、收到回复，才回头刷岗位列表，所以不能把 capturedAt 直接当下限。
 * 但 7 天窗口太宽：实测把 11-12 的历史回执（拒信、「附件简历已发送」）全判成本轮回复，
 * 一次灌进 9 条 queued 投递，污染漏斗。24 小时足够覆盖「先聊、当天刷列表」，
 * 又只保留当天真正发生的对话。
 */
export const REPLY_LOOKBACK_MS = 24 * 60 * 60 * 1000

/** 只被动旁听这些路径；misc 用于发现改名后的会话接口，不写任何请求。 */
export const ENDPOINT_PATTERNS = [
  { kind: 'joblist', re: /\/wapi\/zpgeek\/search\/joblist\.json/ },
  { kind: 'detail', re: /\/wapi\/zpgeek\/job\/detail\.json/ },
  { kind: 'friendlist', re: /\/wapi\/zprelation\/friend\/getGeekFriendList\.json/ },
  { kind: 'bossdata', re: /\/wapi\/zpchat\/geek\/getBossData/ },
  { kind: 'greet', re: /\/wapi\/zpgeek\/friend\/add\.json/ },
] as const

/** 风控文案：出现任一即熔断停机，不重试、不绕过。 */
export const RISK_TEXT_PATTERNS = [
  /操作过于频繁/,
  /环境存在异常/,
  /今天已与\s*120\s*位/,
  /今天已与\s*150\s*位/,
  /验证码/,
  /请登录后查看/,
] as const

export const STORAGE_KEYS = {
  staging: 'bossBridge.staging',
  settings: 'bossBridge.settings',
  rateLimit: 'bossBridge.rateLimit',
  logs: 'bossBridge.logs',
  auto: 'bossBridge.auto',
  /** 自动化的运行态（phase/今日计数/休息时间），与参数分开放，避免互相覆盖 */
  autoRun: 'bossBridge.auto.run',
} as const

/**
 * 全自动流程的默认参数（保守档）。
 *
 * 三个刻意的取舍：
 * 1. `enabled` 默认 false，且所有写动作（greet / sendGreeting / sendResume）默认 false——
 *    装完不会自己动，必须是用户显式打开。
 * 2. 每日上限远低于平台硬限（120/150 位）：把额度打满本身就是异常特征。
 * 3. 间隔 4–12 秒而不是 1.5 秒：真人不会每隔 1.5 秒精确点一次。
 */
export const AUTO_DEFAULTS = {
  enabled: false,
  scan: true,
  scanDetail: false,
  greet: false,
  sendGreeting: false,
  sendResume: false,
  /** 09:30–21:00；凌晨持续活跃是最容易被判异常的行为 */
  windowStartMin: 9 * 60 + 30,
  windowEndMin: 21 * 60,
  dailyScanLimit: 80,
  dailyGreetLimit: 40,
  dailyMessageLimit: 60,
  gapMinMs: 4000,
  gapMaxMs: 12000,
  scrollGapMs: 120_000,
  restEvery: 5,
  restMinMs: 60_000,
  restMaxMs: 180_000,
} as const

/** 自动化的 tick 间隔（chrome.alarms 最小 1 分钟） */
export const AUTO_ALARM_NAME = 'boss-bridge-auto'
export const AUTO_TICK_MINUTES = 1

export const DEFAULT_SETTINGS: BridgeSettings = {
  apiBase: 'http://127.0.0.1:4399',
  token: '',
  dryRun: true,
  autoOpenDetail: false,
  greetingTemplate:
    '您好，看到贵司{brandName}在招「{jobName}」，我很感兴趣。{highlights}希望能有机会进一步沟通，谢谢！',
  highlights: [],
  /** 默认四类全留，等于不筛选；用户可在设置页勾选 */
  captureCategories: ['experienced', 'campus', 'intern', 'outsourced'],
}

export const ALARM_NAME = 'boss-bridge-watch'
/** chrome.alarms 最小间隔 1 分钟；默认每小时巡检一次 */
export const ALARM_PERIOD_MINUTES = 60
