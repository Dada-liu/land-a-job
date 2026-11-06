import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { zId, zInterviewCreate, zInterviewPatch, zInterviewQuery } from '@land/core'
import {
  createInterview,
  deleteInterview,
  getInterview,
  listInterviews,
  updateInterview,
} from '../db/repositories/interview.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

const idParams = z.object({ id: zId })

export function registerInterviewRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/interviews', async (request) => {
    const query = zInterviewQuery.parse(request.query)
    return ok(listInterviews(db, query))
  })

  app.get('/api/interviews/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(getInterview(db, id))
  })

  app.post('/api/interviews', async (request, reply) => {
    const input = zInterviewCreate.parse(request.body)
    const interview = createInterview(db, input)
    ws.invalidate(['interviews', 'applications', 'stats'])
    return reply.code(201).send(ok(interview))
  })

  app.patch('/api/interviews/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const patch = zInterviewPatch.parse(request.body)
    const interview = updateInterview(db, id, patch)
    ws.invalidate(['interviews', `interview:${id}`])
    return ok(interview)
  })

  app.delete('/api/interviews/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    deleteInterview(db, id)
    ws.invalidate(['interviews', 'stats'])
    return ok({ id, deleted: true })
  })
}
