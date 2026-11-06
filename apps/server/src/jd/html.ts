import { extractJdSignals } from '@land/core'
import type { JdStructured } from './types.js'

/**
 * HTML → 正文 + 结构化字段。
 *
 * 两条路径共用一套清洗：通用网页走 Readability 去导航噪声，站点适配器给回来的
 * 是岗位正文片段，走轻量 tags→换行。清洗里顺手去掉零宽字符与控制字符：JD 是
 * 不可信第三方文本，隐藏在不可见字符里的指令不该原样进入后续的 Skill 上下文。
 *
 * Readability 只保留正文段落，会把「杭州 · 25-40K · 3-5 年」这种岗位元信息整块丢掉。
 * 所以正文之外单独抽一层结构化字段：优先 schema.org JobPosting（JSON-LD），
 * 其次取页头那行带薪资的元信息。这正是 job-pro 用公开 API 拿结构化字段的收益。
 */

/** 正文低于这个长度基本可以断定是登录页/空壳页/脚本占位 */
export const MIN_TEXT_LENGTH = 80
/** 与 packages/core/src/schema/job.ts 的 jdText 上限一致 */
export const MAX_JD_TEXT = 200_000

/** 保留换行结构（JD 条目靠换行区分），只压掉多余空白 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

/** 去掉零宽/双向控制符等不可见字符，保留换行与制表符 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
    .slice(0, MAX_JD_TEXT)
}

export interface ReadablePage {
  text: string
  title: string | null
  structured: JdStructured
}

/** 找 schema.org JobPosting；站点常把 JSON-LD 塞在 @graph 里或写成数组 */
function findJobPosting(document: Document): Record<string, unknown> | null {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? '')
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      const expanded = list.flatMap((item) => {
        if (item && typeof item === 'object' && '@graph' in item) {
          const graph = (item as Record<string, unknown>)['@graph']
          return Array.isArray(graph) ? [item, ...graph] : [item]
        }
        return [item]
      })
      const hit = expanded.find((item) => {
        if (!item || typeof item !== 'object') return false
        const type = (item as Record<string, unknown>)['@type']
        return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))
      })
      if (hit && typeof hit === 'object') return hit as Record<string, unknown>
    } catch {
      // 坏掉的 JSON-LD 很常见，跳过即可
    }
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function structuredFromPage(document: Document): JdStructured {
  const job = findJobPosting(document)
  const bodyText = sanitizeText(normalizeWhitespace(document.body?.textContent ?? ''))

  // 元信息几乎总在页头，且常带着薪资区间；只在这一行里找城市，避免把导航里的
  // 「北京 上海 深圳 职位」误当成岗位地点。
  const headLines = bodyText.split('\n').slice(0, 15)
  const metaLine = headLines.find((line) => /\d{1,3}\s*[-~至到]\s*\d{1,3}\s*[kK千万]/.test(line)) ?? ''
  const metaSignals = extractJdSignals(metaLine, '')

  let city: string | null = metaSignals.cities[0] ?? null
  let salary: { min: number | null; max: number | null } | null = metaSignals.salary
  let company: string | null = null
  let title: string | null = null
  let postedAt: string | null = null

  if (job) {
    title = asString(job.title)
    postedAt = asString(job.datePosted)
    const org = job.hiringOrganization
    if (org && typeof org === 'object') company = asString((org as Record<string, unknown>).name)

    const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation]
    for (const location of locations) {
      if (!location || typeof location !== 'object') continue
      const address = (location as Record<string, unknown>).address
      if (!address || typeof address !== 'object') continue
      const locality = asString((address as Record<string, unknown>).addressLocality)
      if (locality) {
        city = locality
        break
      }
    }

    const base = job.baseSalary
    if (base && typeof base === 'object') {
      const value = (base as Record<string, unknown>).value
      const unit = asString((base as Record<string, unknown>).unitText)?.toUpperCase() ?? ''
      if (value && typeof value === 'object') {
        const raw = value as Record<string, unknown>
        const toMonthly = (input: unknown): number | null => {
          if (typeof input !== 'number' || !Number.isFinite(input)) return null
          // 没写单位又小于 1000 的多半是「25K」而不是「25000 元」，宁可不猜
          if (!unit && input < 1000) return null
          return Math.round(unit === 'YEAR' ? input / 12 : input)
        }
        const min = toMonthly(raw.minValue ?? raw.value)
        const max = toMonthly(raw.maxValue)
        if (min !== null || max !== null) salary = { min, max }
      }
    }
  }

  return {
    title,
    company,
    city,
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    postedAt,
  }
}

/**
 * jsdom + Readability 约 3MB，动态 import：
 * 大多数请求走不到这里（有站点适配器），更不该为它拖慢服务启动。
 */
export async function htmlToReadableText(html: string, url: string): Promise<ReadablePage> {
  const [{ JSDOM }, { Readability }] = await Promise.all([import('jsdom'), import('@mozilla/readability')])
  const dom = new JSDOM(html, { url })
  const document = dom.window.document
  const pageTitle = document.title?.trim() || null
  const structured = structuredFromPage(document)

  try {
    const article = new Readability(document).parse()
    const text = sanitizeText(normalizeWhitespace(article?.textContent ?? ''))
    if (text.length >= MIN_TEXT_LENGTH) {
      return { text, title: article?.title?.trim() || pageTitle, structured }
    }
  } catch {
    // Readability 在极端 DOM 上会抛错，落到下面的兜底路径
  }

  const fallback = sanitizeText(normalizeWhitespace(document.body?.textContent ?? ''))
  return { text: fallback, title: pageTitle, structured }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : full
    }
    return ENTITIES[lower] ?? full
  })
}

/** ATS 返回的是岗位正文 HTML 片段：<p>/<li> 要变成换行，否则职责全粘成一行 */
export function htmlFragmentToText(fragment: string): string {
  const withoutScripts = fragment.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  const withBreaks = withoutScripts
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|li|h[1-6]|section|tr|ul|ol|table)\s*>/gi, '\n')
  return sanitizeText(normalizeWhitespace(decodeEntities(withBreaks.replace(/<[^>]+>/g, ' '))))
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      default: return '&#39;'
    }
  })
}
