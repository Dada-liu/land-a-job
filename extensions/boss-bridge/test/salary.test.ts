import { describe, expect, it } from 'vitest'
import { salaryRangeYuan } from '../src/lib/salary.js'

describe('salaryRangeYuan', () => {
  it('K 区间换算成元', () => {
    expect(salaryRangeYuan('12-18K')).toEqual({ min: 12_000, max: 18_000 })
    expect(salaryRangeYuan('25-50K')).toEqual({ min: 25_000, max: 50_000 })
  })

  it('两侧都带单位、或只有一侧带单位都能认', () => {
    expect(salaryRangeYuan('15K-25K')).toEqual({ min: 15_000, max: 25_000 })
    expect(salaryRangeYuan('15-25k')).toEqual({ min: 15_000, max: 25_000 })
  })

  it('13 薪这类后缀不影响月薪区间', () => {
    expect(salaryRangeYuan('20-40K·13薪')).toEqual({ min: 20_000, max: 40_000 })
    expect(salaryRangeYuan('20-40K 14薪')).toEqual({ min: 20_000, max: 40_000 })
  })

  it('万为单位', () => {
    expect(salaryRangeYuan('1.5-2万')).toEqual({ min: 15_000, max: 20_000 })
  })

  it('单个值当作定点区间', () => {
    expect(salaryRangeYuan('20K')).toEqual({ min: 20_000, max: 20_000 })
  })

  it('日薪 / 时薪不换算', () => {
    expect(salaryRangeYuan('300-500元/天')).toBeNull()
    expect(salaryRangeYuan('40元/时')).toBeNull()
  })

  it('面议、空值、纯数字都返回 null', () => {
    expect(salaryRangeYuan('面议')).toBeNull()
    expect(salaryRangeYuan('')).toBeNull()
    expect(salaryRangeYuan(undefined)).toBeNull()
    /** 没单位又小得不像「元」，别猜成 15 元 */
    expect(salaryRangeYuan('15-25')).toBeNull()
  })

  it('顺序写反也能纠正', () => {
    expect(salaryRangeYuan('40-20K')).toEqual({ min: 20_000, max: 40_000 })
  })
})
