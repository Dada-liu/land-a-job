import { describe, expect, it } from 'vitest'
import {
  canonicalJdUrl,
  classifyUrl,
  collectJd,
  parseBeisenItalentUrl,
  parseBeisenWecruitUrl,
  parseFeishuUrl,
} from '../src/jd/index.js'

function stub(handler: (url: string, init: RequestInit | undefined) => Response): typeof fetch {
  return (async (input: unknown, init?: RequestInit) =>
    handler(String(input), init)) as unknown as typeof fetch
}

const LONG = '负责增长业务前端架构设计与工程化建设，精通 React 与 TypeScript，熟悉 Node.js 与 Kubernetes。'.repeat(3)

const FEISHU_POST = {
  id: '7398064824717920527',
  title: '高级前端工程师',
  description: `<p>${LONG}</p>`,
  requirement: '<ul><li>5 年以上前端经验，本科及以上</li></ul>',
  city_list: [{ name: '北京' }],
  publish_time: 1_730_000_000,
}

const JD_HTML = `<!doctype html><html lang="zh-CN"><head><title>高级前端工程师</title></head><body>
<main><h1>高级前端工程师</h1><article><p>${LONG}</p></article></main></body></html>`

describe('飞书招聘链接识别', () => {
  it('标准子域 / 多租户 / 根门户 / 自建域都能解析出门户与岗位号', () => {
    expect(parseFeishuUrl(new URL('https://nio.jobs.feishu.cn/campus/position/7398/detail'))).toEqual({
      host: 'nio.jobs.feishu.cn',
      channel: 'campus',
      id: '7398',
    })
    expect(parseFeishuUrl(new URL('https://vrfi1sk8a0.jobs.feishu.cn/379481/position/7398/detail'))?.channel).toBe('379481')
    expect(parseFeishuUrl(new URL('https://hr.sensetime.com/position/7398/detail'))?.channel).toBe('')
    expect(parseFeishuUrl(new URL('https://careers.iqiyi.com/job/position/7398/detail'))?.channel).toBe('job')
    expect(parseFeishuUrl(new URL('https://xiaomi.jobs.f.mioffice.cn/campus/position/7398/detail'))?.host).toBe(
      'xiaomi.jobs.f.mioffice.cn',
    )
  })

  it('不是飞书域或不是岗位详情页就不匹配', () => {
    expect(parseFeishuUrl(new URL('https://boards.greenhouse.io/acme/jobs/123'))).toBeNull()
    expect(parseFeishuUrl(new URL('https://nio.jobs.feishu.cn/campus/position'))).toBeNull()
  })

  it('来源被判定为可确认的官方 ATS', () => {
    expect(classifyUrl('https://nio.jobs.feishu.cn/campus/position/7398/detail').kind).toBe('ats')
    expect(classifyUrl('https://iflytek.zhiye.com/campus/detail?jobAdId=1').kind).toBe('ats')
    expect(classifyUrl('https://wecruit.hotjob.cn/SU1/pb/social.html').kind).toBe('ats')
    expect(classifyUrl('https://careers.iqiyi.com/job/position/1/detail').kind).toBe('ats')
  })
})

describe('北森云链接识别', () => {
  it('iTalent 的岗位号在 jobAdId 查询参数里', () => {
    expect(parseBeisenItalentUrl(new URL('https://iflytek.zhiye.com/campus/detail?jobAdId=190816475'))).toMatchObject({
      kind: 'italent',
      host: 'iflytek.zhiye.com',
      id: '190816475',
      portalIds: [''],
    })
    expect(parseBeisenItalentUrl(new URL('https://hr-campus.vivo.com/campus/detail?jobAdId=1'))?.portalIds[0]).toBe(
      '903cbcbf-4898-46e1-817c-da522a9752b1',
    )
    expect(parseBeisenItalentUrl(new URL('https://iflytek.zhiye.com/jobs?jobAdId=1'))).toBeNull()
  })

  it('Wecruit 的岗位号在 hash 路由里，渠道号在路径里', () => {
    expect(
      parseBeisenWecruitUrl(
        new URL('https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html#/postDetail?postId=12345'),
      ),
    ).toMatchObject({
      kind: 'wecruit',
      channelId: 'SU64819a4f2f9d2433ba8b043a',
      pagePath: 'social',
      id: '12345',
    })
  })

  it('带岗位号的 hash 不参与去重时被误删', () => {
    const a = 'https://wecruit.hotjob.cn/SU1/pb/social.html#/postDetail?postId=111?utm_source=x'
    const b = 'https://wecruit.hotjob.cn/SU1/pb/social.html#/postDetail?postId=222'
    expect(canonicalJdUrl(a)).not.toBe(canonicalJdUrl(b))
    expect(canonicalJdUrl('https://nio.jobs.feishu.cn/campus/position/1/detail#apply')).toBe(
      'https://nio.jobs.feishu.cn/campus/position/1/detail',
    )
  })
})

describe('飞书招聘采集', () => {
  it('优先用按 id 详情接口，并带上门户请求头', async () => {
    const seen: string[] = []
    const request = stub((url, init) => {
      seen.push(url)
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.['portal-channel']).toBe('campus')
      expect(headers?.['website-path']).toBe('campus')
      return new Response(
        JSON.stringify({ code: 0, data: { job_post_detail: FEISHU_POST } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })

    const result = await collectJd('https://nio.jobs.feishu.cn/campus/position/7398064824717920527/detail', { request })
    expect(result.result.provider).toBe('feishu')
    expect(result.source.kind).toBe('ats')
    expect(result.result.structured.city).toBe('北京')
    expect(result.result.structured.postedAt).toBeTruthy()
    expect(result.result.text).toContain('React')
    expect(result.result.text).toContain('5 年以上前端经验')
    expect(seen[0]).toContain('/api/v1/job/posts/7398064824717920527?portal_type=3')
  })

  it('详情接口没有数据时，从公开搜索列表按 id 找', async () => {
    const request = stub((url) => {
      if (url.includes('/api/v1/job/posts/')) {
        return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
      }
      if (url.includes('/api/v1/search/job/posts')) {
        return new Response(JSON.stringify({ code: 0, data: { job_post_list: [FEISHU_POST], count: 1 } }), {
          status: 200,
        })
      }
      return new Response('not found', { status: 404 })
    })

    const result = await collectJd('https://vrfi1sk8a0.jobs.feishu.cn/index/position/7398064824717920527/detail', {
      request,
    })
    expect(result.result.provider).toBe('feishu')
    expect(result.warnings.join(' ')).toContain('公开搜索列表')
    expect(result.result.structured.city).toBe('北京')
  })
})

describe('北森云采集', () => {
  it('iTalent：翻公开列表按 jobAdId 找，职责与要求拼成完整正文', async () => {
    let captured: Record<string, unknown> | null = null
    const request = stub((url, init) => {
      expect(url).toBe('https://iflytek.zhiye.com/api/Jobad/GetJobAdPageList')
      captured = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          Code: 200,
          Data: [
            {
              JobAdId: 190816475,
              JobAdName: '算法工程师',
              Duty: `<p>${LONG}</p>`,
              Require: '<p>熟悉 Python 与 PyTorch</p>',
              LocNames: ['合肥'],
              Org: '科大讯飞',
              PostDate: '2026-09-01T00:00:00',
            },
          ],
          Count: 1,
        }),
        { status: 200 },
      )
    })

    const result = await collectJd('https://iflytek.zhiye.com/campus/detail?jobAdId=190816475', { request })
    expect(result.result.provider).toBe('beisen')
    expect(result.result.text).toContain('React')
    expect(result.result.text).toContain('熟悉 Python')
    expect(result.result.structured.city).toBe('合肥')
    expect(result.result.structured.company).toBe('科大讯飞')
    expect(captured?.PageIndex).toBe(0)
    expect(captured?.DisplayFields).toContain('Duty')
  })

  it('Wecruit：表单编码打详情接口，workContent + serviceCondition 合成 JD', async () => {
    const bodies: string[] = []
    const request = stub((url, init) => {
      expect(url).toContain('/wecruit/positionInfo/listPositionDetail/SU64819a4f2f9d2433ba8b043a')
      expect((init?.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
      bodies.push(String(init?.body ?? ''))
      return new Response(
        JSON.stringify({
          state: '200',
          data: {
            postName: '感知算法工程师',
            workContent: LONG,
            serviceCondition: '熟悉 C++ 与模型部署',
            workPlaceStr: '北京',
            orgName: '地平线',
          },
        }),
        { status: 200 },
      )
    })

    const result = await collectJd(
      'https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html#/postDetail?postId=12345',
      { request },
    )
    expect(result.result.provider).toBe('beisen')
    expect(result.result.text).toContain('熟悉 C++')
    expect(result.result.structured.city).toBe('北京')
    expect(bodies[0]).toContain('postId=12345')
    expect(bodies[0]).toContain('recruitType=2')
  })

  it('官方接口查不到岗位时自动降级到通用 HTTP', async () => {
    const request = stub((url) => {
      if (url.includes('listPositionDetail')) {
        return new Response(JSON.stringify({ state: '1017', msg: '该职位招聘已经关闭' }), { status: 200 })
      }
      return new Response(JD_HTML, { status: 200, headers: { 'content-type': 'text/html' } })
    })

    const result = await collectJd(
      'https://wecruit.hotjob.cn/SU64819a4f2f9d2433ba8b043a/pb/social.html#/postDetail?postId=999',
      { request },
    )
    expect(result.result.provider).toBe('http')
    expect(result.result.text).toContain('React')
  })
})
