import { extractJdSignals } from '@land/core'
import { AppError } from '../errors.js'
import { ATS_PROVIDERS } from './ats.js'
import { httpProvider } from './fetch.js'
import { canonicalJdUrl, classifyUrl, pasteHint, sourceWarnings } from './sources.js'
import type { JdCollection, JdFetchContext, JdProvider } from './types.js'

/**
 * 采集编排：来源分类 → 站点适配器 → 通用 HTTP → 明确的粘贴降级。
 *
 * 与 ai-job-search-cn 的升级链对齐，只是把其中的 WebFetch/WebSearch 两步换成
 * 服务端能自己做的事：官方 ATS 接口、带 robots 守卫的 HTTP 重试、以及把
 * 「去官网找同岗位 / 直接粘贴」写进错误详情交给 Agent 去执行（应用不联网搜、不调模型）。
 */

/** 顺序即优先级；通用 HTTP 永远是最后一条 */
const PROVIDERS: readonly JdProvider[] = [...ATS_PROVIDERS, httpProvider]

/** 平台站大概率拿不到正文，别让用户为一个注定失败的等待耗 15 秒 */
const AGGREGATOR_TIMEOUT_MS = 8_000

export interface CollectOptions extends JdFetchContext {
  /** 公司官网/投递入口，用来确认「这是公司自有域名」 */
  officialHosts?: readonly string[]
}

interface Attempt {
  provider: string
  code: string
  message: string
  statusCode: number
}

function describe(error: unknown, provider: string): Attempt {
  if (error instanceof AppError) {
    return { provider, code: error.code, message: error.message, statusCode: error.statusCode }
  }
  return {
    provider,
    code: 'JD_FETCH_FAILED',
    message: error instanceof Error ? error.message : String(error),
    statusCode: 502,
  }
}

export async function collectJd(rawUrl: string, options: CollectOptions = {}): Promise<JdCollection> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new AppError('JD_URL_INVALID', `链接无法解析：${rawUrl}`, 400)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('JD_URL_INVALID', 'JD 链接只能是 http(s)', 400)
  }

  const source = classifyUrl(url, options.officialHosts ?? [])
  const canonicalUrl = canonicalJdUrl(url)
  const warnings = sourceWarnings(source, url)
  const ctx: JdFetchContext = {
    timeoutMs: options.timeoutMs ?? (source.kind === 'aggregator' ? AGGREGATOR_TIMEOUT_MS : undefined),
    request: options.request,
    expectedTitle: options.expectedTitle,
    source,
  }

  const attempts: Attempt[] = []
  for (const provider of PROVIDERS) {
    if (!provider.match(url, source)) continue
    try {
      const result = await provider.fetch(url, ctx)
      const signals = extractJdSignals(result.text, result.structured.title ?? result.title ?? '')
      // 适配器给的字段比正文正则更可信，补进 signals 让打分与详情页都能用
      const structuredCity = result.structured.city?.trim()
      if (structuredCity && !signals.cities.includes(structuredCity)) {
        signals.cities = [structuredCity, ...signals.cities]
      }
      if (!signals.salary && (result.structured.salaryMin != null || result.structured.salaryMax != null)) {
        signals.salary = { min: result.structured.salaryMin ?? null, max: result.structured.salaryMax ?? null }
      }
      return {
        result,
        source,
        canonicalUrl,
        signals,
        warnings: [...warnings, ...result.warnings],
      }
    } catch (error) {
      attempts.push(describe(error, provider.id))
    }
  }

  const last = attempts.at(-1)
  const hint = pasteHint(source)
  const base = last?.message ?? '没有任何可用的采集方式'
  const tried = attempts.length > 1 ? `（已依次尝试：${attempts.map((item) => item.provider).join(' → ')}）` : ''
  throw new AppError(
    last?.code ?? 'JD_FETCH_FAILED',
    base.includes(hint) ? `${base}${tried}` : `${base}${tried} ${hint}`,
    last?.statusCode ?? 502,
    { source, canonicalUrl, attempts, hint },
  )
}
