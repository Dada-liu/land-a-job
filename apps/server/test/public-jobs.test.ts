import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, destroyTestApp, type TestApp } from './helpers.js'

let app: TestApp
let hub: Server
let upstreamPath = ''
let upstreamToken = ''
let detailJob: typeof publicJob

const publicJob = {
  id: '0f0f1ef2-15f7-4a36-a446-42ed865f08d6',
  companyId: 'ee3f0041-c493-4a3c-93c8-5b5672092ee5',
  companyName: '公开公司',
  title: 'Rust 后端工程师',
  jdUrl: 'https://careers.example.com/jobs/123',
  jdSource: 'greenhouse',
  channel: 'official',
  city: '上海',
  cities: ['上海'],
  salaryMin: 30000,
  salaryMax: 50000,
  salaryText: '30k-50k',
  level: null,
  keywords: ['Rust', 'PostgreSQL'],
  fitScore: null,
  fitReasons: null,
  fitSource: 'rule',
  status: 'open',
  priority: 3,
  notes: null,
  applicationId: null,
  source: '7a81c0aa-9dc0-4f05-906a-5f18ad8ddc6a',
  externalId: '123',
  department: 'Platform',
  employmentType: 'full_time',
  postedAt: '2026-11-01T00:00:00Z',
  firstSeenAt: '2026-11-02T01:00:00Z',
  lastSeenAt: '2026-11-02T01:00:00Z',
  createdAt: '2026-11-02T01:00:00Z',
  updatedAt: '2026-11-02T01:00:00Z',
}

beforeEach(async () => {
  upstreamPath = ''
  upstreamToken = ''
  detailJob = publicJob
  hub = createServer((request, response) => {
    upstreamPath = request.url ?? ''
    upstreamToken = String(request.headers['x-land-token'] ?? '')
    response.setHeader('content-type', 'application/json')
    if (request.url?.includes(`/api/jobs/${publicJob.id}`)) {
      response.end(JSON.stringify({ data: { ...detailJob, jdText: '完整公开 JD', jdSnapshot: null } }))
      return
    }
    response.end(
      JSON.stringify({
        data: [publicJob],
        meta: { limit: 1, nextCursor: 'next-page' },
      }),
    )
  })
  await new Promise<void>((resolve) => hub.listen(0, '127.0.0.1', resolve))
  const address = hub.address()
  if (!address || typeof address === 'string') throw new Error('mock hub 未监听端口')
  process.env.POSITION_HUB_BASE_URL = `http://127.0.0.1:${address.port}`
  process.env.POSITION_HUB_TOKEN = 'hub-secret'
  app = await createTestApp()
})

afterEach(async () => {
  await destroyTestApp(app)
  await new Promise<void>((resolve, reject) => hub.close((error) => (error ? reject(error) : resolve())))
  delete process.env.POSITION_HUB_BASE_URL
  delete process.env.POSITION_HUB_TOKEN
})

describe('公开岗位代理', () => {
  it('转发筛选和游标，保留分页 meta，且不把 hub token 返回给调用方', async () => {
    const result = await app.call('GET', '/public-jobs?q=Rust&city=%E4%B8%8A%E6%B5%B7&cursor=previous&limit=1')

    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      data: [publicJob],
      meta: { limit: 1, nextCursor: 'next-page' },
    })
    expect(upstreamPath).toBe('/api/jobs?q=Rust&city=%E4%B8%8A%E6%B5%B7&cursor=previous&limit=1')
    expect(upstreamToken).toBe('hub-secret')
    expect(JSON.stringify(result.body)).not.toContain('hub-secret')
  })

  it('收藏公开岗位会创建私有公司和完整岗位', async () => {
    const result = await app.call('POST', `/public-jobs/${publicJob.id}/favorite`)

    expect(result.status).toBe(201)
    expect(result.body.data.duplicate).toBe(false)
    expect(result.body.data.job).toMatchObject({
      companyName: '公开公司',
      title: 'Rust 后端工程师',
      jdUrl: 'https://careers.example.com/jobs/123',
      jdText: '完整公开 JD',
      city: '上海',
      salaryMin: 30000,
      salaryMax: 50000,
      channel: 'official',
      fitScore: null,
    })

    const privateJobs = await app.call('GET', `/jobs?jdUrl=${encodeURIComponent(publicJob.jdUrl)}`)
    expect(privateJobs.body.data).toHaveLength(1)
    expect(privateJobs.body.data[0].id).toBe(result.body.data.job.id)
    expect(privateJobs.body.data[0].companyName).toBe('公开公司')
  })

  it('重复收藏同一链接返回原岗位且不重复落库', async () => {
    const first = await app.call('POST', `/public-jobs/${publicJob.id}/favorite`)
    const second = await app.call('POST', `/public-jobs/${publicJob.id}/favorite`)

    expect(second.status).toBe(200)
    expect(second.body.data.duplicate).toBe(true)
    expect(second.body.data.job.id).toBe(first.body.data.job.id)

    const privateJobs = await app.call('GET', `/jobs?jdUrl=${encodeURIComponent(publicJob.jdUrl)}`)
    expect(privateJobs.body.data).toHaveLength(1)
  })

  it('上游岗位字段违反私有库约束时拒绝收藏', async () => {
    detailJob = { ...publicJob, salaryMin: 60000, salaryMax: 50000 }

    const result = await app.call('POST', `/public-jobs/${publicJob.id}/favorite`)

    expect(result.status).toBe(400)
    expect(result.body.error.code).toBe('VALIDATION_FAILED')
    const privateJobs = await app.call('GET', `/jobs?jdUrl=${encodeURIComponent(publicJob.jdUrl)}`)
    expect(privateJobs.body.data).toHaveLength(0)
    const companies = await app.call('GET', `/companies?q=${encodeURIComponent(publicJob.companyName)}`)
    expect(companies.body.data).toHaveLength(0)
  })
})
