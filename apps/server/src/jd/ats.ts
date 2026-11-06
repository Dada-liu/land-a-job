import { AppError } from '../errors.js'
import { MIN_TEXT_LENGTH, htmlFragmentToText, sanitizeText } from './html.js'
import { ATS_UA, snapshotHtml, tooShort } from './ats-common.js'
import { beisenProvider } from './beisen.js'
import { feishuProvider } from './feishu.js'
import { hostMatches } from './sources.js'
import type { JdFetchContext, JdFetchResult, JdProvider, JdStructured } from './types.js'

/**
 * 站点适配器：Greenhouse / Lever 的公开职位接口。
 *
 * 思路来自 job-pro：与其对着渲染后的招聘页做正则，不如直接读公司自己的公开 JSON 接口，
 * 字段稳定、无需登录、无浏览器。这里只实现两家通用 SaaS ATS 家族（同样的套路可以按需
 * 扩到 Moka / Workday），每家都遵守同一个 JdProvider 契约，失败就由管线降级到通用 HTTP。
 *
 * 端点（匿名 GET，job-pro 已验证过 shape）：
 *   https://boards-api.greenhouse.io/v1/boards/<slug>/jobs/<id>?content=true
 *   https://api.lever.co/v0/postings/<slug>/<id>?mode=json
 */

interface Target {
  slug: string
  id: string
}

interface GreenhouseJob {
  id?: number | string
  title?: string
  absolute_url?: string
  content?: string
  location?: { name?: string }
  company_name?: string
  updated_at?: string
  requisition_id?: string
}

interface LeverJob {
  id?: string
  text?: string
  hostedUrl?: string
  applyUrl?: string
  description?: string
  descriptionPlain?: string
  additional?: string
  additionalPlain?: string
  lists?: { text?: string; content?: string }[]
  categories?: { location?: string; commitment?: string; team?: string; department?: string }
  createdAt?: number
}

export function parseGreenhouseUrl(url: URL): Target | null {
  const host = url.hostname.toLowerCase()
  if (!hostMatches(host, 'greenhouse.io')) return null
  const api = /^\/v1\/boards\/([^/]+)\/jobs\/(\d+)/.exec(url.pathname)
  if (api?.[1] && api[2]) return { slug: api[1], id: api[2] }
  if (!/^(boards|job-boards|boards-api)\./.test(host)) return null
  const board = /^\/([^/]+)\/jobs\/(\d+)/.exec(url.pathname)
  if (board?.[1] && board[2]) return { slug: board[1], id: board[2] }
  return null
}

export function parseLeverUrl(url: URL): Target | null {
  if (!hostMatches(url.hostname.toLowerCase(), 'lever.co')) return null
  const api = /^\/v0\/postings\/([^/]+)\/([^/]+)/.exec(url.pathname)
  if (api?.[1] && api[2]) return { slug: api[1], id: api[2] }
  const board = /^\/([^/]+)\/([0-9a-z][^/]{6,})/i.exec(url.pathname)
  if (board?.[1] && board[2]) return { slug: board[1], id: board[2] }
  return null
}

async function fetchJson<T>(endpoint: string, ctx: JdFetchContext, provider: string): Promise<T> {
  const request = ctx.request ?? fetch
  const timeoutMs = ctx.timeoutMs ?? 15_000
  try {
    const response = await request(endpoint, {
      headers: { 'user-agent': ATS_UA, accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new AppError('JD_ATS_FAILED', `${provider} 接口返回 HTTP ${response.status}`, 502, { provider, endpoint })
    }
    return (await response.json()) as T
  } catch (error) {
    if (error instanceof AppError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new AppError('JD_ATS_FAILED', `${provider} 接口读取失败：${reason}`, 502, { provider, endpoint })
  }
}

export const greenhouseProvider: JdProvider = {
  id: 'greenhouse',
  match: (url) => Boolean(parseGreenhouseUrl(url)),
  async fetch(url: URL, ctx: JdFetchContext): Promise<JdFetchResult> {
    const target = parseGreenhouseUrl(url)
    if (!target) throw new AppError('JD_ATS_FAILED', 'Greenhouse 链接里找不到岗位编号', 400)
    const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.slug)}/jobs/${encodeURIComponent(target.id)}?content=true`
    const job = await fetchJson<GreenhouseJob>(endpoint, ctx, 'Greenhouse')

    const bodyHtml = job.content ?? ''
    const text = htmlFragmentToText(bodyHtml)
    if (text.length < MIN_TEXT_LENGTH) throw tooShort('Greenhouse', text.length)

    const structured: JdStructured = {
      title: job.title ?? null,
      company: job.company_name ?? null,
      city: job.location?.name ?? null,
      postedAt: job.updated_at ?? null,
      applyUrl: job.absolute_url ?? url.toString(),
    }
    return {
      title: job.title ?? null,
      text,
      html: snapshotHtml(job.title ?? '岗位详情', bodyHtml, `Greenhouse / ${target.slug} / ${target.id}`),
      finalUrl: job.absolute_url ?? url.toString(),
      provider: 'greenhouse',
      structured,
      warnings: job.requisition_id ? [`岗位编号 ${job.requisition_id}（来自公司官方 ATS）`] : [],
    }
  },
}

export const leverProvider: JdProvider = {
  id: 'lever',
  match: (url) => Boolean(parseLeverUrl(url)),
  async fetch(url: URL, ctx: JdFetchContext): Promise<JdFetchResult> {
    const target = parseLeverUrl(url)
    if (!target) throw new AppError('JD_ATS_FAILED', 'Lever 链接里找不到岗位编号', 400)
    const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(target.slug)}/${encodeURIComponent(target.id)}?mode=json`
    const job = await fetchJson<LeverJob>(endpoint, ctx, 'Lever')

    const descriptionHtml = job.description ?? ''
    const additionalHtml = job.additional ?? ''
    const sections: string[] = [job.descriptionPlain?.trim() || htmlFragmentToText(descriptionHtml)]
    for (const list of job.lists ?? []) {
      const heading = list.text?.trim() ?? ''
      const content = list.content ? htmlFragmentToText(list.content) : ''
      if (heading || content) sections.push([heading, content].filter(Boolean).join('\n'))
    }
    sections.push(job.additionalPlain?.trim() || htmlFragmentToText(additionalHtml))
    const text = sanitizeText(sections.filter(Boolean).join('\n\n').trim())
    if (text.length < MIN_TEXT_LENGTH) throw tooShort('Lever', text.length)

    const structured: JdStructured = {
      title: job.text ?? null,
      city: job.categories?.location ?? null,
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      applyUrl: job.hostedUrl ?? job.applyUrl ?? url.toString(),
    }
    return {
      title: job.text ?? null,
      text,
      html: snapshotHtml(
        job.text ?? '岗位详情',
        `${descriptionHtml}\n${additionalHtml}`,
        `Lever / ${target.slug} / ${target.id}`,
      ),
      finalUrl: job.hostedUrl ?? job.applyUrl ?? url.toString(),
      provider: 'lever',
      structured,
      warnings: [],
    }
  },
}

/** 顺序即优先级；四家 ATS 之后还有通用 HTTP 兜底 */
export const ATS_PROVIDERS: readonly JdProvider[] = [
  greenhouseProvider,
  leverProvider,
  feishuProvider,
  beisenProvider,
]
