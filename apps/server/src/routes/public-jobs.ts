import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CHANNELS, JOB_STATUSES, zJobCreate, zMoney, zOptText, zText, zUrl } from '@land/core'
import type { PositionHubConfig } from '../config.js'
import { AppError } from '../errors.js'
import { createCompany, listCompanies } from '../db/repositories/company.js'
import { createJob, getJob, listJobs } from '../db/repositories/job.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

const listEnvelope = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ limit: z.number().int(), nextCursor: z.string().nullable() }).optional(),
})

function configOrThrow(config: PositionHubConfig | null): PositionHubConfig {
  if (!config) {
    throw new AppError(
      'POSITION_HUB_NOT_CONFIGURED',
      '公开岗位库未配置，请设置 POSITION_HUB_BASE_URL 和 POSITION_HUB_TOKEN',
      503,
    )
  }
  return config
}

async function requestHub(config: PositionHubConfig, path: string): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      headers: { 'x-land-token': config.token, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new AppError('POSITION_HUB_UNAVAILABLE', '公开岗位库暂时无法连接', 503, {
      reason: error instanceof Error ? error.message : String(error),
    })
  }
  if (!response.ok) {
    throw new AppError('POSITION_HUB_UPSTREAM_FAILED', `公开岗位库返回 HTTP ${response.status}`, 502, {
      status: response.status,
    })
  }
  try {
    return await response.json()
  } catch {
    throw new AppError('POSITION_HUB_INVALID_RESPONSE', '公开岗位库返回了非 JSON 响应', 502)
  }
}

const publicJobDetail = z.object({
  id: z.string().trim().min(1).max(64),
  companyName: zText(200),
  title: zText(120),
  jdUrl: zUrl.nullish(),
  jdText: z.string().max(200_000).nullish(),
  jdSource: zOptText(40),
  channel: z.enum(CHANNELS),
  city: zOptText(40),
  salaryMin: zMoney.nullish(),
  salaryMax: zMoney.nullish(),
  level: zOptText(40),
  keywords: z.array(z.string().trim().min(1).max(40)).max(40).nullish(),
  status: z.enum(JOB_STATUSES),
})

export function registerPublicJobRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/public-jobs', async (request) => {
    const config = configOrThrow(deps.positionHub)
    const url = new URL(request.raw.url ?? '/api/public-jobs', 'http://local')
    const payload = listEnvelope.parse(await requestHub(config, `/api/jobs${url.search}`))
    return payload
  })

  app.post('/api/public-jobs/:id/favorite', async (request, reply) => {
    const config = configOrThrow(deps.positionHub)
    const { id } = z.object({ id: z.string().trim().min(1).max(64) }).parse(request.params)
    const payload = z.object({ data: publicJobDetail }).parse(
      await requestHub(config, `/api/jobs/${encodeURIComponent(id)}`),
    )
    const publicJob = payload.data
    if (!publicJob.jdUrl) {
      throw new AppError('PUBLIC_JOB_URL_MISSING', '该公开岗位没有详情链接，无法纳入私有库查重', 422)
    }
    const existing = listJobs(deps.db, { jdUrl: publicJob.jdUrl, limit: 1 }).items[0]
    if (existing) {
      return ok({ job: getJob(deps.db, existing.id), duplicate: true })
    }

    const input = zJobCreate.parse({
      companyId: 'pending-company-mapping',
      title: publicJob.title,
      jdUrl: publicJob.jdUrl,
      jdText: publicJob.jdText,
      jdSource: publicJob.jdSource,
      channel: publicJob.channel,
      city: publicJob.city,
      salaryMin: publicJob.salaryMin,
      salaryMax: publicJob.salaryMax,
      level: publicJob.level,
      keywords: publicJob.keywords,
      status: publicJob.status,
      priority: 3,
      notes: null,
    })
    const companies = listCompanies(deps.db, { q: publicJob.companyName, limit: 50 }).items
    const company =
      companies.find((item) => item.name.trim() === publicJob.companyName.trim()) ??
      createCompany(deps.db, { name: publicJob.companyName, city: publicJob.city })
    const created = createJob(deps.db, { ...input, companyId: company.id })
    const job = getJob(deps.db, created.id)
    deps.ws.invalidate(['jobs', 'companies', 'stats'])
    return reply.code(201).send(ok({ job, duplicate: false }))
  })
}
