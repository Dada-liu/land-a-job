import { describe, expect, it } from 'vitest'
import { CHANNELS, zApplicationCreate, zJobCreate } from '@land/core'
import { CHANNEL_OPTIONS, normalizeChannel } from '../../web/src/lib/channels'

/**
 * 渠道枚举是「core 单一事实来源 + Web 下拉 + schema 校验」三处共用。
 * 新增 boss 时最容易漏的是 Web 下拉与 MCP 工具里的硬编码枚举，
 * 所以这里把三层的一致性钉死，而不是只测 core 常量。
 */
describe('渠道枚举', () => {
  it('core 注册表包含 boss', () => {
    expect(CHANNELS).toContain('boss')
  })

  it('Web 下拉与 core 枚举逐项一致', () => {
    expect(CHANNEL_OPTIONS.map((item) => item.value)).toEqual([...CHANNELS])
  })

  it('normalizeChannel 保留 boss，未知值回落 official', () => {
    expect(normalizeChannel('boss')).toBe('boss')
    expect(normalizeChannel('not-a-channel')).toBe('official')
  })

  it('岗位与投递 schema 都接受 boss', () => {
    const job = zJobCreate.parse({ companyId: 'c1', title: 'AI Agent', channel: 'boss' })
    expect(job.channel).toBe('boss')

    const application = zApplicationCreate.parse({
      jobId: 'j1',
      channel: 'boss',
      status: 'applied',
      appliedAt: '2026-11-12T00:00:00.000Z',
    })
    expect(application.channel).toBe('boss')
  })

  it('非法渠道仍被拒绝', () => {
    expect(() => zJobCreate.parse({ companyId: 'c1', title: 'x', channel: 'unknown' })).toThrow()
    expect(() =>
      zApplicationCreate.parse({ jobId: 'j1', channel: 'unknown', status: 'queued' }),
    ).toThrow()
  })
})
