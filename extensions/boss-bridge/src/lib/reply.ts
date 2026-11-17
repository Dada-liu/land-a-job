import { DEFAULT_BOSS_GREETING, REPLY_LOOKBACK_MS } from './constants.js'
import { matchesConversation } from './match.js'
import type { ConversationItem } from './parsers.js'
import type { ConversationSnapshot, StagedJob } from './types.js'

/**
 * P0 三轮实测定稿的回复判据（提案 §7.1）。
 *
 * `unreadMsgCount` 实测恒为 0（页面打开后已读归零），只作提示、不作判据。
 * `lastMessageInfo.fromId === result[].uid && status === 0` ⇒ 最后一条来自对方；
 * `status` 1/2 是自己发的（已送达/已读），且会随时间变化。
 */
export function isPeerMessage(conv: ConversationItem): boolean {
  return (
    conv.msgId !== undefined &&
    conv.fromId !== undefined &&
    conv.fromId === conv.uid &&
    conv.status === 0
  )
}

export function isSelfMessage(conv: ConversationItem): boolean {
  return (
    conv.fromId !== undefined &&
    conv.fromId !== conv.uid &&
    (conv.status === 1 || conv.status === 2)
  )
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[\u200B-\u200F\uFEFF]/g, '')
}

/** 两条消息是不是同一句（忽略空白与零宽字符） */
export function isSameMessage(text: string, expected: string): boolean {
  const a = normalize(text)
  return a.length > 0 && a === normalize(expected)
}

export function isDefaultGreeting(text: string, greeting = DEFAULT_BOSS_GREETING): boolean {
  return isSameMessage(text, greeting)
}

/**
 * 「定制招呼语发出」的判据（只读会话列表，不点发送）。
 *
 * 顺序是：先有 `greetedAt`（用户手动发过默认招呼语），之后会话里又出现一条**自己发的**、
 * 且不是 BOSS 默认模板的消息——那就是他复制草稿发出去的那条。
 * 用户常常会把草稿改两句再发，所以文案不一致不算失败，只在备注里标出来。
 */
export interface GreetSentDecision {
  sent: boolean
  at?: number
  /** 发出去的文字与插件生成的草稿是否一致 */
  matchedDraft: boolean
  reason: string
}

export function detectGreetSent(
  conv: ConversationItem,
  staged: StagedJob | undefined,
  opts: { defaultGreeting?: string } = {},
): GreetSentDecision {
  const greeting = opts.defaultGreeting ?? DEFAULT_BOSS_GREETING
  const base: GreetSentDecision = { sent: false, matchedDraft: false, reason: '' }
  if (!staged) return { ...base, reason: '未匹配到暂存记录' }
  if (staged.greetSentAt) return { ...base, reason: '已记录过定制版发出时间' }
  if (!staged.greetedAt) return { ...base, reason: '还没打过招呼，谈不上定制版' }
  if (!isSelfMessage(conv)) return { ...base, reason: '最后一条不是自己发的' }
  if (isDefaultGreeting(conv.lastMsg, greeting)) return { ...base, reason: '最后一条仍是 BOSS 默认招呼语' }
  if (!conv.lastTS || conv.lastTS <= staged.greetedAt) {
    return { ...base, reason: '消息时间早于打招呼时间（历史消息）' }
  }
  return {
    sent: true,
    at: conv.lastTS,
    matchedDraft: Boolean(staged.greetDraft && isSameMessage(conv.lastMsg, staged.greetDraft)),
    reason: '打过招呼之后又发了一条自己的消息',
  }
}

export function toSnapshot(conv: ConversationItem): ConversationSnapshot | null {
  if (conv.msgId === undefined) return null
  return {
    msgId: conv.msgId,
    lastTS: conv.lastTS,
    fromId: conv.fromId ?? 0,
    toId: conv.toId ?? 0,
    status: conv.status ?? -1,
    lastMsg: conv.lastMsg,
    uid: conv.uid,
    brandName: conv.brandName,
    jobId: conv.jobId,
    encryptBossId: conv.encryptBossId,
    encryptJobId: conv.encryptJobId,
  }
}

/**
 * 会话与暂存记录对齐：交给 match.ts 的加权打分。
 *
 * 会话列表的 `encryptBossId`/`encryptJobId` 与岗位列表的不是同一套（实测 104 条里只对上 4 条），
 * 旧版「两边都有 ID 却不等就直接 false」会把公司名完全相同的记录判成不匹配。
 */
export function matchesStaged(conv: ConversationItem, staged: StagedJob): boolean {
  return matchesConversation(staged, conv)
}

export interface ReplyDecision {
  isReply: boolean
  /** 用户在打招呼之后自己又发了消息：该会话自动化立即停止 */
  manual: boolean
  reason: string
  snapshot: ConversationSnapshot | null
}

export interface ReplyOptions {
  defaultGreeting?: string
  now?: number
}

/**
 * 已经越过「等回复」的阶段：不再重新判回复。
 * `replied` 的重试走 syncOnReply 里的专门分支，这里不重复处理。
 */
const AFTER_REPLY: ReadonlySet<StagedJob['state']> = new Set([
  'replied', 'tailored', 'uploaded', 'sent', 'archived',
])

/**
 * 四条件全部满足才算「任意回复」；任一不满足都给出可读原因，便于日志与自检。
 *
 * 关于状态：**不要求 `state === 'greeted'`**。扩展从没代发过招呼语（最后一击永远留给人），
 * 所以绝大多数岗位停在 `ready / needs_detail`；按 greeted 卡门会导致「公司明明回了却永远检测不到」。
 * 现在只要还没进回复之后的阶段就都允许判定，历史消息由时间下限挡掉。
 */
export function detectReply(
  conv: ConversationItem,
  prev: ConversationSnapshot | undefined,
  staged: StagedJob | undefined,
  opts: ReplyOptions = {},
): ReplyDecision {
  const snapshot = toSnapshot(conv)
  const greeting = opts.defaultGreeting ?? DEFAULT_BOSS_GREETING
  const base: ReplyDecision = { isReply: false, manual: false, reason: '', snapshot }

  if (!snapshot) return { ...base, reason: '会话没有 msgId，跳过' }
  if (!staged) return { ...base, reason: '未匹配到暂存记录' }
  if (AFTER_REPLY.has(staged.state)) {
    return { ...base, reason: `暂存状态为 ${staged.state}，已过回复阶段` }
  }
  if (staged.manual) return { ...base, reason: '用户已接手该会话，自动化停止', manual: true }
  if (conv.msgId === prev?.msgId) return { ...base, reason: 'msgId 与上一轮相同，重复轮询' }

  /**
   * 时间下限：打过招呼用打招呼时间；**没打过招呼不能用「首次抓到岗位的时间」当下限**。
   *
   * 扩展从不代发招呼语，用户往往是先手动打完招呼、收到回复，之后才去刷岗位列表，
   * 于是「回复早于 capturedAt」是常态。旧判据把这类回复一律判成历史消息，
   * 症状就是「公司明明回了，岗位还停在 ready / needs_detail」。
   * 改成以「抓到岗位之前的 N 天」为窗口，既能捞回真实回复，也能挡掉上个月的历史消息。
   */
  const floor = staged.greetedAt ?? (staged.capturedAt ? staged.capturedAt - REPLY_LOOKBACK_MS : 0)
  if (!floor || conv.lastTS <= floor) {
    return { ...base, reason: '消息时间早于时间窗口（历史消息）' }
  }
  if (!isPeerMessage(conv)) {
    /**
     * 最后一条是我自己发的（多半就是你手动发的那句招呼语）。
     * **刻意不置 manual**：manual 会让这个岗位此后再也不被检查，而「我发过话」只是
     * 「还在等对方回」，不是「用户接手了、别管了」。等对方真回了，仍要能识别。
     */
    if (isSelfMessage(conv)) return { ...base, reason: '最后一条是我自己发的，还在等对方回复' }
    return { ...base, reason: '最后一条不是对方发的（fromId/status 不匹配）' }
  }
  if (isDefaultGreeting(conv.lastMsg, greeting)) {
    return { ...base, reason: '最后一条是默认招呼语模板' }
  }
  if (!matchesStaged(conv, staged)) {
    return { ...base, reason: '会话 ID 与暂存记录不一致' }
  }

  return { isReply: true, manual: false, reason: '检测到公司回复', snapshot }
}
