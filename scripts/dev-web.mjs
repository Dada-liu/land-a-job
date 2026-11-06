/**
 * 开发期启动 web 之前，先等后端 `/api/health` 就绪。
 *
 * 为什么需要：vite 3 秒就能起（web 立刻可访问），而 dev:server 要先 `tsc -b` 编 @land/core、
 * 再用 tsx 编译启动，中间这几秒里打开页面，`/api/bootstrap` 会被 vite 代理成
 * 「502 Bad Gateway」，页面于是报「无法获取本机令牌（HTTP 502）」。
 *
 * 顺手把探到的真实端口用 LAND_API_PORT 传给 vite：服务端在 4399 被占用时会顺延端口，
 * 而 vite 的代理目标若写死 4399，就会一直 502。
 *
 * 跑法（package.json 的 dev:web 已接好）：node scripts/dev-web.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SERVICE_NAME = 'land-a-job'
const DEFAULT_PORT = 4399
const PORT_FILE = path.join(ROOT, 'data', '.port')
const WAIT_MS = Number.parseInt(process.env.LAND_DEV_WAIT_MS ?? '', 10) || 90_000
const POLL_MS = 300

/** 服务端在首选端口被占时会向上顺延，最多试 10 个（见 apps/server/src/port.ts 的 resolvePort） */
const PORT_SPAN = 10

const span = (from) => Array.from({ length: PORT_SPAN }, (_, index) => from + index)

/**
 * 候选端口：显式 LAND_PORT > 服务端上次写的 data/.port > 默认 4399，各带一段顺延区间。
 * 默认段始终带上——`.port` 可能是上一次运行留下的（顺延时写的是 4400），不能只信它。
 */
function candidatePorts() {
  const ports = []
  const explicit = Number.parseInt(process.env.LAND_PORT ?? '', 10)
  if (Number.isFinite(explicit) && explicit > 0) {
    ports.push(...span(explicit))
  } else {
    try {
      const fromFile = Number.parseInt(readFileSync(PORT_FILE, 'utf8').trim(), 10)
      if (Number.isFinite(fromFile) && fromFile > 0) ports.push(...span(fromFile))
    } catch {
      // 首次启动还没有 .port，退回默认端口
    }
    ports.push(...span(DEFAULT_PORT))
  }
  return [...new Set(ports)]
}

/**
 * 只认「是本服务在应答」，避免把别的程序误判成后端。
 * 用 node:http 而不是 fetch：fetch（undici）在设置了 NODE_USE_ENV_PROXY 的机器上会把
 * 127.0.0.1 的请求也丢给 HTTP_PROXY，探测结果就全成了 false。
 */
function probe(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 800 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        resolve(false)
        return
      }
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        if (raw.length < 4096) raw += chunk
      })
      res.on('end', () => {
        try {
          const body = JSON.parse(raw)
          resolve((body?.data?.service ?? body?.service) === SERVICE_NAME)
        } catch {
          resolve(false)
        }
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

async function waitForApi() {
  const deadline = Date.now() + WAIT_MS
  let announced = false
  while (Date.now() < deadline) {
    const ports = candidatePorts()
    for (const port of ports) {
      if (await probe(port)) return port
    }
    if (!announced) {
      console.log(`[dev:web] 等待后端就绪（${ports[0]} 起，含顺延端口）…`)
      announced = true
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return null
}

const port = await waitForApi()
if (port) {
  console.log(`[dev:web] 后端已就绪 → http://127.0.0.1:${port}`)
} else {
  // 不硬失败：前端照样起来，页面里的 502 提示与 server 日志才是排查入口
  console.warn(
    `[dev:web] 等了 ${Math.round(WAIT_MS / 1000)}s 后端仍未就绪，先启动前端；` +
      '页面会提示 502，请查看终端里的 server 输出或 data/logs/server.log',
  )
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const child = spawn(npm, ['run', 'dev', '-w', '@land/web'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ...(port ? { LAND_API_PORT: String(port) } : {}) },
})

// concurrently 用 SIGTERM 收工，要转发给 vite，否则 Ctrl-C 之后 5173 会挂着一个孤儿进程
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0))
})
