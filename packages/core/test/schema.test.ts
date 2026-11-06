import { describe, expect, it } from 'vitest'
import { zListQuery, zIso, zUrl } from '../src/schema/common.js'
import { zCompanyCreate, zCompanyPatch } from '../src/schema/company.js'
import { zJobCreate, zJobPatch } from '../src/schema/job.js'
import { zApplicationCreate, zStatusChange } from '../src/schema/application.js'
import { zOfferCreate } from '../src/schema/offer.js'

describe('通用 schema', () => {
  it('列表查询有安全默认值：limit 50，且不暴露已删除记录', () => {
    const query = zListQuery.parse({})
    expect(query.limit).toBe(50)
    // 软删过滤在 SQL 层强制，不开放给调用方关闭
    expect(Object.keys(query)).not.toContain('includeDeleted')
  })

  it('limit 超上限被拒（避免一次拉全库）', () => {
    expect(() => zListQuery.parse({ limit: '9999' })).toThrow()
  })

  it('ISO 时间接受带毫秒/不带毫秒/带偏移三种写法', () => {
    for (const value of ['2026-11-04T09:00:00.000Z', '2026-11-04T09:00:00Z', '2026-11-04T17:00:00+08:00']) {
      expect(zIso.parse(value)).toBe(value)
    }
    expect(() => zIso.parse('2026-13-45')).toThrow()
  })

  it('URL 只接受 http(s)', () => {
    expect(zUrl.parse('https://example.com/jobs')).toBe('https://example.com/jobs')
    expect(() => zUrl.parse('ftp://example.com')).toThrow()
  })
})

describe('公司 schema', () => {
  it('name 必填，priority 默认 3', () => {
    expect(() => zCompanyCreate.parse({})).toThrow()
    expect(zCompanyCreate.parse({ name: '字节跳动' }).priority).toBe(3)
  })

  it('PATCH 至少要改一个字段', () => {
    expect(() => zCompanyPatch.parse({})).toThrow()
    expect(zCompanyPatch.parse({ city: '上海' }).city).toBe('上海')
  })
})

describe('岗位 schema', () => {
  it('薪资上限小于下限时报错，且错误定位在 salaryMax', () => {
    const result = zJobCreate.safeParse({
      companyId: 'c1',
      title: '前端工程师',
      salaryMin: 50_000,
      salaryMax: 30_000,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['salaryMax'])
    }
  })

  it('PATCH 允许只改 fit 相关字段', () => {
    const patch = zJobPatch.parse({ fitScore: 72, fitSource: 'agent' })
    expect(patch.fitScore).toBe(72)
  })
})

describe('投递 schema', () => {
  it('状态为 applied 时必须给 appliedAt（否则跟进天数算不出来）', () => {
    const result = zApplicationCreate.safeParse({ jobId: 'j1', status: 'applied' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['appliedAt'])
    }
  })

  it('queued 不需要 appliedAt', () => {
    expect(zApplicationCreate.parse({ jobId: 'j1', status: 'queued' }).status).toBe('queued')
  })

  it('改状态默认 force=false、source=web', () => {
    const input = zStatusChange.parse({ to: 'screening' })
    expect(input.force).toBe(false)
    expect(input.source).toBe('web')
  })

  it('未知状态被拒绝', () => {
    expect(() => zStatusChange.parse({ to: 'hired' })).toThrow()
  })
})

describe('Offer schema', () => {
  it('默认值符合「12 薪 + 4 年归属 + 12 个月 cliff」', () => {
    const offer = zOfferCreate.parse({ applicationId: 'a1', companyName: '某公司', baseMonthly: 40_000 })
    expect(offer.monthsPerYear).toBe(12)
    expect(offer.vestYears).toBe(4)
    expect(offer.cliffMonths).toBe(12)
    expect(offer.housingFund).toBeCloseTo(0.07)
  })

  it('公积金比例必须在 0–1 之间', () => {
    expect(() =>
      zOfferCreate.parse({ applicationId: 'a1', companyName: 'x', baseMonthly: 1, housingFund: 7 }),
    ).toThrow()
  })
})
