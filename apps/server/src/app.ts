import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { closeAllSessions } from './apply/session.js'
import { registerAuth } from './auth.js'
import { EXTENSION_ORIGINS, readPositionHubConfig, type PositionHubConfig } from './config.js'
import { registerExtensionCors } from './extension-cors.js'
import { openDb, type Db } from './db/index.js'
import { registerErrorHandler } from './errors.js'
import { registerRoutes } from './routes/index.js'
import { registerStatic } from './static.js'
import { attachWs, type WsHub } from './ws.js'

export interface BuildAppOptions {
  /** 库文件绝对路径。测试传临时目录，CLI 传 LAND_DATA_DIR 下的 land.db */
  dbFile: string
  token: string
  port: number
  /** 传 null 跳过静态托管（契约测试只关心 /api） */
  webRoot?: string | null
  logger?: FastifyBaseLogger | false
  /** 扩展 CORS 白名单；不传时读 LAND_EXTENSION_ORIGINS（默认空＝关闭） */
  extensionOrigins?: ReadonlySet<string>
  /** 公开岗位库上游；不传时读 POSITION_HUB_BASE_URL / POSITION_HUB_TOKEN */
  positionHub?: PositionHubConfig | null
}

export interface LandApp {
  app: FastifyInstance
  db: Db
  ws: WsHub
  close: () => Promise<void>
}

/**
 * 组装应用（不监听端口）。
 *
 * 拆出这一层是为了契约测试能用 app.inject() 打真实路由，
 * 而不必起进程、占端口、写 data/ 下的真实库。
 */
export async function buildApp(options: BuildAppOptions): Promise<LandApp> {
  const db = openDb(options.dbFile)

  const app = Fastify({
    // pino 10 的 Logger 与 Fastify 的 FastifyBaseLogger 在 msgPrefix 上有类型差异，
    // 运行时完全兼容（pino 就是 Fastify 默认 logger），这里只做类型收敛。
    ...(options.logger === false ? { logger: false } : { loggerInstance: options.logger as FastifyBaseLogger }),
    bodyLimit: 8 * 1024 * 1024,
  })

  registerErrorHandler(app)
  // 必须早于 registerAuth：白名单内的 OPTIONS 预检不带令牌，不能被鉴权钩子拦成 401
  registerExtensionCors(app, options.extensionOrigins ?? EXTENSION_ORIGINS)
  registerAuth(app, options.token)

  const ws = attachWs(app.server)
  registerRoutes(app, {
    db,
    token: options.token,
    ws,
    port: options.port,
    positionHub: options.positionHub === undefined ? readPositionHubConfig() : options.positionHub,
  })

  if (options.webRoot) await registerStatic(app, options.webRoot)

  return {
    app,
    db,
    ws,
    close: async () => {
      // 投递助手会拉起本机 Chrome；服务退出时必须一起关掉，否则留下孤儿进程
      await closeAllSessions()
      await ws.close()
      await app.close()
      db.close()
    },
  }
}
