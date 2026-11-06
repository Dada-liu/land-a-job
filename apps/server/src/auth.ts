import type { FastifyInstance } from 'fastify'
import { tokenEquals } from './token.js'

const TOKEN_HEADER = 'x-land-token'

/** 无需令牌的接口：健康检查用于端口探测，bootstrap 用于页面自举令牌 */
const PUBLIC_API = new Set(['/api/health', '/api/bootstrap'])

/**
 * 只拦 /api/*：静态页面与资源必须放行，否则页面加载不出来。
 * 空 body 的跨站请求带不上自定义头，所以这一层就足以挡住 drive-by CSRF。
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url ?? ''
    if (!url.startsWith('/api/')) return

    const pathname = url.split('?')[0] ?? ''
    if (PUBLIC_API.has(pathname)) return

    const provided = request.headers[TOKEN_HEADER]
    if (typeof provided === 'string' && tokenEquals(provided, token)) return

    return reply
      .code(401)
      .send({ error: { code: 'UNAUTHORIZED', message: `缺少或无效的 ${TOKEN_HEADER} 请求头` } })
  })
}
