import { describe, expect, it } from 'vitest'
import type { ConversationItem } from '../src/lib/parsers.js'
import { bestMatchingJob, conversationMatchScore, matchesConversation, normalizeBrand } from '../src/lib/match.js'
import { matchesStaged } from '../src/lib/reply.js'
import type { StagedJob } from '../src/lib/types.js'

function job(over: Partial<StagedJob> = {}): StagedJob {
  return {
    key: 'sec-1',
    url: 'https://www.zhipin.com/job_detail/sec-1.html',
    jobName: '前端开发',
    brandName: '独创时代',
    bossActive: { online: true, capturedAt: 1, source: 'list' },
    state: 'ready',
    isNew: true,
    capturedAt: 1,
    ...over,
  }
}

function conv(over: Partial<ConversationItem> = {}): ConversationItem {
  return {
    uid: 123,
    jobId: 456,
    brandName: '独创时代',
    lastTS: 2,
    lastMsg: '方便发份简历吗',
    unreadMsgCount: 0,
    msgId: 999,
    fromId: 123,
    status: 0,
    ...over,
  }
}

describe('会话 ↔ 岗位匹配（2026-11-13 实测：加密 ID 同源）', () => {
  it('公司名归一化：去空白、去尾部省略号、忽略大小写', () => {
    expect(normalizeBrand(' 北京软通动力云计... ')).toBe('北京软通动力云计')
    expect(normalizeBrand('BOSS直聘')).toBe('boss直聘')
    expect(normalizeBrand(undefined)).toBe('')
  })

  it('公司名相同但两边的加密 ID 不同，仍按公司名精确匹配（ID 不是否决条件）', () => {
    const j = job({ encryptBossId: 'list-boss-id', encryptJobId: 'list-job-id' })
    const c = conv({ encryptBossId: 'chat-boss-id', encryptJobId: 'chat-job-id' })
    expect(conversationMatchScore(j, c)).toBe(60)
    expect(matchesConversation(j, c)).toBe(true)
    expect(matchesStaged(c, j)).toBe(true)
    expect(matchesStaged(c, { ...j, encryptBossId: undefined, encryptJobId: undefined })).toBe(true)
  })

  it('会话里公司名被截断，用前缀匹配接上（阈值 40）', () => {
    const j = job({ brandName: '北京软通动力云计算有限公司' })
    const c = conv({ brandName: '北京软通动力云计...' })
    expect(normalizeBrand(c.brandName)).toBe('北京软通动力云计')
    expect(conversationMatchScore(j, c)).toBe(40)
    expect(matchesConversation(j, c)).toBe(true)
    // 只是「包含」、没有前缀关系的短名不给过阈值，避免误连
    const loose = job({ brandName: '上海北京软通动力云计有限公司' })
    expect(conversationMatchScore(loose, c)).toBe(20)
    expect(matchesConversation(loose, c)).toBe(false)
  })

  it('加密 ID 相等是最强证据（实测与 joblist 同源），公司名不同也命中', () => {
    const j = job({ brandName: '别的公司', encryptJobId: 'same-id' })
    const c = conv({ brandName: '另外一个公司', encryptJobId: 'same-id' })
    expect(conversationMatchScore(j, c)).toBe(200)
    expect(matchesConversation(j, c)).toBe(true)
    expect(conversationMatchScore(job({ brandName: '别的公司' }), conv({ brandName: '另外一个公司', securityId: 'sec-1' }))).toBe(200)
  })

  it('两边都有加密 ID 却不相等：公司名只是前缀相似也不能硬连，避免连到同公司另一个 HR', () => {
    const j = job({ brandName: '博彦科技承德有限公司', encryptBossId: 'list-boss' })
    const c = conv({ brandName: '博彦科技', encryptBossId: 'chat-boss' })
    expect(matchesConversation(j, c)).toBe(false)
    // 但公司名归一化后完全一致时仍认（BOSS 会把长名字截断）
    expect(matchesConversation(j, { ...c, brandName: '博彦科技承德有限公司...' })).toBe(true)
  })

  it('公司名无关且 ID 不同 → 不匹配，避免把无关会话连到岗位', () => {
    expect(matchesConversation(job(), conv({ brandName: '美团' }))).toBe(false)
    expect(matchesStaged(conv({ brandName: '美团' }), job({ encryptBossId: undefined }))).toBe(false)
  })

  it('同公司多个岗位时选分数最高的；分数相同优先未落库、再比抓取时间', () => {
    const c = conv({ encryptJobId: 'shared' })
    const candidates = [
      job({ key: 'a', brandName: '别的公司', capturedAt: 99 }),
      job({ key: 'b', capturedAt: 1 }),
      job({ key: 'c', capturedAt: 50, landSync: { companyId: '', jobId: '', applicationId: '', syncedAt: 0, reused: { company: false, job: false, application: false } } }),
    ]
    expect(bestMatchingJob(candidates, c)?.key).toBe('b')
    expect(bestMatchingJob([job({ key: 'x', encryptJobId: 'shared', brandName: '别的公司' }), job({ key: 'y' })], c)?.key).toBe('x')
  })
})
