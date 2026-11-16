import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeError, LandBridge } from '../src/lib/bridge.js'

afterEach(() => vi.unstubAllGlobals())

interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function stubFetch(handler: (call: FetchCall) => { status?: number; body: unknown }) {
  const calls: FetchCall[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const call: FetchCall = {
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {},
    }
    calls.push(call)
    const result = handler(call)
    const status = result.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(result.body),
    }
  })
  return calls
}

const bridge = () => new LandBridge({ apiBase: 'http://127.0.0.1:4399', token: 'tok-1' })
const envelope = (data: unknown) => ({ data })

describe('REST 桥接契约', () => {
  it('自动拆 { data } 信封，且强制带 x-land-token', async () => {
    const calls = stubFetch(() => ({ body: envelope([{ id: 'j-1' }]) }))
    const row = await bridge().findJobByUrl('https://www.zhipin.com/job_detail/a.html')
    expect(row).toEqual({ id: 'j-1' })
    expect(calls[0].url).toContain('/api/jobs?jdUrl=')
    expect(calls[0].headers['x-land-token']).toBe('tok-1')
  })

  it('公司按 q 查询后仍需精确匹配名称', async () => {
    stubFetch(() => ({ body: envelope([
      { id: 'c-1', name: '拓保软件（深圳）' },
      { id: 'c-2', name: '拓保软件' },
    ]) }))
    expect(await bridge().findCompanyByName('拓保软件')).toEqual({ id: 'c-2', name: '拓保软件' })
  })

  it('createJob 不传 jdText，channel 固定 boss', async () => {
    const calls = stubFetch(() => ({ body: envelope({ id: 'j-1' }) }))
    await bridge().createJob({ companyId: 'c-1', title: '前端开发', jdUrl: 'https://www.zhipin.com/job_detail/a.html', city: '深圳' })
    expect(calls[0].body).toEqual({
      companyId: 'c-1', title: '前端开发', jdUrl: 'https://www.zhipin.com/job_detail/a.html',
      channel: 'boss', city: '深圳',
    })
    expect(calls[0].body).not.toHaveProperty('jdText')
  })

  it('importJd 标 capturedBy=browser', async () => {
    const calls = stubFetch(() => ({ body: envelope({ ok: true }) }))
    await bridge().importJd('j-1', '岗位职责：前端开发', 'https://www.zhipin.com/job_detail/a.html')
    expect(calls[0].url).toContain('/api/jobs/j-1/import-jd')
    expect(calls[0].body).toEqual({
      text: '岗位职责：前端开发', url: 'https://www.zhipin.com/job_detail/a.html', capturedBy: 'browser',
    })
  })

  it('P2 只建 queued：不传 appliedAt、不写 applied', async () => {
    const calls = stubFetch(() => ({ body: envelope({ id: 'a-1' }) }))
    const id = await bridge().createApplication({ jobId: 'j-1', notes: '来源说明' })
    expect(id).toBe('a-1')
    expect(calls[0].body).toMatchObject({
      jobId: 'j-1', status: 'queued', channel: 'boss', actor: 'rule', source: 'rule',
    })
    expect(calls[0].body).not.toHaveProperty('appliedAt')
    expect(calls[0].body.status).not.toBe('applied')
  })

  it('同岗位重复投递的 409 冲突当作幂等命中，复用 applicationId', async () => {
    stubFetch(() => ({
      status: 409,
      body: { error: { code: 'CONFLICT', message: '该岗位已有进行中的投递', details: { applicationId: 'a-existing' } } },
    }))
    expect(await bridge().createApplication({ jobId: 'j-1' })).toBe('a-existing')
  })

  it('非 409 错误抛 BridgeError，保留 code 与 details', async () => {
    stubFetch(() => ({ status: 400, body: { error: { code: 'JD_TOO_SHORT', message: '正文太短' } } }))
    await expect(bridge().importJd('j-1', '短', 'https://www.zhipin.com/a')).rejects.toMatchObject({
      name: 'BridgeError', code: 'JD_TOO_SHORT', status: 400,
    })
  })

  it('备注用 /notes 端点，actor/source 为 rule', async () => {
    const calls = stubFetch(() => ({ body: envelope({ id: 'e-1' }) }))
    await bridge().appendNote('a-1', '回复 msgId=123')
    expect(calls[0].url).toContain('/api/applications/a-1/notes')
    expect(calls[0].body).toEqual({ note: '回复 msgId=123', actor: 'rule', source: 'rule' })
  })

  it('打分显式传默认简历，避开 listResumes({limit:1}) 拿到变体的坑', async () => {
    const calls = stubFetch((call) => {
      if (call.url.includes('/api/resumes')) {
        return { body: envelope([
          { id: 'r-variant', isDefault: false },
          { id: 'r-master', isDefault: true },
        ]) }
      }
      return { body: envelope({ job: { id: 'j-1', fitScore: 72 } }) }
    })
    expect(await bridge().scoreJob('j-1')).toBe(72)
    const score = calls.find((c) => c.url.includes('/score'))
    expect(score?.body).toEqual({ resumeId: 'r-master' })
  })

  it('没有默认简历时退回服务端兜底，不因打分中断落库', async () => {
    const calls = stubFetch((call) => {
      if (call.url.includes('/api/resumes')) return { body: envelope([]) }
      return { body: envelope({ job: { id: 'j-1', fitScore: 60 } }) }
    })
    expect(await bridge().scoreJob('j-1')).toBe(60)
    expect(calls.find((c) => c.url.includes('/score'))?.body).toEqual({})
  })

  it('查重只匹配进行中的投递，已撤回的旧记录不算幂等命中', async () => {
    const calls = stubFetch(() => ({ body: envelope([]) }))
    expect(await bridge().findApplicationByJob('j-1')).toBeNull()
    expect(calls[0].url).toContain('active=true')
  })

  it('P3 推进 applied 时显式带 appliedAt（预留，不在 P2 调用）', async () => {
    const calls = stubFetch(() => ({ body: envelope({ id: 'a-1', status: 'applied' }) }))
    await bridge().markApplied('a-1', '2026-11-12T04:00:00.000Z', '已发送附件简历')
    expect(calls[0].url).toContain('/api/applications/a-1/status')
    expect(calls[0].body).toMatchObject({
      to: 'applied', appliedAt: '2026-11-12T04:00:00.000Z', actor: 'rule', source: 'rule',
    })
  })

  it('服务不可达时 health 返回不可用，而不是抛异常', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('ECONNREFUSED') })
    const result = await bridge().health()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('ECONNREFUSED')
  })

  it('BridgeError 带 status 与 details 供上层判断', () => {
    const error = new BridgeError('冲突', 409, 'CONFLICT', { applicationId: 'a-1' })
    expect(error.details).toEqual({ applicationId: 'a-1' })
  })
})
