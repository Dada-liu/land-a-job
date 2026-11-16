import type { ConversationItem } from './parsers.js'
import { isSelfMessage, matchesStaged } from './reply.js'
import type { StagedJob } from './types.js'

export interface SentDecision {
  sent: boolean
  reason: string
  /** 我发出那条消息 / 系统回执的时间：投递时间就用它 */
  at?: number
  msgId?: number
  /** 证据类型，写进投递时间线的备注 */
  evidence?: 'resume_receipt' | 'self_message'
}

/** 只有「已经回复过」的三个阶段才可能是在发简历 */
const ELIGIBLE: ReadonlySet<StagedJob['state']> = new Set(['replied', 'tailored', 'uploaded'])

/**
 * 2026-11-13 真实响应实测（用户手动给「独创时代」发完附件简历后抓的 friendlist）：
 *
 * ```json
 * { "brandName": "独创时代",
 *   "lastMsg": "对方已同意，您的附件简历已发送给对方",
 *   "lastMessageInfo": { "msgId": 407179415634689,
 *     "showText": "对方已同意，您的附件简历已发送给对方",
 *     "fromId": 519553116, "toId": 504921610, "status": 0,
 *     "msgTime": 1794548237020 } }
 * ```
 *
 * 关键：`fromId === uid && status === 0`——按「消息方向」判据看起来像**对方发的**，
 * 但这其实是 BOSS 在附件简历发送成功后追加的**系统回执**。
 * 也就是说 P3c 原先等的「我自己发的消息（fromId !== uid、status 1/2）」根本不会出现：
 * 它会被回执覆盖掉。所以发送成功的判据必须以这条回执为准。
 */
const RESUME_RECEIPT = /附件简历.{0,16}已发送|您的附件简历已发送给对方|对方已同意.{0,16}附件简历|附件简历请求已发送/

export function isResumeSentReceipt(conv: ConversationItem): boolean {
  return RESUME_RECEIPT.test(`${conv.lastMsg ?? ''} ${conv.showText ?? ''}`)
}

/**
 * P3c：被动读到「简历已发出」→ 推进 applied。
 *
 * 两条证据路径，按可靠性排序：
 * 1. 附件简历发送成功的系统回执（真实流程里最后一条消息就是它）；
 * 2. 兜底：最后一条是我自己发的普通消息（fromId !== uid 且 status 1/2）。
 *
 * 时间下限用 `>=`（允许等于 repliedAt）：回执往往就是触发 replied 的那同一条消息，
 * 用严格大于会把自己挡掉。**不做 msgId 去重**：推进失败要能原样重试，
 * 幂等交给服务端状态机（from === to 直接 no-op），成功后本地 `state='sent'` 保证不再重复推。
 */
export function detectSent(conv: ConversationItem, staged: StagedJob | undefined): SentDecision {
  const skip = (reason: string): SentDecision => ({ sent: false, reason })

  if (!staged) return skip('未匹配到暂存记录')
  if (staged.state === 'sent') return skip('已经推进过 applied')
  if (!ELIGIBLE.has(staged.state)) return skip(`暂存状态为 ${staged.state}，还没到发简历阶段`)
  if (staged.manual) return skip('用户已接手该会话，不再自动记录')
  if (conv.msgId === undefined) return skip('会话没有 msgId')
  if (!matchesStaged(conv, staged)) return skip('会话 ID 与暂存记录不一致')

  const floor = staged.repliedAt ?? staged.greetedAt ?? 0
  if (!floor || conv.lastTS < floor) return skip('消息时间早于上次进展（历史消息）')

  if (isResumeSentReceipt(conv)) {
    return {
      sent: true,
      reason: '读到「附件简历已发送给对方」的系统回执',
      at: conv.lastTS,
      msgId: conv.msgId,
      evidence: 'resume_receipt',
    }
  }
  if (!isSelfMessage(conv)) return skip('最后一条不是我发的，也没有发送成功回执')
  return {
    sent: true,
    reason: '读到我自己发出的消息',
    at: conv.lastTS,
    msgId: conv.msgId,
    evidence: 'self_message',
  }
}
