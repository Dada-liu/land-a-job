/**
 * 投递状态机：唯一权威定义。
 *
 * 放在 core 而不是 server，因为 Web（按钮禁用态）、MCP（工具描述）、
 * Skill（工作流分支）都要读同一份规则；三处各写一份必然漂移。
 */

export const STATUSES = [
  'lead',
  'queued',
  'applied',
  'screening',
  'assessment',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'ghosted',
  'withdrawn',
] as const

export type Status = (typeof STATUSES)[number]

/**
 * 允许的跃迁。
 *
 * 设计取舍：
 * - 不允许 lead → applied：先入队再投递，否则「计划投但没投」的状态无处安放。
 * - 允许任意前置状态 → withdrawn：用户随时可以撤回。
 * - 终态不可直接复活，必须显式 force（见 assertTransition），且强制留痕。
 */
const TRANSITIONS: Record<Status, readonly Status[]> = {
  lead: ['queued', 'withdrawn'],
  queued: ['applied', 'withdrawn'],
  applied: ['screening', 'assessment', 'interview', 'rejected', 'ghosted', 'withdrawn'],
  screening: ['assessment', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn'],
  assessment: ['interview', 'offer', 'rejected', 'ghosted', 'withdrawn'],
  interview: ['offer', 'rejected', 'ghosted', 'withdrawn'],
  offer: ['accepted', 'rejected', 'withdrawn'],
  accepted: [],
  rejected: [],
  ghosted: [],
  withdrawn: [],
}

/** 终态：不再产生跟进任务，也不允许被自动规则修改 */
export const TERMINAL_STATUSES = ['accepted', 'rejected', 'ghosted', 'withdrawn'] as const
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number]

/** 活跃状态：与 001_init.sql 的 ux_app_active 部分唯一索引必须保持一致 */
export const ACTIVE_STATUSES = STATUSES.filter(
  (s) => !(TERMINAL_STATUSES as readonly string[]).includes(s),
) as Status[]

/** 漏斗阶段序：用于计算「推进了几级」与漏斗排序 */
export const STAGE_ORDER: Partial<Record<Status, number>> = {
  lead: 0,
  queued: 50,
  applied: 100,
  screening: 200,
  assessment: 250,
  interview: 300,
  offer: 400,
  accepted: 500,
}

/** 状态的中文短标签：Web 徽章、日报、MCP 返回值共用，避免各端各写一套 */
export const STATUS_LABELS: Record<Status, string> = {
  lead: '线索',
  queued: '待投',
  applied: '已投',
  screening: '筛选中',
  assessment: '笔试/作业',
  interview: '面试中',
  offer: '已发 offer',
  accepted: '已接受',
  rejected: '被拒',
  ghosted: '无回音',
  withdrawn: '已撤回',
}

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function isTerminal(status: Status): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

export function nextStatuses(status: Status): readonly Status[] {
  return TRANSITIONS[status]
}

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError'

  constructor(
    readonly from: Status,
    readonly to: Status,
    readonly allowed: readonly Status[],
  ) {
    const hint = allowed.length === 0 ? '无（终态）' : allowed.join(', ')
    super(`当前状态「${STATUS_LABELS[from]}」不能变为「${STATUS_LABELS[to]}」；允许：${hint}`)
  }
}

/**
 * 校验跃迁。同状态视为幂等空操作（直接返回），因为「重复点一次」不该报错。
 * force 只用于人工修正（如误标被拒后复活），调用方必须在事件里记录原因。
 */
export function assertTransition(from: Status, to: Status, force = false): void {
  if (from === to) return
  const allowed = TRANSITIONS[from]
  if (force) return
  if (!allowed.includes(to)) throw new InvalidTransitionError(from, to, allowed)
}

/** 事件类型：与 application_event.type 取值一一对应 */
export const EVENT_TYPES = [
  'created',
  'status_changed',
  'note',
  'resume_linked',
  'interview_scheduled',
  'offer_received',
  'deleted',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** 投递渠道：官网直投是主路径，平台内投递只登记不自动化（PRD D2） */
export const CHANNELS = ['official', 'referral', 'platform', 'other'] as const
export type Channel = (typeof CHANNELS)[number]

/** 证据置信度：Agent 抓取的表单结果未经人工确认时为 reported */
export const CONFIDENCES = ['reported', 'confirmed', 'screenshot'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const ACTORS = ['user', 'agent', 'rule'] as const
export type Actor = (typeof ACTORS)[number]

export const SOURCES = ['web', 'mcp', 'cli', 'rule'] as const
export type Source = (typeof SOURCES)[number]
