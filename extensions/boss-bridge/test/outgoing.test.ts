import { describe, expect, it } from 'vitest'
import { detectSent, isResumeSentReceipt } from '../src/lib/outgoing.js'
import type { ConversationItem } from '../src/lib/parsers.js'
import { pushApplied } from '../src/lib/sync.js'
import type { StagedJob } from '../src/lib/types.js'

const now = 1794454300000
const uid = 12648805
const me = 504921610

/** 对方回复后，我发了一条带附件简历的消息 */
const selfSent: ConversationItem = {
  uid,
  jobId: 587458235,
  brandName: '拓保软件',
  lastTS: now,
  lastMsg: '[附件简历]',
  unreadMsgCount: 0,
  msgId: 406795000000001,
  msgTime: now,
  fromId: me,
  toId: uid,
  status: 1,
  encryptBossId: 'enc-boss-1',
}

const peerReplied: ConversationItem = {
  ...selfSent,
  lastTS: now - 60_000,
  msgTime: now - 60_000,
  msgId: 406794691391746,
  fromId: uid,
  toId: me,
  status: 0,
  lastMsg: '方便发一份简历吗',
}

function staged(patch: Partial<StagedJob> = {}): StagedJob {
  return {
    key: 'sec-1',
    url: 'https://www.zhipin.com/job_detail/x.html',
    jobName: '前端开发',
    brandName: '拓保软件',
    bossActive: { online: true, desc: '刚刚活跃', capturedAt: now - 100_000, source: 'detail' },
    state: 'uploaded',
    isNew: false,
    capturedAt: now - 200_000,
    greetedAt: now - 300_000,
    repliedAt: now - 60_000,
    encryptBossId: 'enc-boss-1',
    conversationId: `${uid}:587458235`,
    attachmentName: '拓保软件-前端开发.pdf',
    landSync: {
      companyId: 'c1',
      jobId: 'j1',
      applicationId: 'p1',
      syncedAt: now - 50_000,
      reused: { company: false, job: false, application: false },
    },
    ...patch,
  }
}

describe('P3c 读到「我发出的消息」→ 推进 applied', () => {
  it('回复之后我自己发了消息：判定成立并给出投递时间', () => {
    const decision = detectSent(selfSent, staged())
    expect(decision.sent).toBe(true)
    expect(decision.at).toBe(now)
    expect(decision.msgId).toBe(selfSent.msgId)
  })

  it('最后一条是对方的：不算', () => {
    expect(detectSent(peerReplied, staged()).sent).toBe(false)
  })

  it('还在 greeted 阶段（招呼语本身）：不算', () => {
    const decision = detectSent(selfSent, staged({ state: 'greeted' }))
    expect(decision.sent).toBe(false)
    expect(decision.reason).toContain('greeted')
  })

  it('已经推进过：不重复', () => {
    expect(detectSent(selfSent, staged({ state: 'sent' })).reason).toBe('已经推进过 applied')
  })

  it('还没落库也先认下发送证据（background 会记 pendingApplied，JD 补齐后补推）', () => {
    const decision = detectSent(selfSent, staged({ landSync: undefined }))
    expect(decision.sent).toBe(true)
    expect(decision.at).toBe(now)
  })

  it('真实回执：fromId === uid、status 0 的「附件简历已发送」也算发送成功', () => {
    /** 2026-11-13 13:37 独创时代，用户手动发完附件简历后抓到的 friendlist 原始字段 */
    const receipt: ConversationItem = {
      uid: 519553116,
      jobId: 584782585,
      brandName: '独创时代',
      lastTS: 1794548237020,
      msgTime: 1794548237020,
      msgId: 407179415634689,
      fromId: 519553116,
      toId: me,
      status: 0,
      lastMsg: '对方已同意，您的附件简历已发送给对方',
      showText: '对方已同意，您的附件简历已发送给对方',
      unreadMsgCount: 0,
      encryptBossId: 'enc-boss-1',
    }
    expect(isResumeSentReceipt(receipt)).toBe(true)
    const decision = detectSent(receipt, staged({ repliedAt: receipt.lastTS, state: 'replied' }))
    expect(decision.sent).toBe(true)
    expect(decision.evidence).toBe('resume_receipt')
    expect(decision.at).toBe(receipt.lastTS)
    expect(decision.msgId).toBe(receipt.msgId)
    // 回执与触发 replied 的是同一条消息，时间相等不能被历史消息判据挡掉
    expect(decision.reason).toContain('系统回执')
  })

  it('消息时间不晚于回复时间：历史消息，不算', () => {
    const old = { ...selfSent, lastTS: now - 120_000, msgTime: now - 120_000 }
    expect(detectSent(old, staged()).sent).toBe(false)
  })

  it('用户接手过该会话：不再自动记录', () => {
    expect(detectSent(selfSent, staged({ manual: true })).reason).toContain('已接手')
  })

  it('会话对不上（公司名与加密 ID 都不匹配）：不算', () => {
    const other = { ...selfSent, encryptBossId: 'enc-boss-9', brandName: '别家公司' }
    expect(detectSent(other, staged()).sent).toBe(false)
  })
})

describe('pushApplied：先写服务端再改本地状态', () => {
  it('成功时写 applied 并把状态推到 sent', async () => {
    const calls: { applicationId: string; appliedAt: string; note?: string }[] = []
    const job = staged()
    const outcome = await pushApplied(
      job,
      { at: now, msgId: selfSent.msgId },
      { markApplied: async (applicationId, appliedAt, note) => { calls.push({ applicationId, appliedAt, note }) } },
    )
    expect(outcome.pushed).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].applicationId).toBe('p1')
    expect(calls[0].appliedAt).toBe(new Date(now).toISOString())
    expect(calls[0].note).toContain('附件简历：拓保软件-前端开发.pdf')
    expect(job.state).toBe('sent')
    expect(job.sentAt).toBe(now)
    expect(job.sentMsgId).toBe(selfSent.msgId)
  })

  it('服务端失败时保留原状态，供下一轮重试', async () => {
    const job = staged()
    const outcome = await pushApplied(
      job,
      { at: now },
      { markApplied: async () => { throw new Error('409 非法状态流转') } },
    )
    expect(outcome.pushed).toBe(false)
    expect(outcome.reason).toContain('409')
    expect(job.state).toBe('uploaded')
    expect(job.sentAt).toBeUndefined()
  })

  it('没有 applicationId 直接返回失败，不调用服务端', async () => {
    let called = 0
    const outcome = await pushApplied(
      staged({ landSync: undefined }),
      { at: now },
      { markApplied: async () => { called += 1 } },
    )
    expect(outcome.pushed).toBe(false)
    expect(called).toBe(0)
  })
})
