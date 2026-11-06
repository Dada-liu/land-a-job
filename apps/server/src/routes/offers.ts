import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { OFFER_STATUSES, zId, zOfferCreate, zOfferPatch } from '@land/core'
import { createOffer, getOffer, listOffers, updateOffer } from '../db/repositories/offer.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

const idParams = z.object({ id: zId })

const listQuery = z.object({
  status: z.enum(OFFER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
})

export function registerOfferRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/offers', async (request) => {
    const query = listQuery.parse(request.query)
    return ok(listOffers(db, query))
  })

  app.get('/api/offers/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(getOffer(db, id))
  })

  app.post('/api/offers', async (request, reply) => {
    const input = zOfferCreate.parse(request.body)
    const offer = createOffer(db, input)
    ws.invalidate(['offers', 'stats'])
    return reply.code(201).send(ok(offer))
  })

  app.patch('/api/offers/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    const patch = zOfferPatch.parse(request.body)
    const offer = updateOffer(db, id, patch)
    ws.invalidate(['offers', `offer:${id}`])
    return ok(offer)
  })
}
