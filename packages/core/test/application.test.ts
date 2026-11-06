import { describe, expect, it } from 'vitest'
import {
  ACTIVE_STATUSES,
  InvalidTransitionError,
  STATUSES,
  TERMINAL_STATUSES,
  assertTransition,
  isStatus,
  isTerminal,
  nextStatuses,
} from '../src/application.js'

describe('投递状态机', () => {
  it('每条声明的跃迁都可通过校验', () => {
    for (const from of STATUSES) {
      for (const to of nextStatuses(from)) {
        expect(() => assertTransition(from, to)).not.toThrow()
      }
    }
  })

  it('同状态视为幂等空操作，不报错', () => {
    for (const status of STATUSES) {
      expect(() => assertTransition(status, status)).not.toThrow()
    }
  })

  it('lead 不能直接跳到 applied（必须先入队）', () => {
    expect(() => assertTransition('lead', 'applied')).toThrow(InvalidTransitionError)
  })

  it('非法跃迁的错误信息包含当前状态、目标状态与允许集合', () => {
    try {
      assertTransition('lead', 'applied')
      expect.unreachable('应当抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError)
      const invalid = error as InvalidTransitionError
      expect(invalid.from).toBe('lead')
      expect(invalid.to).toBe('applied')
      expect(invalid.allowed).toEqual(['queued', 'withdrawn'])
      expect(invalid.message).toContain('线索')
      expect(invalid.message).toContain('queued, withdrawn')
    }
  })

  it('force 可以越过规则（人工修正误标），但仍需调用方留痕', () => {
    expect(() => assertTransition('rejected', 'screening')).toThrow(InvalidTransitionError)
    expect(() => assertTransition('rejected', 'screening', true)).not.toThrow()
  })

  it('终态没有后继状态', () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true)
      expect(nextStatuses(status)).toHaveLength(0)
    }
  })

  it('活跃状态 = 全部状态 - 终态（与部分唯一索引条件一致）', () => {
    const expected = STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s))
    expect(ACTIVE_STATUSES).toEqual(expected)
    expect(ACTIVE_STATUSES).not.toContain('rejected')
    expect(ACTIVE_STATUSES).toContain('offer')
  })

  it('isStatus 只认白名单内的值', () => {
    expect(isStatus('interview')).toBe(true)
    expect(isStatus('Interview')).toBe(false)
    expect(isStatus(undefined)).toBe(false)
  })
})
