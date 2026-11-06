import type { FastifyInstance } from 'fastify'
import { APP_VERSION, SERVICE_NAME } from '../config.js'
import { countTables, schemaVersion, type Db } from '../db/index.js'
import { ok } from '../reply.js'
import { scanSkills } from '../skills/scan.js'
import type { WsHub } from '../ws.js'
import { registerApplicationRoutes } from './applications.js'
import { registerApplyRoutes } from './apply.js'
import { registerCompanyRoutes } from './companies.js'
import { registerDataRoutes } from './data.js'
import { registerHealthRoutes } from './health.js'
import { registerInterviewRoutes } from './interviews.js'
import { registerJobRoutes } from './jobs.js'
import { registerOfferRoutes } from './offers.js'
import { registerQuestionRoutes } from './questions.js'
import { registerResumeRoutes } from './resumes.js'
import { registerStatsRoutes } from './stats.js'
import { registerTailorRoutes } from './tailor.js'

export interface RouteDeps {
  db: Db
  token: string
  ws: WsHub
  port: number
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerHealthRoutes(app, deps)

  /** 页面自举：同源可读、跨域读不到响应体，因此可以安全下发本机令牌 */
  app.get('/api/bootstrap', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
    return {
      service: SERVICE_NAME,
      version: APP_VERSION,
      token: deps.token,
      wsUrl: '/ws',
    }
  })

  /**
   * Skill 状态：返回登记的 Skill、本机 SKILL.md 声明的版本、以及各 Agent 目录里的安装情况。
   * 页面状态条与 MCP 的 get_app_status 都读这里，避免两处各算一遍版本兼容。
   */
  app.get('/api/skills', async () => ok(scanSkills()))

  // 便于排查：确认库路径与迁移版本
  app.get('/api/db/stats', async () =>
    ok({
      version: schemaVersion(deps.db),
      tables: countTables(deps.db),
      file: deps.db.name,
    }),
  )

  registerCompanyRoutes(app, deps)
  registerJobRoutes(app, deps)
  registerResumeRoutes(app, deps)
  registerApplicationRoutes(app, deps)
  registerInterviewRoutes(app, deps)
  registerQuestionRoutes(app, deps)
  registerOfferRoutes(app, deps)
  registerStatsRoutes(app, deps)
  registerTailorRoutes(app, deps)
  registerApplyRoutes(app, deps)
  registerDataRoutes(app, deps)
}
