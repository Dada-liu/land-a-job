import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * 开发期把 /api 与 /ws 代理到本地服务，页面始终同源，令牌自举不需要 CORS。
 *
 * 端口不能写死 4399：服务端在 4399 被占用时会顺延（`resolvePort`），写死的结果是
 * 「后端在 4400，vite 还在往 4399 转发」，页面所有请求都 502。
 * 正常走 `npm run dev` 时由 scripts/dev-web.mjs 探到真实端口后用 LAND_API_PORT 传进来；
 * 单独跑 vite 时退回 LAND_PORT / 4399。
 */
const target = `http://127.0.0.1:${process.env.LAND_API_PORT ?? process.env.LAND_PORT ?? '4399'}`

/**
 * 代理连不上后端时，vite 只会打一行 ECONNREFUSED；补一句人话，省得去猜 502 是哪来的。
 * 只解释「后端不在」这一类错误：EPIPE / ECONNRESET 多半是浏览器关页面时把长连接掐了，
 * 属于正常现象，逐条打出来只会淹没真正的报错。
 */
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'])

function warnOnProxyError(proxy: { on: (event: 'error', listener: (error: Error) => void) => void }): void {
  proxy.on('error', (error) => {
    const code = (error as NodeJS.ErrnoException).code
    if (!code || !UNREACHABLE_CODES.has(code)) return
    console.error(
      `[vite] 代理到 ${target} 失败（${code}）：后端没起来？看终端里的 server 输出或 data/logs/server.log`,
    )
  })
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 显式绑 IPv4：Vite 默认绑 ::1，用 127.0.0.1:5173 会打不开，
    // 而服务端与文档统一使用 127.0.0.1，两边保持一致。
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: false, configure: warnOnProxyError },
      // /ws 不挂提示：客户端断开时的 EPIPE/ECONNRESET 都会被 vite 自己记一行，再补一句没有信息量
      '/ws': { target: target.replace('http', 'ws'), ws: true },
      // /apply-demo 是服务端内置的演示表单，界面上已没有入口，只剩 E2E 当靶子用；
      // 手工在 dev 里调试它时仍然需要代理，否则会落到 SPA 兜底返回 index.html。
      '/apply-demo': { target, changeOrigin: false, configure: warnOnProxyError },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
