import { describe, expect, it } from 'vitest'
import { DEFAULT_BOSS_GREETING } from '../src/lib/constants.js'
import type { ConversationItem } from '../src/lib/parsers.js'
import { detectReply, isDefaultGreeting, isPeerMessage, isSelfMessage, matchesStaged } from '../src/lib/reply.js'
import type { ConversationSnapshot, StagedJob } from '../src/lib/types.js'

/** P0 第三轮真实样本：拓保软件 uid=12648805，11:28 自己打招呼 → 11:31 HR 回复。 */
const base: ConversationItem = {
  uid: 12648805,
  jobId: 587458235,
  brandName: '拓保软件',
  lastTS: 1794454132214,
  lastMsg: DEFAULT_BOSS_GREETING,
  unreadMsgCount: 0,
  msgId: 406793962402049,
  msgTime: 1794454132214,
  fromId: 504921610,
  toId: 12648805,
  status: 1,
}

const peerReply: ConversationItem = {
  ...base,
  lastTS: 1794454310204,
  msgTime: 1794454310204,
  msgId: 406794691391746,
  fromId: 12648805,
  toId: 504921610,
  status: 0,
  lastMsg: '方便发一份简历吗',
}

const staged: StagedJob = {
  key: 'sec-1',
  url: 'https://www.zhipin.com/job_detail/x.html',
  jobName: '前端开发（现场面试+笔试）',
  brandName: '拓保软件',
  bossActive: { online: true, desc: '刚刚活跃', capturedAt: 1794454100000, source: 'detail' },
  state: 'greeted',
  isNew: true,
  capturedAt: 1794454000000,
  greetedAt: 1794454132214,
  encryptBossId: 'enc-boss-1',
}

function snapshot(conv: ConversationItem): ConversationSnapshot {
  return {
    msgId: conv.msgId!, lastTS: conv.lastTS, fromId: conv.fromId!, toId: conv.toId!,
    status: conv.status!, lastMsg: conv.lastMsg, uid: conv.uid,
    brandName: conv.brandName, jobId: conv.jobId,
  }
}

describe('消息方向判据（P0 三轮实测定稿）', () => {
  it('自己发的招呼语不是对方消息', () => {
    expect(isPeerMessage(base)).toBe(false)
    expect(isSelfMessage(base)).toBe(true)
  })

  it('HR 回复时 fromId === uid 且 status === 0', () => {
    expect(isPeerMessage(peerReply)).toBe(true)
    expect(isSelfMessage(peerReply)).toBe(false)
  })

  it('unreadMsgCount 恒为 0 不影响真实回复被识别（撤回旧主判据的回归用例）', () => {
    const decision = detectReply(peerReply, snapshot(base), staged)
    expect(peerReply.unreadMsgCount).toBe(0)
    expect(decision.isReply).toBe(true)
  })

  it('同一条回复重复轮询（msgId 未变）不重复触发', () => {
    const decision = detectReply(peerReply, snapshot(peerReply), staged)
    expect(decision.isReply).toBe(false)
    expect(decision.reason).toContain('重复轮询')
  })

  it('打招呼之前的历史回复不算新回复', () => {
    const older: ConversationItem = { ...peerReply, lastTS: staged.greetedAt! - 1000 }
    expect(detectReply(older, undefined, staged).isReply).toBe(false)
  })

  it('默认招呼语模板一律排除', () => {
    expect(isDefaultGreeting(DEFAULT_BOSS_GREETING)).toBe(true)
    const withGreeting: ConversationItem = { ...peerReply, lastMsg: DEFAULT_BOSS_GREETING }
    expect(detectReply(withGreeting, snapshot(base), staged).isReply).toBe(false)
  })

  it('最后一条是我自己发的：跳过但**不**标记 manual（对方之后回复还能识别）', () => {
    const selfAgain: ConversationItem = {
      ...base, msgId: 406794700000000, lastTS: 1794454400000, status: 2,
      lastMsg: '我自己来聊',
    }
    const decision = detectReply(selfAgain, snapshot(base), staged)
    expect(decision.manual).toBe(false)
    expect(decision.isReply).toBe(false)
    expect(decision.reason).toContain('等对方回复')

    /** 同一会话里对方随后回了一句，仍然要能被识别成回复 */
    const thenPeer: ConversationItem = {
      ...selfAgain, msgId: 406794800000000, lastTS: 1794454500000, fromId: 12648805, toId: 504921610, status: 0, lastMsg: '我们聊一下',
    }
    expect(detectReply(thenPeer, snapshot(selfAgain), { ...staged, state: 'ready' }).isReply).toBe(true)
  })

  it('已标记 manual 的会话不再自动处理', () => {
    const decision = detectReply(peerReply, snapshot(base), { ...staged, manual: true })
    expect(decision.manual).toBe(true)
    expect(decision.isReply).toBe(false)
  })

  it('会话与暂存记录按加密 ID / 公司名对齐', () => {
    expect(matchesStaged(base, staged)).toBe(true)
    expect(matchesStaged({ ...base, brandName: '别的公司' }, { ...staged, encryptBossId: undefined })).toBe(false)
  })

  it('没打招呼就回复（岗位停在 ready / needs_detail）也能判定，不受 greeted 卡门', () => {
    for (const state of ['ready', 'needs_detail', 'filtered_out', 'discovered'] as const) {
      const decision = detectReply(peerReply, snapshot(base), { ...staged, state })
      expect(decision.isReply).toBe(true)
    }
  })

  it('没有 greetedAt：回复早于「抓到岗位」也算回复（用户常常先聊后刷列表）', () => {
    const afterChat = { ...staged, greetedAt: undefined, capturedAt: peerReply.lastTS + 60_000 }
    expect(detectReply(peerReply, undefined, afterChat).isReply).toBe(true)
    const fresh = { ...staged, greetedAt: undefined, capturedAt: peerReply.lastTS - 1 }
    expect(detectReply(peerReply, undefined, fresh).isReply).toBe(true)
  })

  it('没打招呼时，超过 24 小时窗口的历史回复被挡掉（7 天窗口会灌进一堆旧回执）', () => {
    const longAgo: ConversationItem = { ...peerReply, lastTS: staged.capturedAt - 2 * 24 * 60 * 60 * 1000 }
    expect(detectReply(longAgo, undefined, { ...staged, greetedAt: undefined }).isReply).toBe(false)
    expect(detectReply(longAgo, undefined, { ...staged, greetedAt: undefined }).reason).toContain('历史消息')
  })

  it('已经过了回复阶段（已定制/已上传/已发出）不再重新判定', () => {
    for (const state of ['replied', 'tailored', 'uploaded', 'sent', 'archived'] as const) {
      const decision = detectReply(peerReply, undefined, { ...staged, state })
      expect(decision.isReply).toBe(false)
      expect(decision.reason).toContain('已过回复阶段')
    }
  })
})
