import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'

/**
 * 托管 Web 构建产物（apps/web/dist）。
 * 未构建时返回一张说明页而不是 404 —— 否则用户会以为服务挂了。
 */
export async function registerStatic(app: FastifyInstance, webRoot: string): Promise<void> {
  const indexFile = path.join(webRoot, 'index.html')

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? ''
    if (url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `未知接口 ${url}` } })
    }
    if (!existsSync(indexFile)) {
      return reply.code(503).type('text/html; charset=utf-8').send(buildHintHtml(webRoot))
    }
    // SPA 回退：/pipeline、/offers 这类前端路由都交给 index.html
    return reply.sendFile('index.html')
  })

  if (!existsSync(indexFile)) {
    app.get('/', async (_request, reply) =>
      reply.code(503).type('text/html; charset=utf-8').send(buildHintHtml(webRoot)),
    )
    return
  }

  await app.register(fastifyStatic, {
    root: webRoot,
    index: ['index.html'],
    setHeaders(reply, filePath) {
      if (filePath.endsWith('index.html')) {
        reply.header('cache-control', 'no-store')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        reply.header('cache-control', 'public, max-age=31536000, immutable')
      } else if (filePath.endsWith('favicon.svg')) {
        // 图标不带哈希，给一天缓存即可；过长的缓存会让换图标后旧图一直挂着
        reply.header('cache-control', 'public, max-age=86400')
      }
    },
  })
}

function buildHintHtml(webRoot: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Land a Job · 前端未构建</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #f7f7f5; color: #1c1c1a;
         font: 15px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  main { max-width: 560px; padding: 40px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { color: #55554f; margin: 0 0 10px; }
  code { background: #ecece8; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
  pre { background: #1c1c1a; color: #f2f2ee; padding: 14px 16px; border-radius: 8px; overflow: auto; }
</style>
<main>
  <h1>前端还没构建</h1>
  <p>服务已经跑起来了，但找不到 <code>${webRoot}</code> 下的页面文件。</p>
  <p>执行下面任一条即可：</p>
  <pre>npm run build          # 构建后刷新本页
npm run dev            # 开发模式，另开 http://127.0.0.1:5173</pre>
</main>
</html>`
}
