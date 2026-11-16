import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTER, applyFilter, countByState, matchesFilter, touchedAt } from '../src/lib/filter.js'
import type { StagedJob } from '../src/lib/types.js'

const now = 1794454300000

function job(key: string, patch: Partial<StagedJob> = {}): StagedJob {
  return {
    key,
    url: `https://www.zhipin.com/job_detail/${key}.html`,
    jobName: '前端开发',
    brandName: '拓保软件',
    bossActive: { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' },
    state: 'ready',
    isNew: false,
    capturedAt: now,
    ...patch,
  }
}

const filter = (patch: Partial<typeof DEFAULT_FILTER> = {}) => ({ ...DEFAULT_FILTER, ...patch })

describe('缓存岗位筛选', () => {
  it('关键词命中公司 / 岗位 / 城市 / 备注，忽略大小写', () => {
    const jobs = [
      job('a', { brandName: '字节跳动', jobName: 'AI 全栈前端' }),
      job('b', { brandName: '拓保软件', city: '上海·浦东' }),
    ]
    expect(applyFilter(jobs, filter({ q: '字节' })).map((j) => j.key)).toEqual(['a'])
    expect(applyFilter(jobs, filter({ q: 'ai 全栈' })).map((j) => j.key)).toEqual(['a'])
    expect(applyFilter(jobs, filter({ q: '浦东' })).map((j) => j.key)).toEqual(['b'])
    expect(applyFilter(jobs, filter({ q: '不存在的词' }))).toEqual([])
  })

  it('按状态筛，all 返回全部', () => {
    const jobs = [job('a', { state: 'ready' }), job('b', { state: 'filtered_out' })]
    expect(applyFilter(jobs, filter({ state: 'ready' })).map((j) => j.key)).toEqual(['a'])
    expect(applyFilter(jobs, filter({ state: 'all' }))).toHaveLength(2)
  })

  it('活跃度三档：在线 / 有活跃描述 / 未知', () => {
    const online = job('a', { bossActive: { online: true, capturedAt: now, source: 'list' } })
    const described = job('b', { bossActive: { desc: '今日活跃', capturedAt: now, source: 'detail' } })
    const unknown = job('c', { bossActive: { capturedAt: now, source: 'list' } })
    const jobs = [online, described, unknown]
    expect(applyFilter(jobs, filter({ activity: 'online' })).map((j) => j.key)).toEqual(['a'])
    expect(applyFilter(jobs, filter({ activity: 'desc' })).map((j) => j.key)).toEqual(['b'])
    expect(applyFilter(jobs, filter({ activity: 'unknown' })).map((j) => j.key)).toEqual(['c'])
  })

  it('附加条件：有 JD / 已落库 / 有草稿，可以叠加', () => {
    const jobs = [
      job('a', { jdText: '岗位职责', landSync: { companyId: 'c', jobId: 'j', applicationId: 'p', syncedAt: now, reused: { company: false, job: false, application: false } }, greetDraft: '您好' }),
      job('b', { jdText: '岗位职责' }),
      job('c'),
    ]
    expect(applyFilter(jobs, filter({ hasJd: true })).map((j) => j.key)).toEqual(['a', 'b'])
    expect(applyFilter(jobs, filter({ synced: true })).map((j) => j.key)).toEqual(['a'])
    expect(applyFilter(jobs, filter({ drafted: true })).map((j) => j.key)).toEqual(['a'])
    expect(applyFilter(jobs, filter({ hasJd: true, drafted: true })).map((j) => j.key)).toEqual(['a'])
  })

  it('默认按最近动作倒序，状态排序按流程走', () => {
    const older = job('a', { state: 'sent', sentAt: now - 5000, capturedAt: now - 10_000 })
    const newer = job('b', { state: 'ready' })
    expect(applyFilter([older, newer], filter()).map((j) => j.key)).toEqual(['b', 'a'])
    expect(applyFilter([older, newer], filter({ sort: 'state' })).map((j) => j.key)).toEqual(['b', 'a'])
  })

  it('touchedAt 取最后动作时间，不被抓取时间吃掉', () => {
    expect(touchedAt(job('a', { capturedAt: now - 9000, repliedAt: now }))).toBe(now)
    expect(touchedAt(job('a', { capturedAt: now, bossActive: { capturedAt: now - 1, source: 'list' } }))).toBe(now)
  })

  it('统计口径与筛选一致', () => {
    const jobs = [job('a'), job('b', { state: 'filtered_out' }), job('c', { state: 'ready' })]
    expect(countByState(jobs)).toEqual({ all: 3, ready: 2, filtered_out: 1 })
    expect(jobs.filter((j) => matchesFilter(j, filter({ state: 'ready' })))).toHaveLength(2)
  })
})
