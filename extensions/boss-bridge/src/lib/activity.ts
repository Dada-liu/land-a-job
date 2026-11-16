import {
  ACTIVE_DESC_WHITELIST,
  ACTIVE_MAX_AGE_MS,
  BOSS_ONLINE_AS_ACTIVE,
  FROZEN_POLICY,
  UNKNOWN_POLICY,
} from './constants.js'
import type { JobListItem } from './parsers.js'
import type { BossActive } from './types.js'

export type GateState = 'needs_detail' | 'ready' | 'filtered_out'
export interface ActivityDecision {
  state: GateState
  reason: string
  /** 未观察到的 desc 文案要记日志，供人工补进白名单 */
  unknownDesc?: string
}

export interface ActivityOptions {
  whitelist?: readonly string[]
  onlineAsActive?: boolean
  unknownPolicy?: 'skip' | 'include'
  frozenPolicy?: 'skip' | 'include'
  maxAgeMs?: number
  now?: number
}

const DEFAULTS: Required<Omit<ActivityOptions, 'now'>> = {
  whitelist: ACTIVE_DESC_WHITELIST,
  onlineAsActive: BOSS_ONLINE_AS_ACTIVE,
  unknownPolicy: UNKNOWN_POLICY,
  frozenPolicy: FROZEN_POLICY,
  maxAgeMs: ACTIVE_MAX_AGE_MS,
}

export function isFrozen(freeze?: number, preFreeze?: number): boolean {
  return (freeze ?? 0) !== 0 || (preFreeze ?? 0) !== 0
}

export function isStale(active: BossActive, now = Date.now(), maxAgeMs = ACTIVE_MAX_AGE_MS): boolean {
  return now - active.capturedAt > maxAgeMs
}

export function isKnownDesc(desc: string | undefined, whitelist: readonly string[]): boolean {
  if (!desc) return false
  return whitelist.some((label) => desc.includes(label))
}

/**
 * 第一段：列表初筛（0 额外请求）。
 *
 * 实测 joblist 列表项只有 `bossOnline`，没有 `activeTimeDesc`。既然第二段把
 * 「`bossOnline === true`」本身当作合法活跃信号（没有 desc 也放行），那这一段就没必要
 * 一律压成 `needs_detail`——否则每抓一批岗位都得手动点一次筛选，状态会一直卡在
 * 「待确认活跃度」。直接放行 true、挡掉 false、只有 **没给证据**（undefined）才等详情。
 */
export function listGate(item: JobListItem, opts: ActivityOptions = {}): ActivityDecision {
  const { onlineAsActive } = { ...DEFAULTS, ...opts }
  if (onlineAsActive && item.bossOnline === false) {
    return { state: 'filtered_out', reason: '列表显示 HR 不在线' }
  }
  if (onlineAsActive && item.bossOnline === true) {
    return { state: 'ready', reason: '列表显示 HR 在线' }
  }
  return { state: 'needs_detail', reason: '列表没给活跃度，等待详情页复核' }
}

/**
 * 第二段：详情复核（只为候选读响应，不主动调用写接口）。
 * 保守顺序：冻结 → 未知标签 → 过期 → 已知活跃信号。
 */
export function detailGate(
  active: BossActive,
  freeze: number | undefined,
  preFreeze: number | undefined,
  opts: ActivityOptions = {},
): ActivityDecision {
  const o = { ...DEFAULTS, ...opts }
  const now = o.now ?? Date.now()

  if (isFrozen(freeze, preFreeze) && o.frozenPolicy === 'skip') {
    return { state: 'filtered_out', reason: '招聘者账号状态异常（freeze 非 0）' }
  }
  if (active.desc && !isKnownDesc(active.desc, o.whitelist)) {
    if (o.unknownPolicy === 'skip') {
      return {
        state: 'filtered_out',
        reason: '活跃度标签未纳入白名单，保守跳过',
        unknownDesc: active.desc,
      }
    }
  }
  if (isStale(active, now, o.maxAgeMs)) {
    return { state: 'needs_detail', reason: '活跃度快照超过 24 小时，发送前需重取' }
  }

  const descHit = isKnownDesc(active.desc, o.whitelist)
  const onlineHit = active.online === true && o.onlineAsActive
  if (descHit || onlineHit) {
    return { state: 'ready', reason: descHit ? `命中白名单「${active.desc}」` : 'HR 在线' }
  }
  return { state: 'filtered_out', reason: '详情里也没有活跃信号，按未知策略跳过' }
}

/** 活跃度不是 fit：只进暂存区与投递备注，不进「匹配度」、不改漏斗口径。 */
export function activeEvidence(active: BossActive): string {
  const parts = [active.desc ?? '', active.online === true ? '在线' : '', active.source].filter(Boolean)
  return `HR 活跃度：${parts.join(' / ') || '未知'}`
}
