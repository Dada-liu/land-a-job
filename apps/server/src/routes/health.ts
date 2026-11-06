import type { FastifyInstance } from 'fastify'
import { APP_VERSION, SERVICE_NAME } from '../config.js'
import { countTables, schemaVersion } from '../db/index.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

/**
 * /api/health 是「服务身份」的唯一可信来源：
 * MCP 靠它判断端口上是不是自己人，端口探测也靠它区分 ours / other。
 * 因此 service 字段不可随意改名。
 */
export function registerHealthRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/health', async () =>
    ok({
      ok: true,
      service: SERVICE_NAME,
      version: APP_VERSION,
      uptimeSec: Math.round(process.uptime()),
      port: deps.port,
      db: { version: schemaVersion(deps.db), tables: countTables(deps.db) },
      ws: { clients: deps.ws.clientCount() },
      skills: [] as string[],
    }),
  )
}
