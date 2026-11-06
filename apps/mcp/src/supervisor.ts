import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  DEFAULT_PORT,
  HOST,
  SERVER_ENTRY,
  START_TIMEOUT_MS,
  readPortFile,
  writePortFile,
} from './config.js'

/**
 * 自动拉起 server（P5-7）。
 *
 * Agent 不该要求用户「先开终端跑 npm start 再回来和我说话」——那是最容易被放弃的一步。
 * 所以第一次工具调用时自己把服务起起来，起不来再报「请检查 xxx」。
 */

export interface SupervisorState {
  base: string
  port: number
  started: boolean
}

let inflight: Promise<SupervisorState> | null = null
let cached: SupervisorState | null = null

async function health(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/health`, { signal: AbortSignal.timeout(800) })
    if (!res.ok) return false
    const body = (await res.json()) as { data?: { service?: unknown }; service?: unknown }
    return (body.data?.service ?? body.service) === 'land-a-job'
  } catch {
    return false
  }
}

/** 端口文件可能是上次运行的残留，所以要在附近端口区间里实地探一遍 */
async function probeExisting(): Promise<number | null> {
  const fromFile = readPortFile()
  if (fromFile && (await health(fromFile))) return fromFile
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + 10; port += 1) {
    if (port === fromFile) continue
    if (await health(port)) return port
  }
  return null
}

async function waitForHealthy(port: number, child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `server 进程启动后立即退出（code=${child.exitCode}）；请手动运行 node ${SERVER_ENTRY} 查看报错`,
      )
    }
    if (await health(port)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待 server 在 ${HOST}:${port} 就绪超时（${START_TIMEOUT_MS}ms）`)
}

async function doEnsure(): Promise<SupervisorState> {
  const existing = await probeExisting()
  if (existing) {
    writePortFile(existing)
    return { base: `http://${HOST}:${existing}`, port: existing, started: false }
  }

  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(
      `找不到 server 产物 ${SERVER_ENTRY}；请先在仓库根执行 npm run build，或手动启动开发服务`,
    )
  }

  const port = DEFAULT_PORT
  // detached：MCP 进程被 Agent 关掉时 server 继续活着，下次调用不用再等启动
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LAND_PORT: String(port) },
  })
  child.unref()

  await waitForHealthy(port, child)
  writePortFile(port)
  return { base: `http://${HOST}:${port}`, port, started: true }
}

export async function ensureServer(): Promise<SupervisorState> {
  if (cached) return cached
  if (!inflight) {
    inflight = doEnsure()
      .then((state) => {
        cached = state
        return state
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** 出错后允许下次调用重新探测（服务可能刚好重启过） */
export function forgetServer(): void {
  cached = null
}
