import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { zCompanyCreate, zCompanyListQuery, zCompanyPatch, zId } from '@land/core'
import {
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  updateCompany,
} from '../db/repositories/company.js'
import { listJobs } from '../db/repositories/job.js'
import { ok, paginated } from '../reply.js'
import type { RouteDeps } from './index.js'

export function registerCompanyRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/companies', async (request) => {
    const query = zCompanyListQuery.parse(request.query)
    const page = listCompanies(db, query)
    return paginated(page.items, query.limit, page.nextCursor)
  })

  app.get('/api/companies/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const company = getCompany(db, id)
    // 详情页一次性给全：公司信息 + 它下面的岗位，省一次往返
    const jobs = listJobs(db, { limit: 100, companyId: id }).items
    return ok({ ...company, jobs })
  })

  app.post('/api/companies', async (request, reply) => {
    const input = zCompanyCreate.parse(request.body)
    const company = createCompany(db, input)
    ws.invalidate(['companies', 'stats'])
    return reply.code(201).send(ok(company))
  })

  app.patch('/api/companies/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const patch = zCompanyPatch.parse(request.body)
    const company = updateCompany(db, id, patch)
    ws.invalidate(['companies', `company:${id}`, 'stats'])
    return ok(company)
  })

  app.delete('/api/companies/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const cascade = z
      .object({ cascade: z.enum(['true', 'false']).optional() })
      .parse(request.query)
    const result = deleteCompany(db, id, cascade.cascade === 'true')
    ws.invalidate(['companies', 'jobs', 'stats'])
    return ok({ id, ...result })
  })
}
