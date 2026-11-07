import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEEKLY_TARGET,
  WEEKLY_TARGET_MAX,
  WEEKLY_TARGET_MIN,
  clampWeeklyTarget,
} from '../src/settings.js'

describe('clampWeeklyTarget', () => {
  it('没存过（null/undefined）或读到非数字时回落到默认的 8', () => {
    expect(clampWeeklyTarget(null)).toBe(DEFAULT_WEEKLY_TARGET)
    expect(clampWeeklyTarget(undefined)).toBe(DEFAULT_WEEKLY_TARGET)
    expect(clampWeeklyTarget(Number.NaN)).toBe(DEFAULT_WEEKLY_TARGET)
    expect(clampWeeklyTarget(Number.POSITIVE_INFINITY)).toBe(DEFAULT_WEEKLY_TARGET)
  })

  it('区间内的数原样保留，超出范围的收敛到 1–100', () => {
    expect(clampWeeklyTarget(12)).toBe(12)
    expect(clampWeeklyTarget(0)).toBe(WEEKLY_TARGET_MIN)
    expect(clampWeeklyTarget(-5)).toBe(WEEKLY_TARGET_MIN)
    expect(clampWeeklyTarget(999)).toBe(WEEKLY_TARGET_MAX)
  })

  it('小数四舍五入：进度条分母必须是整数', () => {
    expect(clampWeeklyTarget(6.4)).toBe(6)
    expect(clampWeeklyTarget(6.6)).toBe(7)
  })
})
