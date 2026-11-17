import { describe, expect, it } from 'vitest'
import {
  applyDetail, applyGreet, applyJdFromDom, createJobFromConversation, dedupeStaging, emptyStaging, healStaging,
  memoryKV, mergeJobList, pruneStaging, reverseJobKey, StagingStore,
} from '../src/lib/storage.js'
import { STAGING_LIMITS } from '../src/lib/constants.js'
import type { ConversationItem, JobListItem } from '../src/lib/parsers.js'

const now = 1794454300000
const day = '2026-11-12'
const item = (securityId: string, bossOnline = true): JobListItem => ({
  securityId, jobName: '前端开发', brandName: '拓保软件', bossOnline,
  salaryDesc: '15-25K', encryptJobId: `enc-${securityId}`,
})

describe('暂存区（只存 chrome.storage.local，0 落库）', () => {
  it('按 securityId 去重，跨轮 isNew 只在新的一天为 true', () => {
    const data = emptyStaging(now, day)
    expect(mergeJobList(data, [item('a')], now, day)).toEqual({ added: 1, updated: 0 })
    expect(data.jobs['enc-a'].isNew).toBe(true)
    expect(mergeJobList(data, [item('a')], now + 1000, day)).toEqual({ added: 0, updated: 1 })
    expect(data.jobs['enc-a'].isNew).toBe(false)
    mergeJobList(data, [item('a')], now + 86_400_000, '2026-11-13')
    expect(data.jobs['enc-a'].isNew).toBe(true)
  })

  it('列表不在线的记录直接 filtered_out', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a', false)], now, day)
    expect(data.jobs['enc-a'].state).toBe('filtered_out')
  })

  it('detail 到达时补 JD 正文并复核活跃度', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    const key = applyDetail(
      data,
      {
        securityId: 'a',
        jdText: '岗位职责：前端开发',
        jdTruncated: false,
        bossActive: { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' },
      },
      () => ({ state: 'ready', reason: '命中白名单' }),
      now,
    )
    expect(key).toBe('enc-a')
    expect(data.jobs['enc-a'].jdText).toBe('岗位职责：前端开发')
    expect(data.jobs['enc-a'].state).toBe('ready')
  })

  it('截断的 JD 不写进暂存区', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    applyDetail(
      data,
      {
        securityId: 'a', jdText: '', jdTruncated: true,
        bossActive: { capturedAt: now, source: 'detail' },
      },
      () => ({ state: 'needs_detail', reason: '等详情' }),
      now,
    )
    expect(data.jobs['enc-a'].jdText).toBeUndefined()
    expect(data.jobs['enc-a'].notes).toContain('截断')
  })

  it('超过 60 天或 sent 后 7 天清理，并限制 500 条上限', () => {
    const data = emptyStaging(now, day)
    data.jobs.old = {
      key: 'old', url: '', jobName: '', brandName: '',
      bossActive: { capturedAt: now, source: 'list' },
      state: 'discovered', isNew: false, capturedAt: now - STAGING_LIMITS.ttlMs - 1,
    }
    for (let i = 0; i < 505; i += 1) {
      data.jobs[`j${i}`] = {
        key: `j${i}`, url: '', jobName: '', brandName: '',
        bossActive: { capturedAt: now, source: 'list' },
        state: 'ready', isNew: false, capturedAt: now + i,
      }
    }
    const removed = pruneStaging(data, now + 1)
    expect(removed).toBeGreaterThan(0)
    expect(data.jobs.old).toBeUndefined()
    expect(Object.keys(data.jobs).length).toBeLessThanOrEqual(STAGING_LIMITS.maxItems)
  })

  it('StagingStore 可以从内存 KV 读写（单测无需 chrome API）', async () => {
    const store = new StagingStore(memoryKV(), () => now)
    const data = await store.load()
    mergeJobList(data, [item('a')], now, day)
    await store.save(data)
    const reloaded = await new StagingStore(memoryKV({ 'bossBridge.staging': data }), () => now).load()
    expect(reloaded.jobs['enc-a'].jobName).toBe('前端开发')
  })

  it('列表刷新不清掉详情结论：desc 保留、ready 不回退', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    applyDetail(
      data,
      {
        securityId: 'a', jdText: '岗位职责：前端开发', jdTruncated: false,
        bossActive: { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' },
      },
      () => ({ state: 'ready', reason: '命中白名单「刚刚活跃」' }),
      now,
    )
    mergeJobList(data, [item('a', false)], now + 1000, day)
    expect(data.jobs['enc-a'].bossActive.source).toBe('detail')
    expect(data.jobs['enc-a'].bossActive.desc).toBe('刚刚活跃')
    expect(data.jobs['enc-a'].state).toBe('ready')
    expect(data.jobs['enc-a'].jdText).toBe('岗位职责：前端开发')
  })

  it('列表刷新保住已经发生的事实（landSync / 定制版本 / 用户接手）', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    data.jobs['enc-a'].landSync = {
      companyId: 'c', jobId: 'j', applicationId: 'p', syncedAt: now,
      reused: { company: false, job: false, application: false },
    }
    data.jobs['enc-a'].resumeVariantId = 'r-variant'
    data.jobs['enc-a'].manual = true
    mergeJobList(data, [item('a')], now + 1000, day)
    expect(data.jobs['enc-a'].landSync?.applicationId).toBe('p')
    expect(data.jobs['enc-a'].resumeVariantId).toBe('r-variant')
    expect(data.jobs['enc-a'].manual).toBe(true)
  })

  it('列表在线直接 ready；先判不活跃、下次列表说在线也能回到 ready', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a', false)], now, day)
    expect(data.jobs['enc-a'].state).toBe('filtered_out')
    mergeJobList(data, [item('a', true)], now + 1000, day)
    expect(data.jobs['enc-a'].state).toBe('ready')
    expect(data.jobs['enc-a'].bossActive.source).toBe('list')
  })

  it('已通过闸门的 ready 不会被下一次列表刷新打回待复核', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    data.jobs['enc-a'].state = 'ready'
    data.jobs['enc-a'].notes = 'HR 在线'
    mergeJobList(data, [item('a', false)], now + 1000, day)
    expect(data.jobs['enc-a'].state).toBe('ready')
    expect(data.jobs['enc-a'].notes).toBe('HR 在线')
  })

  it('历史 needs_detail（列表明确在线）自愈成 ready，详情判过的不动', () => {
    const data = emptyStaging(now, day)
    data.jobs['enc-a'] = {
      key: 'enc-a', url: '', jobName: 'A', brandName: 'A', state: 'needs_detail', isNew: false,
      capturedAt: now, bossActive: { online: true, capturedAt: now, source: 'list' },
    }
    data.jobs['enc-b'] = {
      key: 'enc-b', url: '', jobName: 'B', brandName: 'B', state: 'needs_detail', isNew: false,
      capturedAt: now, bossActive: { capturedAt: now, source: 'detail' },
    }
    expect(healStaging(data)).toBe(1)
    expect(data.jobs['enc-a'].state).toBe('ready')
    expect(data.jobs['enc-b'].state).toBe('needs_detail')
    expect(healStaging(data)).toBe(0)
  })

  it('从会话反建记录：幂等、不带 JD、不落库，详情到达后按公司名补齐', () => {
    const data = emptyStaging(now, day)
    const conv: ConversationItem = {
      uid: 42, jobId: 88, brandName: '独创时代', lastTS: now - 1000,
      lastMsg: '方便发份简历吗', unreadMsgCount: 0, msgId: 777,
      fromId: 42, status: 0,
    }
    const created = createJobFromConversation(data, conv, now)
    const key = reverseJobKey(conv)
    expect(created?.key).toBe(key)
    expect(created?.state).toBe('replied')
    expect(created?.jdText).toBeUndefined()
    expect(created?.jobName).toBe('')
    expect(created?.conversationId).toBe('42:88')
    expect(createJobFromConversation(data, conv, now)?.key).toBe(key)
    expect(Object.keys(data.jobs)).toHaveLength(1)

    const filled = applyDetail(
      data,
      {
        securityId: 'sec-dc', jdText: '岗位职责：React 开发', jdTruncated: false,
        bossActive: { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' },
        brandName: '独创时代', jobName: '前端开发工程师',
      },
      () => ({ state: 'filtered_out', reason: '故意返回，不该覆盖 replied' }),
      now,
    )
    expect(filled).toBe(key)
    expect(data.jobs[key].jdText).toBe('岗位职责：React 开发')
    expect(data.jobs[key].jobName).toBe('前端开发工程师')
    expect(data.jobs[key].state).toBe('replied')
    expect(data.jobs[key].url).toContain('/job_detail/sec-dc.html')
  })

  it('新版详情页 URL：路径用 encryptJobId、securityId 放查询参数', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('sec-abc')], now, day)
    expect(data.jobs['enc-sec-abc'].url).toBe(
      'https://www.zhipin.com/job_detail/enc-sec-abc.html?securityId=sec-abc',
    )
  })

  it('反向补建的 JD 链接必须逐条唯一（chat# 会被规范化成同一个 URL 导致多公司共用一个岗位）', () => {
    const data = emptyStaging(now, day)
    const mk = (uid: number, jobId: number, enc: string, brand: string) => ({
      uid, jobId, brandName: brand, lastTS: now - 1000, lastMsg: '方便发份简历吗',
      unreadMsgCount: 0, msgId: uid, fromId: uid, status: 0, encryptJobId: enc,
    })
    const a = createJobFromConversation(data, mk(1, 11, 'enc-a', '甲公司'), now)
    const b = createJobFromConversation(data, mk(2, 22, 'enc-b', '乙公司'), now)
    expect(a?.url).toBe('https://www.zhipin.com/job_detail/enc-a.html')
    expect(b?.url).toBe('https://www.zhipin.com/job_detail/enc-b.html')
    expect(new Set([a?.url, b?.url]).size).toBe(2)
    const c = createJobFromConversation(data, { ...mk(3, 33, '', '丙公司'), encryptJobId: undefined }, now)
    expect(c?.url).toContain('uid=3')
  })

  it('从 DOM 读到的 JD 会清洗不可见字符、只补空字段、不推进状态', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    data.jobs['enc-a'].state = 'replied'
    data.jobs['enc-a'].salaryDesc = undefined
    const ok = applyJdFromDom(data, 'enc-a', {
      jdText: '岗位职责：React\u200B 开发，熟悉 TypeScript。'.repeat(3),
      brandName: '页面上的公司名',
      jobName: '页面上的岗位名',
      salaryDesc: '20-30K',
    }, now)
    expect(ok).toBe(true)
    expect(data.jobs['enc-a'].jdText).not.toContain('\u200B')
    expect(data.jobs['enc-a'].brandName).toBe('拓保软件')
    expect(data.jobs['enc-a'].jobName).toBe('前端开发')
    expect(data.jobs['enc-a'].salaryDesc).toBe('20-30K')
    expect(data.jobs['enc-a'].state).toBe('replied')
    expect(data.jobs['enc-a'].notes).toContain('已从详情页读取 JD')
  })

  it('JD 太短（还没渲染 / 登录墙）不写入暂存区', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    expect(applyJdFromDom(data, 'a', { jdText: '请登录查看' }, now)).toBe(false)
    expect(data.jobs['enc-a'].jdText).toBeUndefined()
  })

  it('详情响应不会把已经 replied 的记录打回 ready / filtered_out', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    data.jobs['enc-a'].state = 'replied'
    data.jobs['enc-a'].repliedAt = now
    applyDetail(
      data,
      { securityId: 'a', jdText: '岗位职责', jdTruncated: false, bossActive: { capturedAt: now, source: 'detail' } },
      () => ({ state: 'filtered_out', reason: '没有活跃信号' }),
      now,
    )
    expect(data.jobs['enc-a'].state).toBe('replied')
    expect(data.jobs['enc-a'].repliedAt).toBe(now)
  })
})

describe('打招呼回写（friend/add.json → 暂存区）', () => {
  it('按 securityId 命中：ready 推成 greeted 并记时间', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    expect(data.jobs['enc-a'].state).toBe('ready')
    const hit = applyGreet(data, { securityId: 'a' }, now + 5000)
    expect(hit).toEqual({ key: 'enc-a', recorded: true })
    expect(data.jobs['enc-a'].state).toBe('greeted')
    expect(data.jobs['enc-a'].greetedAt).toBe(now + 5000)
    expect(data.jobs['enc-a'].notes).toContain('手动打招呼')
  })

  it('没有 securityId 时用 encryptJobId / encryptBossId 兜底对齐', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a'), item('b')], now, day)
    expect(applyGreet(data, { encryptJobId: 'enc-b' }, now)?.key).toBe('enc-b')
    const byBoss = emptyStaging(now, day)
    mergeJobList(byBoss, [item('a')], now, day)
    byBoss.jobs['enc-a'].encryptBossId = 'enc-boss-a'
    expect(applyGreet(byBoss, { encryptBossId: 'enc-boss-a' }, now)?.key).toBe('enc-a')
  })

  it('对不上的打招呼不臆测：返回 null 且不动任何记录', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    expect(applyGreet(data, { securityId: 'ghost' }, now)).toBeNull()
    expect(data.jobs['enc-a'].greetedAt).toBeUndefined()
  })

  it('重复旁听只认第一次，已回复的记录只补时间不降级', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    applyGreet(data, { securityId: 'a' }, now + 1000)
    expect(applyGreet(data, { securityId: 'a' }, now + 9000)).toEqual({ key: 'enc-a', recorded: false })
    expect(data.jobs['enc-a'].greetedAt).toBe(now + 1000)

    const replied = emptyStaging(now, day)
    mergeJobList(replied, [item('b')], now, day)
    replied.jobs['enc-b'].state = 'replied'
    replied.jobs['enc-b'].repliedAt = now + 2000
    applyGreet(replied, { securityId: 'b' }, now + 3000)
    expect(replied.jobs['enc-b'].state).toBe('replied')
    expect(replied.jobs['enc-b'].greetedAt).toBe(now + 3000)
  })
})

describe('主键改成 encryptJobId（同岗位不再因 securityId 轮换而重复）', () => {
  const listed = (securityId: string, bossOnline = true): JobListItem => ({
    securityId, jobName: '前端开发', brandName: '拓保软件', bossOnline,
    encryptJobId: 'enc-1',
  })

  it('同岗位换列表页返回不同 securityId，也只留一条，且 securityId 跟着更新', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [listed('sec-332')], now, day)
    expect(Object.keys(data.jobs)).toEqual(['enc-1'])
    mergeJobList(data, [listed('sec-380')], now + 1000, day)
    expect(Object.keys(data.jobs)).toEqual(['enc-1'])
    expect(data.jobs['enc-1'].securityId).toBe('sec-380')
  })

  it('存量旧主键（securityId）在下次列表刷新时搬到岗位 ID 上，状态不丢', () => {
    const data = emptyStaging(now, day)
    data.jobs['sec-old'] = {
      key: 'sec-old', securityId: 'sec-old', encryptJobId: 'enc-1', url: '',
      jobName: '前端开发', brandName: '拓保软件', state: 'ready', isNew: false,
      capturedAt: now, bossActive: { online: true, capturedAt: now, source: 'list' },
    }
    mergeJobList(data, [listed('sec-old')], now + 1000, day)
    expect(Object.keys(data.jobs)).toEqual(['enc-1'])
    expect(data.jobs['enc-1'].state).toBe('ready')
  })

  it('去重：同 encryptJobId 的多条合成一条，状态留最靠后、打招呼时间留最早', () => {
    const data = emptyStaging(now, day)
    mergeJobList(data, [item('a')], now, day)
    data.jobs['sec-dup'] = {
      ...data.jobs['enc-a'],
      key: 'sec-dup', securityId: 'sec-dup', state: 'greeted',
      greetedAt: now + 5000, notes: '已在 BOSS 页面手动打招呼',
    }
    const result = dedupeStaging(data, now + 10_000)
    expect(result.merged).toBe(1)
    expect(Object.keys(data.jobs)).toEqual(['enc-a'])
    expect(data.jobs['enc-a'].state).toBe('greeted')
    expect(data.jobs['enc-a'].greetedAt).toBe(now + 5000)
    expect(data.jobs['enc-a'].notes).toContain('手动打招呼')
  })

  it('搬主键时把 securityId 回填成字段（旧版只拿它当主键、从没存字段）', () => {
    const data = emptyStaging(now, day)
    const secId = `sec-${'x'.repeat(320)}`
    data.jobs[secId] = {
      key: secId, encryptJobId: 'enc-1', url: '', jobName: '前端开发', brandName: '拓保软件',
      state: 'ready', isNew: false, capturedAt: now,
      bossActive: { online: true, capturedAt: now, source: 'list' },
    }
    const result = dedupeStaging(data, now + 1)
    expect(result).toMatchObject({ renamed: 1, filled: 1 })
    expect(Object.keys(data.jobs)).toEqual(['enc-1'])
    expect(data.jobs['enc-1'].securityId).toBe(secId)
  })

  it('没有旧主键可参考时，从 JD 链接的 ?securityId= 回填', () => {
    const data = emptyStaging(now, day)
    data.jobs['enc-2'] = {
      key: 'enc-2', encryptJobId: 'enc-2',
      url: 'https://www.zhipin.com/job_detail/enc-2.html?securityId=sec-from-url',
      jobName: '前端开发', brandName: '拓保软件', state: 'ready', isNew: false, capturedAt: now,
      bossActive: { online: true, capturedAt: now, source: 'list' },
    }
    expect(dedupeStaging(data, now + 1).filled).toBe(1)
    expect(data.jobs['enc-2'].securityId).toBe('sec-from-url')
  })

  it('反向补建的记录保留 chat: 主键（createJobFromConversation 靠它判幂等）', () => {
    const data = emptyStaging(now, day)
    const conv: ConversationItem = {
      uid: 7, jobId: 9, brandName: '独创时代', lastTS: now, lastMsg: '方便发份简历吗',
      unreadMsgCount: 0, msgId: 1, fromId: 7, status: 0, encryptJobId: 'enc-chat',
    }
    const created = createJobFromConversation(data, conv, now)
    dedupeStaging(data, now + 1000)
    expect(created?.key).toBe('chat:7:9')
    expect(Object.keys(data.jobs)).toEqual(['chat:7:9'])
  })
})
