import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { zId, zQuestionCreate, zQuestionPatch, zQuestionQuery } from '@land/core'
import {
  createQuestion,
  deleteQuestion,
  getQuestion,
  listQuestions,
  updateQuestion,
} from '../db/repositories/question.js'
import { ok } from '../reply.js'
import { acceptProvenance } from '../provenance.js'
import type { RouteDeps } from './index.js'

const idParams = z.object({ id: zId })

export function registerQuestionRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/questions', async (request) => {
    const query = zQuestionQuery.parse(request.query)
    return ok(listQuestions(db, query))
  })

  app.get('/api/questions/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(getQuestion(db, id))
  })

  app.post('/api/questions', async (request, reply) => {
    const input = zQuestionCreate.parse(request.body)
    const question = createQuestion(db, { ...input, provenance: acceptProvenance(input.provenance) })
    ws.invalidate(['questions'])
    return reply.code(201).send(ok(question))
  })

  app.patch('/api/questions/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const patch = zQuestionPatch.parse(request.body)
    const question = updateQuestion(db, id, {
      ...patch,
      ...(patch.provenance === undefined ? {} : { provenance: acceptProvenance(patch.provenance) }),
    })
    ws.invalidate(['questions', `question:${id}`])
    return ok(question)
  })

  app.delete('/api/questions/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    deleteQuestion(db, id)
    ws.invalidate(['questions'])
    return ok({ id, deleted: true })
  })
}
