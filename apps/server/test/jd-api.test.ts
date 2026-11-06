import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, destroyTestApp, type TestApp } from './helpers.js'

/**
 * JD 采集的 API 契约测试：用本机 fixture 服务代替真实招聘页，
 * 验证「抓取 → 信号回写 → 去重 → 粘贴降级」这条链路在 HTTP 层也是通的。
 */
const LONG_BODY = '负责增长业务前端架构设计与工程化建设，精通 React 与 TypeScript，熟悉 Node.js 服务端渲染与性能优化。'.repeat(3)
const JD_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>高级前端工程师 - 招聘</title></head>
<body><nav>首页 职位 关于我们</nav><main><h1>高级前端工程师</h1><article>
<div>杭州 · 25-40K · 3-5 年 · 本科及以上</div><p>${LONG_BODY}</p>
<ul><li>5 年以上前端经验，本科及以上学历</li><li>熟悉 Kubernetes 与 CI/CD</li></ul>
</article></main></body></html>`

const PASTED_JD = [
  '高级前端工程师（杭州）',
  '薪资 25-40K，3-5 年经验，本科及以上学历。',
  LONG_BODY,
  '任职要求：熟悉 React、TypeScript、Node.js，了解 Kubernetes 与 CI/CD。',
].join('\n')

let fixture: Server
let base: string
let app: TestApp

beforeAll(async () => {
  fixture = createServer((request, response) => {
    if (request.url?.startsWith('/jd')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(JD_HTML)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', () => resolve()))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('fixture 没拿到端口')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => fixture.close(() => resolve()))
})

beforeEach(async () => {
  app = await createTestApp()
})

afterEach(async () => {
  await destroyTestApp(app)
})

async function seedJob(jdUrl: string | null): Promise<string> {
  const company = await app.call('POST', '/companies', { name: '示例公司', website: base })
  const job = await app.call('POST', '/jobs', {
    companyId: company.body.data.id,
    title: '高级前端工程师',
    ...(jdUrl ? { jdUrl } : {}),
  })
  return job.body.data.id as string
}

/** 快照写到 data/files/jd/，测完删掉，不在仓库里留测试垃圾 */
async function cleanupSnapshot(snapshot: string): Promise<void> {
  await rm(snapshot, { force: true })
  await rm(snapshot.replace(/\.html$/, '.prev.html'), { force: true })
}

describe('POST /jobs/:id/fetch-jd', () => {
  it('抓到正文后把关键词/城市/薪资一并回写，并留下快照与来源信息', async () => {
    const id = await seedJob(`${base}/jd/1`)
    const fetched = await app.call('POST', `/jobs/${id}/fetch-jd`)
    expect(fetched.status).toBe(200)

    const data = fetched.body.data
    expect(data.provider).toBe('http')
    expect(data.source.trusted).toBe(true)
    expect(data.job.keywords).toContain('react')
    expect(data.job.city).toBe('杭州')
    expect(data.job.salaryMin).toBe(25_000)
    expect(data.job.salaryMax).toBe(40_000)
    expect(data.signals.salary).toEqual({ min: 25_000, max: 40_000 })
    expect(data.job.jdText).toContain('React')
    expect(data.job.jdSource).toBe('http')
    expect(existsSync(data.snapshot)).toBe(true)
    await cleanupSnapshot(data.snapshot)

    // 人工已填的字段不能被机器推断覆盖
    const patched = await app.call('PATCH', `/jobs/${id}`, { city: '上海', salaryMax: 60_000 })
    expect(patched.body.data.city).toBe('上海')
    const again = await app.call('POST', `/jobs/${id}/fetch-jd`)
    expect(again.body.data.job.city).toBe('上海')
    expect(again.body.data.job.salaryMax).toBe(60_000)
    await cleanupSnapshot(again.body.data.snapshot)
  })

  it('没有 JD 链接时给出明确错误', async () => {
    const id = await seedJob(null)
    const response = await app.call('POST', `/jobs/${id}/fetch-jd`)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('JD_URL_MISSING')
  })
})

describe('GET /jobs?jdUrl= 去重', () => {
  it('带追踪参数与锚点的链接能查回同一个岗位，干净链接也能查回它', async () => {
    await seedJob(`${base}/jd/2?utm_source=wechat&from=group&spm=abc#top`)
    const clean = `${base}/jd/2`
    const hit = await app.call('GET', `/jobs?jdUrl=${encodeURIComponent(clean)}`)
    expect(hit.body.data.length).toBe(1)

    const other = await app.call('GET', `/jobs?jdUrl=${encodeURIComponent(`${base}/jd/999`)}`)
    expect(other.body.data.length).toBe(0)
  })
})

describe('POST /jobs/:id/import-jd（粘贴降级）', () => {
  it('粘贴正文与自动抓取等价：同样抽关键词、补字段、留快照', async () => {
    const id = await seedJob(null)
    const imported = await app.call('POST', `/jobs/${id}/import-jd`, {
      text: PASTED_JD,
      url: `${base}/jd/3`,
    })
    expect(imported.status).toBe(200)

    const data = imported.body.data
    expect(data.source.kind).toBe('manual')
    expect(data.provider).toBe('paste')
    expect(data.job.jdUrl).toBe(`${base}/jd/3`)
    expect(data.job.keywords).toContain('react')
    expect(data.job.city).toBe('杭州')
    expect(data.job.salaryMin).toBe(25_000)
    expect(data.job.jdSource).toBe('paste')
    expect(existsSync(data.snapshot)).toBe(true)
    await cleanupSnapshot(data.snapshot)
  })

  it('Agent 浏览器读回的正文标为 browser，来源落库后刷新仍可见', async () => {
    const id = await seedJob(null)
    const imported = await app.call('POST', `/jobs/${id}/import-jd`, {
      text: PASTED_JD,
      capturedBy: 'browser',
      url: `${base}/jd/4`,
    })
    expect(imported.status).toBe(200)
    expect(imported.body.data.source.kind).toBe('browser')
    expect(imported.body.data.provider).toBe('browser')
    expect(imported.body.data.job.jdSource).toBe('browser')

    // Web 端详情页读的是库里的字段，不依赖本次请求的临时状态
    const job = await app.call('GET', `/jobs/${id}`)
    expect(job.body.data.jdSource).toBe('browser')
    expect(job.body.data.jdText).toContain('React')
    await cleanupSnapshot(imported.body.data.snapshot)
  })

  it('正文过短直接拒绝，不写坏数据', async () => {
    const id = await seedJob(null)
    const response = await app.call('POST', `/jobs/${id}/import-jd`, { text: '太短了' })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe('JD_TOO_SHORT')
    const job = await app.call('GET', `/jobs/${id}`)
    expect(job.body.data.jdText).toBeNull()
  })
})
