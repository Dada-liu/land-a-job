import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { TOKEN_FILE } from './config.js'

/**
 * 本机 API 令牌。
 *
 * 它不是"用户登录"，而是**防跨站请求**：浏览器里任意网页可以向后端发简单请求，
 * 但无法在跨域请求里带上自定义头 X-Land-Token（会被预检拦住，而我们不响应预检）。
 * 因此只要所有写接口强制校验该头，drive-by 的 CSRF 就被挡在门外。
 *
 * 页面自己怎么拿到令牌：GET /api/bootstrap（同源可读，跨域读不到响应体）。
 */
export function getOrCreateToken(file = TOKEN_FILE): string {
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch {
    // 首次启动或文件不可读，继续生成
  }

  const token = randomBytes(24).toString('hex')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, token, { encoding: 'utf8', mode: 0o600 })
  return token
}

/** 定长摘要后比较，避免按字节泄露长度与内容 */
export function tokenEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}
