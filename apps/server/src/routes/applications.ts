import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  STATUSES,
  zApplicationCreate,
  zApplicationPatch,
  zId,
  zListQuery,
  zNoteAppend,
  zStatusChange,
} from '@land/core'
import {
  appendNote,
  changeStatus,
  createApplication,
  deleteApplication,
  getApplication,
  listApplications,
  listTimeline,
  updateApplication,
} from '../db/repositories/application.js'
import { ok, paginated } from '../reply.js'
import type { RouteDeps } from './index.js'

const idParams = z.object({ id: zId })

const listQuery = zListQuery.extend({
  status: z.enum(STATUSES).optional(),
  jobId: zId.optional(),
  companyId: zId.optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export function registerApplicationRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/applications', async (request) => {
    const { active, ...query } = listQuery.parse(request.query)
    const page = listApplications(db, { ...query, activeOnly: active })
    return paginated(page.items, query.limit, page.nextCursor)
  })

  app.get('/api/applications/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(getApplication(db, id))
  })

  app.get('/api/applications/:id/timeline', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(listTimeline(db, id))
  })

  app.post('/api/applications', async (request, reply) => {
    const input = zApplicationCreate.parse(request.body)
    const application = createApplication(db, input)
    ws.invalidate(['applications', 'jobs', 'stats'])
    return reply.code(201).send(ok(application))
  })

  app.patch('/api/applications/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const patch = zApplicationPatch.parse(request.body)
    const application = updateApplication(db, id, patch)
    ws.invalidate(['applications', `application:${id}`])
    return ok(application)
  })

  /**
   * 改状态是投递流程里唯一的「推进动作」，单独成一个端点：
   * 状态机校验与事件写入都在事务里，PATCH 不允许直接改 status。
   */
  app.post('/api/applications/:id/status', async (request) => {
    const { id } = idParams.parse(request.params)
    const input = zStatusChange.parse(request.body)
    const result = changeStatus(db, id, input)
    ws.invalidate(['applications', `application:${id}`, 'timeline', 'stats'])
    return ok(result)
  })

  app.post('/api/applications/:id/notes', async (request, reply) => {
    const { id } = idParams.parse(request.params)
    const input = zNoteAppend.parse(request.body)
    const event = appendNote(db, id, input)
    ws.invalidate([`application:${id}`, 'timeline'])
    return reply.code(201).send(ok(event))
  })

  app.delete('/api/applications/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const { actor, source } = z
      .object({ actor: z.enum(['user', 'agent', 'rule']).default('user'), source: z.enum(['web', 'mcp', 'cli', 'rule']).default('web') })
      .parse(request.body ?? {})
    deleteApplication(db, id, actor, source)
    ws.invalidate(['applications', 'stats'])
    return ok({ id, deleted: true })
  })
}
