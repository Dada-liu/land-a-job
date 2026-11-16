import { describe, expect, it } from 'vitest'
import { detailGate, isStale, listGate } from '../src/lib/activity.js'
import type { BossActive } from '../src/lib/types.js'

const now = 1794454300000
const active = (patch: Partial<BossActive> = {}): BossActive => ({
  online: true,
  desc: '刚刚活跃',
  capturedAt: now,
  source: 'detail',
  ...patch,
})

describe('HR 活跃度两段闸门（提案 §6）', () => {
  it('列表 bossOnline=false 直接过滤，0 额外请求', () => {
    const decision = listGate({ jobName: 'A', brandName: 'B', bossOnline: false }, { now })
    expect(decision.state).toBe('filtered_out')
  })

  it('列表明确在线就直接放行（否则状态永远卡在待确认活跃度）', () => {
    const decision = listGate({ jobName: 'A', brandName: 'B', bossOnline: true }, { now })
    expect(decision.state).toBe('ready')
    expect(decision.reason).toContain('在线')
  })

  it('列表没给 bossOnline 才等详情复核', () => {
    expect(listGate({ jobName: 'A', brandName: 'B' }, { now }).state).toBe('needs_detail')
  })

  it('实测标签「刚刚活跃」命中白名单', () => {
    expect(detailGate(active(), 0, 0, { now }).state).toBe('ready')
  })

  it('未观察到的标签保守跳过，并记录待补样本', () => {
    const decision = detailGate(active({ desc: '半年前活跃' }), 0, 0, { now })
    expect(decision.state).toBe('filtered_out')
    expect(decision.unknownDesc).toBe('半年前活跃')
  })

  it('未知标签即使 bossOnline=true 也不猜测为活跃', () => {
    expect(detailGate(active({ desc: '本周活跃' }), 0, 0, { now }).state).toBe('filtered_out')
  })

  it('bossOnline 是独立活跃信号：没有 desc 也能通过', () => {
    expect(detailGate(active({ desc: undefined, online: true }), 0, 0, { now }).state).toBe('ready')
  })

  it('冻结账号跳过', () => {
    expect(detailGate(active(), 1, 0, { now }).state).toBe('filtered_out')
    expect(detailGate(active(), 0, 1, { now }).state).toBe('filtered_out')
  })

  it('快照超过 24 小时必须重取，不拿三天前的「在线」当今天的依据', () => {
    const stale = active({ capturedAt: now - 25 * 60 * 60 * 1000 })
    expect(isStale(stale, now)).toBe(true)
    expect(detailGate(stale, 0, 0, { now }).state).toBe('needs_detail')
  })

  it('两者都缺按未知策略跳过', () => {
    expect(detailGate(active({ online: undefined, desc: undefined }), 0, 0, { now }).state).toBe('filtered_out')
  })
})
