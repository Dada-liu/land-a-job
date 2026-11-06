import { writeFileSync } from 'node:fs'
import net from 'node:net'
import { HOST, PORT_FILE, SERVICE_NAME } from './config.js'

export type PortProbe = 'free' | 'ours' | 'other'

const LISTEN_TIMEOUT_MS = 300
const HEALTH_TIMEOUT_MS = 600

function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port })
    const finish = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(LISTEN_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/**
 * 端口归属判断：
 * - ours：已经有一个本服务在跑（应当复用而不是抢占）
 * - other：被别的程序占用（应当换端口）
 * - free：可用
 */
export async function probePort(port: number): Promise<PortProbe> {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (res.ok) {
      // 统一信封后 service 在 data 里；兼容旧版本的平铺形状，避免升级期间误判为 other
      const body = (await res.json()) as { data?: { service?: unknown }; service?: unknown }
      const service = body.data?.service ?? body.service
      if (service === SERVICE_NAME) return 'ours'
    }
    return 'other'
  } catch {
    return (await isListening(port)) ? 'other' : 'free'
  }
}

export class AlreadyRunningError extends Error {
  constructor(readonly port: number) {
    super(`land-a-job 已在 ${HOST}:${port} 运行，无需重复启动`)
    this.name = 'AlreadyRunningError'
  }
}

/**
 * 从 preferred 开始向上找可用端口，最多尝试 span 个。
 * 选定后写入 data/.port，供 MCP 侧读取（它可能先于页面启动）。
 */
export async function resolvePort(preferred: number, span = 10): Promise<number> {
  for (let port = preferred; port < preferred + span; port += 1) {
    const state = await probePort(port)
    if (state === 'free') {
      writeFileSync(PORT_FILE, String(port), 'utf8')
      return port
    }
    if (state === 'ours') throw new AlreadyRunningError(port)
  }
  throw new Error(`端口 ${preferred}–${preferred + span - 1} 均被占用，请设置 LAND_PORT 指定其他端口`)
}
