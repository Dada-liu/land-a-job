import type { FastifyInstance } from 'fastify'

/**
 * 浏览器扩展的跨域白名单（BOSS 直聘桥接提案 §9 第 1 项）。
 *
 * 为什么不用通用 CORS 插件：本机服务的安全模型是「跨站请求带不上自定义头
 * x-land-token，而我们不响应预检」（见 token.ts）。扩展的跨域写请求必然带这个头，
 * 所以必须放行预检——但只能放行**指定的扩展 ID**，且令牌校验一点都不能松。
 *
 * 默认空集合 = 功能关闭，现有同源页面与 CSRF 防护行为完全不变。
 */
const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/
const BARE_EXTENSION_ID = /^[a-p]{32}$/
const ALLOWED_HEADERS = 'x-land-token,content-type'
const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,OPTIONS'

/** 接受「32 位扩展 ID」或完整 chrome-extension:// 源；其它值一律忽略，不开给任意网页 */
export function parseExtensionOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>()
  for (const part of (raw ?? '').split(',')) {
    const value = part.trim()
    if (!value) continue
    if (BARE_EXTENSION_ID.test(value)) origins.add(`chrome-extension://${value}`)
    else if (CHROME_EXTENSION_ORIGIN.test(value)) origins.add(value)
  }
  return origins
}

export function registerExtensionCors(app: FastifyInstance, allowed: ReadonlySet<string>): void {
  if (allowed.size === 0) return

  /** 必须在 registerAuth 之前注册：OPTIONS 预检不带令牌，不能被鉴权钩子拦成 401 */
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (!origin || !allowed.has(origin) || request.method !== 'OPTIONS') return

    reply
      .header('access-control-allow-origin', origin)
      .header('access-control-allow-methods', ALLOWED_METHODS)
      .header('access-control-allow-headers', ALLOWED_HEADERS)
      .header('access-control-max-age', '600')
      .header('vary', 'Origin')
      .code(204)
    return reply.send()
  })

  /** 正常响应（含 401/4xx）也补上白名单源，扩展才能读到错误体 */
  app.addHook('onSend', async (request, reply, payload) => {
    const origin = request.headers.origin
    if (origin && allowed.has(origin)) {
      reply.header('access-control-allow-origin', origin)
      reply.header('vary', 'Origin')
    }
    return payload
  })
}
