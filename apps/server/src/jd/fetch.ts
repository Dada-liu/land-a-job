import { AppError } from '../errors.js'
import { MIN_TEXT_LENGTH, htmlToReadableText, normalizeWhitespace, sanitizeText } from './html.js'
import { robotsAllowsPath } from './robots.js'
import { classifyUrl, pasteHint } from './sources.js'
import type { JdFetchContext, JdFetchResult, JdProvider } from './types.js'

/**
 * 通用 HTTP 抓取（保底 provider）。
 *
 * 仍然不启浏览器：抓 JD 是「读一段公开文本」，为它拉一个 Chromium 会让首次抓取
 * 慢 3–5 秒，而强 JS 渲染的站点靠浏览器也常常只拿到登录墙。真正需要登录的站点
 * 由用户粘贴正文（与 ai-job-search-cn 的降级路径一致）。
 *
 * 新增的是 403 升级链：403 常常是 WAF 拒绝了客户端而不是页面不存在。
 * 换浏览器请求头重试之前必须先看 robots.txt；站点明确 Disallow 就不重试。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const BASE_HEADERS: Record<string, string> = {
  'user-agent': UA,
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

const BROWSER_HEADERS: Record<string, string> = {
  ...BASE_HEADERS,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
}

const MAX_HTML_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15_000

type RequestFn = typeof globalThis.fetch

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function tryFetch(
  url: URL,
  headers: Record<string, string>,
  timeoutMs: number,
  request: RequestFn,
  hint: string,
): Promise<Response> {
  try {
    return await request(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new AppError('JD_FETCH_FAILED', `抓取失败：${messageOf(error)}。${hint}`, 502, {
      provider: 'http',
      hint,
    })
  }
}

/** robots.txt 读不到或策略不允许 → 一律不重试（fail closed） */
async function mayRetryWithBrowserHeaders(url: URL, timeoutMs: number, request: RequestFn): Promise<boolean> {
  try {
    const robotsUrl = new URL('/robots.txt', url.origin)
    const response = await request(robotsUrl, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
    })
    // 策略文件本身常被 WAF 一起挡掉，所以这里直接用浏览器请求头读；
    // 404 表示站点没有发布策略，视为允许；其他失败都不确认权限。
    if (response.status === 404) return true
    if (!response.ok) return false
    return robotsAllowsPath(await response.text(), `${url.pathname}${url.search}`)
  } catch {
    return false
  }
}

export const httpProvider: JdProvider = {
  id: 'http',
  match: () => true,
  async fetch(url: URL, ctx: JdFetchContext): Promise<JdFetchResult> {
    const request = ctx.request ?? fetch
    const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const source = ctx.source ?? classifyUrl(url)
    const hint = pasteHint(source)

    let response = await tryFetch(url, BASE_HEADERS, timeoutMs, request, hint)
    const warnings: string[] = []

    if (response.status === 403 && (await mayRetryWithBrowserHeaders(url, timeoutMs, request))) {
      // 先把 403 的响应体消费掉，避免底层连接悬着
      await response.arrayBuffer().catch(() => undefined)
      response = await tryFetch(url, BROWSER_HEADERS, timeoutMs, request, hint)
      warnings.push('站点首次返回 403，按 robots.txt 许可改用浏览器请求头重试成功。')
    }

    if (!response.ok) {
      throw new AppError('JD_FETCH_FAILED', `抓取失败：HTTP ${response.status}。${hint}`, 502, {
        provider: 'http',
        source: source.kind,
        hint,
      })
    }

    let html: string
    try {
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength > MAX_HTML_BYTES) {
        throw new AppError('JD_TOO_LARGE', `页面超过 4MB，多半不是招聘详情页。${hint}`, 413, {
          provider: 'http',
          hint,
        })
      }
      html = buffer.toString('utf8')
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError('JD_FETCH_FAILED', `读取页面失败：${messageOf(error)}。${hint}`, 502, { hint })
    }

    const readable = await htmlToReadableText(html, url.toString())
    // htmlToReadableText 已做过 sanitize，这里再过一遍以防兜底路径漏掉
    const text = sanitizeText(normalizeWhitespace(readable.text))
    if (text.length < MIN_TEXT_LENGTH) {
      throw new AppError(
        'JD_TOO_SHORT',
        `正文只提取到 ${text.length} 字，可能是登录页、JS 渲染页或列表页。${hint}`,
        422,
        { provider: 'http', source: source.kind, extracted: text.length, hint },
      )
    }

    // ai-job-search-cn：抓到的内容与期待的岗位对不上，说明这是列表页而不是 JD
    const expected = ctx.expectedTitle?.trim().toLowerCase()
    if (expected && expected.length >= 2) {
      const haystack = `${readable.title ?? ''}\n${text.slice(0, 4_000)}`.toLowerCase()
      if (!haystack.includes(expected)) {
        warnings.push(`抓到的内容里找不到岗位「${ctx.expectedTitle}」，可能是列表页或登录页，请核对链接。`)
      }
    }

    return {
      title: readable.title,
      text,
      html,
      finalUrl: response.url || url.toString(),
      provider: 'http',
      structured: readable.structured,
      warnings,
    }
  },
}
