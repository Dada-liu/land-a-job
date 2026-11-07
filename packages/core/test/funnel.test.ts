import { describe, expect, it } from 'vitest'
import { MIN_SAMPLE_SIZE, buildFunnel, buildResumePerformance, quantile, responseTimeStats } from '../src/funnel.js'

const app = (id: string, status: string, appliedAt: string | null = '2026-10-01T00:00:00.000Z') => ({
  id,
  status,
  appliedAt,
})

describe('buildFunnel', () => {
  it('按到达过最高阶段累计：进过面试就一定算过筛选', () => {
    const funnel = buildFunnel(
      [app('a', 'rejected'), app('b', 'applied'), app('c', 'interview')],
      [
        { applicationId: 'a', toStatus: 'applied' },
        { applicationId: 'a', toStatus: 'interview' },
        { applicationId: 'a', toStatus: 'rejected' },
        { applicationId: 'b', toStatus: 'applied' },
        { applicationId: 'c', toStatus: 'applied' },
        { applicationId: 'c', toStatus: 'interview' },
      ],
    )
    const byStage = Object.fromEntries(funnel.steps.map((s) => [s.stage, s.reached]))
    expect(byStage.applied).toBe(3)
    expect(byStage.screening).toBe(2)
    expect(byStage.assessment).toBe(2)
    expect(byStage.interview).toBe(2)
    expect(byStage.offer).toBe(0)
    expect(funnel.total).toBe(3)
  })

  it('同一投递多次进入同一阶段只算一次', () => {
    const funnel = buildFunnel(
      [app('a', 'interview')],
      [
        { applicationId: 'a', toStatus: 'screening' },
        { applicationId: 'a', toStatus: 'screening' },
        { applicationId: 'a', toStatus: 'interview' },
      ],
    )
    expect(funnel.steps.find((s) => s.stage === 'interview')?.reached).toBe(1)
  })

  it('转化率与流失率互补，首阶段为 null', () => {
    const funnel = buildFunnel([app('a', 'interview'), app('b', 'interview'), app('c', 'applied')])
    const applied = funnel.steps[0]!
    const screening = funnel.steps[1]!
    expect(applied.conversion).toBeNull()
    expect(screening.conversion).toBeCloseTo(2 / 3)
    expect(screening.dropRate).toBeCloseTo(1 / 3)
  })

  it('空库返回 0 而不是 NaN，offer 率为 null', () => {
    const funnel = buildFunnel([])
    expect(funnel.total).toBe(0)
    expect(funnel.offerRate).toBeNull()
    expect(funnel.steps.every((s) => s.reached === 0)).toBe(true)
  })

  it('状态被误标为 lead 但有 appliedAt，仍算已投', () => {
    const funnel = buildFunnel([app('a', 'lead', '2026-10-02T00:00:00.000Z')])
    expect(funnel.steps[0]!.reached).toBe(1)
  })
})

describe('buildResumePerformance', () => {
  const row = (resumeId: string, interviewed: boolean, offered = false) => ({
    resumeId,
    resumeTitle: `简历 ${resumeId}`,
    reachedApplied: true,
    reachedInterview: interviewed,
    reachedOffer: offered,
  })
  const queued = (resumeId: string) => ({ ...row(resumeId, false), reachedApplied: false })

  it('样本不足时不给转化率', () => {
    const result = buildResumePerformance([row('r1', true), row('r1', true)])
    expect(result[0]!.enough).toBe(false)
    expect(result[0]!.interviewRate).toBeNull()
  })

  it('样本够了才给转化率', () => {
    const rows = [row('r1', true), row('r1', false), row('r1', true, true)]
    const result = buildResumePerformance(rows)
    expect(result[0]!.applied).toBe(3)
    expect(result[0]!.enough).toBe(MIN_SAMPLE_SIZE <= 3)
    expect(result[0]!.interviewRate).toBeCloseTo(2 / 3)
  })

  it('未关联简历的投递不进入统计', () => {
    const result = buildResumePerformance([row('r1', true), { ...row('r2', true), resumeId: null }])
    expect(result).toHaveLength(1)
    expect(result[0]!.applied).toBe(1)
  })

  it('待投不进分母：5 投 1 面不会被 2 条 queued 稀释成 7 投 1 面', () => {
    const applied = [row('r1', true), row('r1', false), row('r1', false), row('r1', false), row('r1', false)]
    const result = buildResumePerformance([...applied, queued('r1'), queued('r1')])
    expect(result[0]!.applied).toBe(5)
    expect(result[0]!.interviewRate).toBeCloseTo(1 / 5)
  })

  it('只有待投的简历不出现在榜上', () => {
    const result = buildResumePerformance([row('r1', true), queued('r2'), queued('r2')])
    expect(result.map((item) => item.resumeId)).toEqual(['r1'])
  })

  it('全部都是待投时返回空数组而不是一行 0 投', () => {
    expect(buildResumePerformance([queued('r1'), queued('r1')])).toEqual([])
  })
})

describe('responseTimeStats', () => {
  const day = (n: number): string => new Date(Date.parse('2026-10-01T00:00:00.000Z') + n * 86_400_000).toISOString()
  const sample = (applied: number, advance: number) => ({ appliedAt: day(applied), firstAdvanceAt: day(advance) })

  it('没有样本时中位数是 null 而不是 0', () => {
    const result = responseTimeStats([])
    expect(result.medianDays).toBeNull()
    expect(result.p90Days).toBeNull()
    expect(result.sample).toBe(0)
  })

  it('单样本：中位数就是它自己', () => {
    const result = responseTimeStats([sample(0, 3)])
    expect(result.medianDays).toBe(3)
    expect(result.p90Days).toBe(3)
  })

  it('偶数量取中间两位的平均', () => {
    // 1 / 3 天 → 中位数 2
    const result = responseTimeStats([sample(0, 1), sample(0, 3)])
    expect(result.medianDays).toBe(2)
  })

  it('奇数量取中间那个（不被极端值带偏）', () => {
    const result = responseTimeStats([sample(0, 1), sample(0, 5), sample(0, 60)])
    expect(result.medianDays).toBe(5)
    expect(result.p90Days).toBe(49)
  })

  it('保留一位小数：半天回和隔天回要能区分', () => {
    const result = responseTimeStats([sample(0, 0.5), sample(0, 1), sample(0, 1.5)])
    expect(result.medianDays).toBe(1)
    expect(responseTimeStats([sample(0, 0.5)]).medianDays).toBe(0.5)
  })

  it('推进时间早于投递时间算异常，不混进中位数', () => {
    const result = responseTimeStats([sample(5, 2), sample(0, 4)])
    expect(result.invalid).toBe(1)
    expect(result.sample).toBe(1)
    expect(result.medianDays).toBe(4)
  })

  it('还没推进的投递由调用方排除，函数只统计传进来的样本', () => {
    const result = responseTimeStats([sample(0, 2), sample(0, 4)])
    expect(result.sample).toBe(2)
    expect(result.assumptions.length).toBeGreaterThanOrEqual(3)
  })
})

describe('quantile', () => {
  it('空数组返回 null', () => {
    expect(quantile([], 0.5)).toBeNull()
  })

  it('单元素返回自身', () => {
    expect(quantile([7], 0.9)).toBe(7)
  })

  it('线性插值', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4], 1)).toBe(4)
  })
})
