import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/lib/constants.js'
import { runPipeline, type PipelineDeps } from '../src/lib/pipeline.js'
import { RateLimiter } from '../src/lib/rate-limit.js'
import { emptyStaging } from '../src/lib/storage.js'
import type { BridgeSettings, StagedJob, StagingData } from '../src/lib/types.js'

const now = 1794454300000

function job(key: string, state: StagedJob['state']): StagedJob {
  return {
    key, url: `https://www.zhipin.com/job_detail/${key}.html`,
    jobName: '前端开发', brandName: '拓保软件',
    bossActive: { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' },
    state, isNew: true, capturedAt: now,
  }
}

function harness(opts: {
  jobs?: StagedJob[]
  settings?: Partial<BridgeSettings>
  sendGreeting?: PipelineDeps['sendGreeting']
  confirmBatch?: PipelineDeps['confirmBatch']
  limiter?: RateLimiter
} = {}) {
  let clock = now
  const data: StagingData = emptyStaging(now, '2026-11-12')
  for (const item of opts.jobs ?? []) data.jobs[item.key] = item
  const limiter = opts.limiter ?? new RateLimiter(null, {
    now: () => clock, day: () => '2026-11-12', rng: () => 0.5,
  })
  const sent: string[] = []
  const deps: PipelineDeps = {
    load: async () => data,
    save: async (next) => { Object.assign(data, next) },
    limiter,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    now: () => clock,
    sleep: async (ms) => { clock += ms },
    log: () => {},
    sendGreeting: opts.sendGreeting ?? (async (item) => { sent.push(item.key); return { ok: true } }),
    confirmBatch: opts.confirmBatch,
  }
  return { data, deps, sent, limiter }
}

describe('filter → generate → delivery 流水线', () => {
  it('dry-run 零发送，但产出草稿与预览', async () => {
    const { data, deps, sent } = harness({ jobs: [job('a', 'ready')] })
    const result = await runPipeline(deps)
    expect(sent).toEqual([])
    expect(result.drafted).toBe(1)
    expect(result.delivered).toBe(0)
    expect(result.preview).toHaveLength(1)
    expect(data.jobs.a.greetDraft).toBeTruthy()
  })

  it('只有通过活跃度闸门的记录产出草稿，filtered_out 直接跳过', async () => {
    const { data, deps } = harness({ jobs: [job('a', 'ready'), job('b', 'filtered_out')] })
    const result = await runPipeline(deps)
    expect(result.preview.map((j) => j.key)).toEqual(['a'])
    expect(data.jobs.b.greetDraft).toBeUndefined()
  })

  it('招呼语只做槽位填充，不编造经历', async () => {
    const { data, deps } = harness({
      jobs: [job('a', 'ready')],
      settings: { greetingTemplate: '{brandName}·{jobName} {highlights}', highlights: ['React'] },
    })
    await runPipeline(deps)
    expect(data.jobs.a.greetDraft).toContain('拓保软件·前端开发')
    expect(data.jobs.a.greetDraft).toContain('React')
  })

  it('非 dry-run 仍需用户逐批确认，确认后才写 greeted 与 greetedAt', async () => {
    const { data, deps, sent } = harness({
      jobs: [job('a', 'ready'), job('b', 'ready')],
      settings: { dryRun: false },
      confirmBatch: async (items) => items.filter((i) => i.key === 'a'),
    })
    const result = await runPipeline(deps)
    expect(sent).toEqual(['a'])
    expect(result.delivered).toBe(1)
    expect(data.jobs.a.state).toBe('greeted')
    expect(data.jobs.a.greetedAt).toBe(now)
    expect(data.jobs.b.state).toBe('ready')
  })

  it('发送失败不写 greeted，也不重试', async () => {
    const { data, deps, sent } = harness({
      jobs: [job('a', 'ready')],
      settings: { dryRun: false },
      confirmBatch: async (items) => items,
      sendGreeting: async (item) => { sent.push(item.key); return { ok: false, message: 'P1 未实现点击' } },
    })
    const result = await runPipeline(deps)
    expect(sent).toHaveLength(1)
    expect(result.delivered).toBe(0)
    expect(data.jobs.a.state).toBe('ready')
    expect(result.reasons.join(' ')).toContain('P1 未实现点击')
  })

  it('限速器熔断时整轮停机，不继续发送', async () => {
    const limiter = new RateLimiter(null, { now: () => now, day: () => '2026-11-12' })
    limiter.noteRisk(9, '操作过于频繁')
    const { deps, sent } = harness({
      jobs: [job('a', 'ready')], settings: { dryRun: false },
      confirmBatch: async (items) => items, limiter,
    })
    const result = await runPipeline(deps)
    expect(sent).toEqual([])
    expect(result.tripped).toBe(true)
  })

  it('只有列表证据时，闸门按 bossOnline 放行（详情不是唯一活跃信号）', async () => {
    const listed = job('a', 'needs_detail')
    listed.bossActive = { online: true, capturedAt: now, source: 'list' }
    const { data, deps } = harness({ jobs: [listed] })
    const result = await runPipeline(deps)
    expect(data.jobs.a.state).toBe('ready')
    expect(data.jobs.a.notes).toBe('HR 在线')
    expect(result.drafted).toBe(1)
  })

  it('开 autoOpenDetail 时，本轮补齐详情就直接产出草稿', async () => {
    const pending = job('a', 'needs_detail')
    pending.bossActive = { capturedAt: now, source: 'list' }
    const { data, deps } = harness({ jobs: [pending], settings: { autoOpenDetail: true } })
    const opened: string[] = []
    deps.openDetail = async (item) => {
      opened.push(item.key)
      // 模拟旁听把详情写回 store（另一条写入路径）
      data.jobs[item.key].bossActive = { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' }
      data.jobs[item.key].state = 'ready'
      data.jobs[item.key].notes = '命中白名单「刚刚活跃」'
      return { ok: true }
    }
    const result = await runPipeline(deps)
    expect(opened).toEqual(['a'])
    expect(result.drafted).toBe(1)
    expect(data.jobs.a.greetDraft).toBeTruthy()
    expect(data.jobs.a.bossActive.desc).toBe('刚刚活跃')
  })

  it('运行期间旁听到的详情不会被结尾的保存冲掉', async () => {
    const pending = job('a', 'needs_detail')
    pending.bossActive = { capturedAt: now, source: 'list' }
    const { data, deps } = harness({ jobs: [pending] })
    let calls = 0
    const first = deps.load
    deps.load = async () => {
      calls += 1
      if (calls === 1) return first()
      // 第二次读：模拟详情旁听已经写入了新快照
      return {
        ...data,
        jobs: {
          a: {
            ...data.jobs.a,
            jdText: '岗位职责：前端开发',
            bossActive: { online: true, desc: '刚刚活跃', capturedAt: now, source: 'detail' },
            state: 'ready',
            notes: '命中白名单「刚刚活跃」',
          },
        },
      }
    }
    await runPipeline(deps)
    expect(data.jobs.a.jdText).toBe('岗位职责：前端开发')
    expect(data.jobs.a.bossActive.source).toBe('detail')
    expect(data.jobs.a.state).toBe('ready')
  })
})
