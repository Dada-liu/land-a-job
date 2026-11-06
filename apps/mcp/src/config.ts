import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_LAYOUT, SERVICE_NAME } from '@land/core'

export { SERVICE_NAME }

/** 源码在 apps/mcp/src、产物在 apps/mcp/dist，向上三级都是仓库根（与 server 一致） */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

export const DATA_DIR = process.env.LAND_DATA_DIR
  ? path.resolve(process.env.LAND_DATA_DIR)
  : path.join(REPO_ROOT, 'data')

export const PORT_FILE = path.join(DATA_DIR, DATA_LAYOUT.portFile)
export const TOKEN_FILE = path.join(DATA_DIR, DATA_LAYOUT.tokenFile)
export const SERVER_ENTRY = path.join(REPO_ROOT, 'apps', 'server', 'dist', 'index.js')

export const HOST = '127.0.0.1'
export const DEFAULT_PORT = Number.parseInt(process.env.LAND_PORT ?? '', 10) || 4399

/** 启动 server 后最多等这么久（首次要跑迁移，给足 15s） */
export const START_TIMEOUT_MS = 15_000
export const REQUEST_TIMEOUT_MS = 120_000

export function readPortFile(): number | null {
  try {
    const raw = readFileSync(PORT_FILE, 'utf8').trim()
    const port = Number.parseInt(raw, 10)
    return Number.isFinite(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

export function writePortFile(port: number): void {
  mkdirSync(path.dirname(PORT_FILE), { recursive: true })
  writeFileSync(PORT_FILE, String(port), 'utf8')
}

/**
 * 令牌只从文件读，不接受命令行/环境变量注入：
 * 环境变量会随 Agent 的日志一起被记下来，等于把令牌写进聊天记录。
 */
export function readToken(): string | null {
  try {
    const token = readFileSync(TOKEN_FILE, 'utf8').trim()
    return token.length >= 32 ? token : null
  } catch {
    return null
  }
}
