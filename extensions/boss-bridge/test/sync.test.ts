import { describe, expect, it } from 'vitest'
import { DEFAULT_BOSS_GREETING } from '../src/lib/constants.js'
import type { ConversationItem } from '../src/lib/parsers.js'
import { buildSyncNotes, syncOnReply, syncRepliedJob, type BridgeLike } from '../src/lib/sync.js'
import type { ConversationSnapshot, StagedJob } from '../src/lib/types.js'

const now = 1794454310204

/** P0 第三轮真实回复样本：拓保软件 uid=12648805 */
const peerReply: ConversationItem = {
  uid: 12648805,
  jobId: 587458235,
  brandName: '拓保软件',
  lastTS: now,
  msgTime: now,
  msgId: 406794691391746,
  fromId: 12648805,
  toId: 504921610,
  status: 0,
  lastMsg: '方便发一份简历吗',
  unreadMsgCount: 0,
}

const selfGreeting: ConversationItem = {
  ...peerReply,
  msgId: 406793962402049,
  lastTS: 1794454132214,
  fromId: 504921610,
  toId: 12648805,
  status: 1,
  lastMsg: DEFAULT_BOSS_GREETING,
}

function staged(patch: Partial<StagedJob> = {}): StagedJob {
  return {
    key: 'sec-1',
    url: 'https://www.zhipin.com/job_detail/sec-1.html',
    jobName: '前端开发（现场面试+笔试）',
    brandName: '拓保软件',
    salaryDesc: '15-25K',
    city: '深圳',
    jdText: '岗位职责：前端开发，熟悉 React 与 TypeScript。'.repeat(4),
    bossActive: { online: true, desc: '刚刚活跃', capturedAt: now - 1000, source: 'detail' },
    greetDraft: '您好，看到贵司岗位很感兴趣…',
    state: 'greeted',
    isNew: true,
    capturedAt: 1794454000000,
    greetedAt: 1794454132214,
    ...patch,
  }
}

function mockBridge(opts: {
  company?: { id: string } | null
  job?: { id: string } | null
  application?: { id: string; status?: string } | null
  healthOk?: boolean
  failOn?: string
} = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args })
    if (opts.failOn === name) throw new Error(`${name} 故障`)
  }
  const bridge: BridgeLike = {
    health: async () => {
      calls.push({ name: 'health', args: [] })
      return { ok: opts.healthOk ?? true, message: opts.healthOk === false ? '服务不可达' : 'ok' }
    },
    findCompanyByName: async (n) => { record('findCompanyByName')(n); return opts.company ?? null },
    createCompany: async (n, c) => { record('createCompany')(n, c); return 'c-1' },
    findJobByUrl: async (u) => { record('findJobByUrl')(u); return opts.job ?? null },
    createJob: async (i) => { record('createJob')(i); return 'j-1' },
    importJd: async (...a) => { record('importJd')(...a) },
    scoreJob: async (i) => { record('scoreJob')(i); return 72 },
    findApplicationByJob: async (i) => { record('findApplicationByJob')(i); return opts.application ?? null },
    createApplication: async (i) => { record('createApplication')(i); return 'a-1' },
    appendNote: async (...a) => { record('appendNote')(...a) },
  }
  return { bridge, calls, names: () => calls.map((c) => c.name) }
}

const snapshot = (conv: ConversationItem): ConversationSnapshot => ({
  msgId: conv.msgId!, lastTS: conv.lastTS, fromId: conv.fromId!, toId: conv.toId!,
  status: conv.status!, lastMsg: conv.lastMsg, uid: conv.uid,
})

describe('P2 回复后延迟落库（回放第三轮真实回复）', () => {
  it('真实回复恰好建 1 个公司 + 1 个岗位 + 1 条 queued 投递', async () => {
    const { bridge, calls, names } = mockBridge()
    const job = staged()
    const outcome = await syncOnReply(peerReply, snapshot(selfGreeting), job, bridge, { now: () => now })

    expect(outcome.synced).toBe(true)
    expect(names()).toEqual([
      'health', 'findCompanyByName', 'createCompany', 'findJobByUrl', 'createJob',
      'importJd', 'scoreJob', 'findApplicationByJob', 'createApplication', 'appendNote',
    ])
    // createJob 绝不传 jdText；正文由 importJd 统一导入
    expect(calls.find((c) => c.name === 'createJob')?.args[0]).toMatchObject({
      companyId: 'c-1', title: job.jobName, jdUrl: job.url, city: '深圳',
    })
    expect(calls.find((c) => c.name === 'createJob')?.args[0]).not.toHaveProperty('jdText')
    expect(names().indexOf('importJd')).toBeLessThan(names().indexOf('scoreJob'))
    expect(calls.find((c) => c.name === 'importJd')?.args).toEqual(['j-1', job.jdText, job.url])
    expect(calls.find((c) => c.name === 'createApplication')?.args[0]).toEqual({ jobId: 'j-1', notes: expect.any(String) })

    expect(job.state).toBe('replied')
    expect(job.replyMsgId).toBe(peerReply.msgId)
    expect(job.landSync).toMatchObject({ companyId: 'c-1', jobId: 'j-1', applicationId: 'a-1', fitScore: 72 })
  })

  it('建岗时把列表上的薪资换成元传过去（正文里通常没有薪资）', async () => {
    const { bridge, calls } = mockBridge()
    const job = staged({ salaryDesc: '20-40K·13薪' })
    await syncOnReply(peerReply, snapshot(selfGreeting), job, bridge, { now: () => now })
    expect(calls.find((c) => c.name === 'createJob')?.args[0]).toMatchObject({
      salaryMin: 20_000, salaryMax: 40_000,
    })
  })

  it('薪资是「面议」时不传空字段', async () => {
    const { bridge, calls } = mockBridge()
    const job = staged({ salaryDesc: '面议' })
    await syncOnReply(peerReply, snapshot(selfGreeting), job, bridge, { now: () => now })
    const input = calls.find((c) => c.name === 'createJob')?.args[0] as Record<string, unknown>
    expect(input).not.toHaveProperty('salaryMin')
    expect(input).not.toHaveProperty('salaryMax')
  })

  it('未读数恒为 0 不影响落库', async () => {
    const { bridge, names } = mockBridge()
    expect(peerReply.unreadMsgCount).toBe(0)
    const outcome = await syncOnReply(peerReply, snapshot(selfGreeting), staged(), bridge, { now: () => now })
    expect(outcome.synced).toBe(true)
    expect(names()).toContain('createJob')
  })

  it('自己发出的招呼语不落库', async () => {
    const { bridge, calls } = mockBridge()
    const outcome = await syncOnReply(selfGreeting, undefined, staged(), bridge, { now: () => now })
    expect(outcome.synced).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('同一条回复重复轮询不重复落库', async () => {
    const { bridge, calls } = mockBridge()
    const outcome = await syncOnReply(peerReply, snapshot(peerReply), staged(), bridge, { now: () => now })
    expect(outcome.reason).toContain('重复轮询')
    expect(calls).toHaveLength(0)
  })

  it('已落库的记录再次轮询直接跳过', async () => {
    const { bridge, calls } = mockBridge()
    const job = staged({ state: 'replied', landSync: {
      companyId: 'c-1', jobId: 'j-1', applicationId: 'a-1', syncedAt: now,
      reused: { company: false, job: false, application: false },
    } })
    const outcome = await syncOnReply(peerReply, snapshot(selfGreeting), job, bridge, { now: () => now })
    expect(outcome.synced).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('复用公司 / 岗位 / 投递时不再 import、score、写备注', async () => {
    const { bridge, names } = mockBridge({
      company: { id: 'c-old' }, job: { id: 'j-old' }, application: { id: 'a-old' },
    })
    const record = await syncRepliedJob(staged({ state: 'replied' }), bridge, { now: () => now })
    expect(names()).not.toContain('importJd')
    expect(names()).not.toContain('scoreJob')
    expect(names()).not.toContain('appendNote')
    expect(record).toMatchObject({
      companyId: 'c-old', jobId: 'j-old', applicationId: 'a-old',
      reused: { company: true, job: true, application: true },
    })
  })

  it('JD 被截断 / 缺失时拒绝落库', async () => {
    const { bridge, names } = mockBridge()
    const job = staged({ jdText: undefined })
    const outcome = await syncOnReply(peerReply, snapshot(selfGreeting), job, bridge, { now: () => now })
    expect(outcome.synced).toBe(false)
    expect(outcome.reason).toContain('JD 正文')
    expect(names()).toEqual([])
    expect(job.landSync).toBeUndefined()
  })

  it('服务不可达时保留 replied 供下轮重试，不写任何业务数据', async () => {
    const { bridge, names } = mockBridge({ healthOk: false })
    const job = staged()
    const outcome = await syncOnReply(peerReply, snapshot(selfGreeting), job, bridge, { now: () => now })
    expect(outcome.synced).toBe(false)
    expect(outcome.reason).toContain('服务不可达')
    expect(names()).toEqual(['health'])
    expect(job.state).toBe('replied')
    expect(job.landSync).toBeUndefined()
  })

  it('落库失败后同一 msgId 可重试，成功后不建第二条', async () => {
    const failing = mockBridge({ failOn: 'importJd' })
    const job = staged()
    const first = await syncOnReply(peerReply, snapshot(selfGreeting), job, failing, { now: () => now })
    expect(first.synced).toBe(false)
    expect(job.state).toBe('replied')
    expect(job.replyMsgId).toBe(peerReply.msgId)
    expect(job.landSync).toBeUndefined()

    const recovered = mockBridge()
    const retry = await syncOnReply(peerReply, snapshot(peerReply), job, recovered.bridge, { now: () => now })
    expect(retry.synced, retry.reason).toBe(true)
    expect(job.landSync?.applicationId).toBe('a-1')

    const again = await syncOnReply(peerReply, snapshot(peerReply), job, recovered.bridge, { now: () => now })
    expect(again.synced).toBe(false)
    expect(recovered.names().filter((n) => n === 'createApplication')).toHaveLength(1)
  })

  it('反向补建（replied 但缺 JD）不刷失败日志，也不碰服务端；补齐 JD 后下一轮能落库', async () => {
    const job = staged({
      state: 'replied', replyMsgId: peerReply.msgId, jdText: undefined,
      origin: 'conversation',
    })
    const { bridge, names } = mockBridge()
    const first = await syncOnReply(peerReply, snapshot(peerReply), job, bridge, { now: () => now })
    expect(first.synced).toBe(false)
    expect(first.reason).toContain('缺 JD')
    expect(names()).toEqual([])

    job.jdText = '岗位职责：React 开发'.repeat(4)
    const second = await syncOnReply(peerReply, snapshot(peerReply), job, bridge, { now: () => now })
    expect(second.synced, second.reason).toBe(true)
    expect(job.landSync?.applicationId).toBe('a-1')
  })

  it('备注写清来源与 queued 口径，不含聊天正文', () => {
    const notes = buildSyncNotes(staged({ replyMsgId: peerReply.msgId }))
    expect(notes).toContain('BOSS直聘')
    expect(notes).toContain('queued')
    expect(notes).toContain('capturedBy=browser')
    expect(notes).not.toContain('方便发一份简历吗')
  })

  it('state 不是 replied 时拒绝落库', async () => {
    const { bridge, calls } = mockBridge()
    await expect(syncRepliedJob(staged({ state: 'greeted' }), bridge)).rejects.toThrow('只有 replied 才落库')
    expect(calls).toHaveLength(0)
  })
})
