import { describe, expect, it } from 'vitest'
import { evaluateFollowups, type FollowupApplication } from '../src/followup.js'

const NOW = new Date('2026-11-05T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const daysLater = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString()

const applied = (overrides: Partial<FollowupApplication> = {}): FollowupApplication => ({
  id: 'app-1',
  status: 'applied',
  statusAt: daysAgo(8),
  companyName: '字节',
  jobTitle: '后端工程师',
  ...overrides,
})

describe('evaluateFollowups', () => {
  it('超过 7 天无回音才催办', () => {
    expect(evaluateFollowups({ applications: [applied()], now: NOW })).toHaveLength(1)
    expect(evaluateFollowups({ applications: [applied({ statusAt: daysAgo(7) })], now: NOW })).toHaveLength(0)
  })

  it('边界：7 天整不触发，7 天 + 1 秒触发', () => {
    const exactly7 = new Date(NOW.getTime() - 7 * 86_400_000).toISOString()
    const justOver = new Date(NOW.getTime() - 7 * 86_400_000 - 1000).toISOString()
    expect(evaluateFollowups({ applications: [applied({ statusAt: exactly7 })], now: NOW })).toHaveLength(0)
    expect(evaluateFollowups({ applications: [applied({ statusAt: justOver })], now: NOW })).toHaveLength(1)
  })

  it('用户已排下一次动作时不催', () => {
    const tasks = evaluateFollowups({ applications: [applied({ nextActionAt: daysLater(2) })], now: NOW })
    expect(tasks).toHaveLength(0)
  })

  it('面试后 3 天没写反馈 → 复盘任务；写了反馈就消失', () => {
    const base = { applications: [applied({ id: 'a1', status: 'interview' })] }
    const interview = { id: 'i1', applicationId: 'a1', scheduledAt: daysAgo(4) }
    expect(evaluateFollowups({ ...base, interviews: [interview], now: NOW })).toHaveLength(1)
    expect(
      evaluateFollowups({ ...base, interviews: [{ ...interview, feedback: '问了 3 个问题' }], now: NOW }),
    ).toHaveLength(0)
    // 取消的面试不该提醒复盘
    expect(
      evaluateFollowups({ ...base, interviews: [{ ...interview, result: 'cancelled' }], now: NOW }),
    ).toHaveLength(0)
  })

  it('Offer 剩 2 天内为高优先级', () => {
    const tasks = evaluateFollowups({
      applications: [applied({ id: 'a1', status: 'offer' })],
      offers: [{ id: 'o1', applicationId: 'a1', deadline: daysLater(1), status: 'pending', companyName: '字节' }],
      now: NOW,
    })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.kind).toBe('offer_deadline')
    expect(tasks[0]!.priority).toBe('high')
  })

  it('已接受的 offer 不再倒计时', () => {
    const tasks = evaluateFollowups({
      applications: [applied({ id: 'a1', status: 'accepted' })],
      offers: [{ id: 'o1', applicationId: 'a1', deadline: daysLater(1), status: 'accepted' }],
      now: NOW,
    })
    expect(tasks).toHaveLength(0)
  })

  it('停滞 30 天以上标记候选 ghosted', () => {
    const tasks = evaluateFollowups({ applications: [applied({ status: 'screening', statusAt: daysAgo(31) })], now: NOW })
    expect(tasks.map((t) => t.kind)).toContain('stale')
  })

  it('终态不再产生任何任务', () => {
    const terminal = ['rejected', 'ghosted', 'withdrawn', 'accepted'] as const
    for (const status of terminal) {
      const tasks = evaluateFollowups({
        applications: [applied({ status, statusAt: daysAgo(90) })],
        now: NOW,
      })
      expect(tasks).toHaveLength(0)
    }
  })

  it('高优先级排前面，同优先级按逾期天数降序', () => {
    const tasks = evaluateFollowups({
      applications: [
        applied({ id: 'a1', statusAt: daysAgo(10) }),
        applied({ id: 'a2', statusAt: daysAgo(20) }),
        applied({ id: 'a3', status: 'offer' }),
      ],
      offers: [{ id: 'o1', applicationId: 'a3', deadline: daysLater(1), status: 'pending' }],
      now: NOW,
    })
    expect(tasks[0]!.kind).toBe('offer_deadline')
    expect(tasks[1]!.days).toBeGreaterThan(tasks[2]!.days)
  })
})
