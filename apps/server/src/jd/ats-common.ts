import { AppError } from '../errors.js'
import { MIN_TEXT_LENGTH, escapeHtml, htmlFragmentToText, sanitizeText } from './html.js'
import type { JdFetchContext } from './types.js'

/**
 * 站点适配器共用件。
 *
 * 与 Greenhouse / Lever 的「一个 GET 拿全部」不同，飞书招聘与北森的接口要 POST、
 * 要门户头、要翻页找 id，且不同租户的头还不一样。所以这里提供的是**容错调用**：
 * 单个门户尝试失败返回 null，由适配器换下一种参数继续试，最后才降级到通用 HTTP。
 */

export const ATS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export interface AtsCall {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  /** JSON 请求体（与 form 二选一） */
  json?: unknown
  /** application/x-www-form-urlencoded 请求体（北森 Wecruit 用） */
  form?: Record<string, string | number | boolean>
}

/** 单次尝试：网络/HTTP/JSON 任一环节失败都返回 null，交给调用方换参数重试 */
export async function atsCall<T>(ctx: JdFetchContext, call: AtsCall): Promise<T | null> {
  const request = ctx.request ?? fetch
  const timeoutMs = ctx.timeoutMs ?? 15_000
  const headers: Record<string, string> = {
    'user-agent': ATS_UA,
    accept: 'application/json, text/plain, */*',
    ...call.headers,
  }
  let body: string | undefined
  if (call.json !== undefined) {
    headers['content-type'] ??= 'application/json'
    body = JSON.stringify(call.json)
  } else if (call.form) {
    headers['content-type'] ??= 'application/x-www-form-urlencoded'
    body = new URLSearchParams(Object.entries(call.form).map(([key, value]) => [key, String(value)])).toString()
  }
  try {
    const response = await request(call.url, {
      method: call.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

/** 快照存岗位正文 HTML 而不是接口 JSON：上游改版后仍能回看当时投的是什么 */
export function snapshotHtml(title: string, bodyHtml: string, note: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(note)}</p>${bodyHtml}</body></html>`
}

export function tooShort(provider: string, length: number): AppError {
  return new AppError('JD_TOO_SHORT', `${provider} 返回的岗位正文只有 ${length} 字，可能已下线或需要登录。`, 422, {
    provider,
    extracted: length,
  })
}

/** 职责与要求两段拼成完整 JD；上游可能给 HTML 片段，也可能给纯文本 */
export function composeJdText(parts: readonly (string | null | undefined)[]): string {
  return sanitizeText(
    parts
      .filter((part): part is string => Boolean(part))
      .map((part) => htmlFragmentToText(part))
      .filter(Boolean)
      .join('\n\n'),
  )
}

export function isTooShort(text: string): boolean {
  return text.length < MIN_TEXT_LENGTH
}

/** 发布时间上游可能给秒、毫秒或 ISO 字符串，统一成 ISO；认不出就留空 */
export function normalizePostedAt(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) || value.startsWith('0001-01-01') ? null : new Date(parsed).toISOString()
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}
