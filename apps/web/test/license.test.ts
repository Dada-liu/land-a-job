import { describe, expect, it } from 'vitest'
import { isNearExpiry, mapLicenseStatus } from '../src/lib/desktop'

/**
 * 授权状态映射的行为约定（桌面端门禁全靠它分流，每种分支都不能靠手点回归）：
 * 1. verify_license 的五种 status（none/ok/expired/invalid/error）一一映射，不丢字段；
 * 2. ok 必须带 licenseType/expiresAt/daysRemaining，null 到期日 = 永久授权；
 * 3. 临期判定只看 ok 且 daysRemaining 非空且 ≤ 阈值，永久授权（null）永不临期。
 */
describe('mapLicenseStatus', () => {
  it('本地无记录 → none', () => {
    expect(mapLicenseStatus({ status: 'none' })).toEqual({ status: 'none' })
  })

  it('有效 → ok，保留类型/到期日/剩余天数', () => {
    expect(
      mapLicenseStatus({
        status: 'ok',
        licenseType: 'paid',
        expiresAt: '2027-01-01T00:00:00.000Z',
        daysRemaining: 365,
      }),
    ).toEqual({
      status: 'ok',
      licenseType: 'paid',
      expiresAt: '2027-01-01T00:00:00.000Z',
      daysRemaining: 365,
    })
  })

  it('永久授权 expiresAt 为 null', () => {
    const result = mapLicenseStatus({ status: 'ok', licenseType: 'paid', expiresAt: null, daysRemaining: null })
    expect(result).toEqual({ status: 'ok', licenseType: 'paid', expiresAt: null, daysRemaining: null })
  })

  it('已到期 → expired，保留服务端 message', () => {
    expect(mapLicenseStatus({ status: 'expired', expiresAt: '2026-01-01T00:00:00.000Z', message: '授权已到期' })).toEqual({
      status: 'expired',
      expiresAt: '2026-01-01T00:00:00.000Z',
      message: '授权已到期',
    })
  })

  it('无效（码不存在/绑了别的设备）→ invalid，保留 message', () => {
    expect(mapLicenseStatus({ status: 'invalid', message: '授权码已绑定其他设备' })).toEqual({
      status: 'invalid',
      message: '授权码已绑定其他设备',
    })
  })

  it('网络/5xx → error，不放行', () => {
    expect(mapLicenseStatus({ status: 'error', code: 503 })).toEqual({ status: 'error', code: 503 })
  })

  it('异常输入按 none 处理（不会把门禁卡在白屏）', () => {
    expect(mapLicenseStatus(null)).toEqual({ status: 'none' })
    expect(mapLicenseStatus({})).toEqual({ status: 'none' })
    expect(mapLicenseStatus('unexpected')).toEqual({ status: 'none' })
  })
})

describe('isNearExpiry', () => {
  const ok = (daysRemaining: number | null) =>
    ({ status: 'ok', licenseType: 'paid', expiresAt: null, daysRemaining }) as const

  it('剩余 7 天及以内算临期', () => {
    expect(isNearExpiry(ok(7))).toBe(true)
    expect(isNearExpiry(ok(1))).toBe(true)
    expect(isNearExpiry(ok(8))).toBe(false)
    expect(isNearExpiry(ok(365))).toBe(false)
  })

  it('永久授权（null）永不临期', () => {
    expect(isNearExpiry(ok(null))).toBe(false)
  })

  it('非 ok 状态不参与临期判定', () => {
    expect(isNearExpiry({ status: 'none' })).toBe(false)
    expect(isNearExpiry({ status: 'error' })).toBe(false)
    expect(isNearExpiry({ status: 'expired' })).toBe(false)
  })
})
