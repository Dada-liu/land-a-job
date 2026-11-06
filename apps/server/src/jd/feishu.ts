import { AppError } from '../errors.js'
import {
  atsCall,
  composeJdText,
  isTooShort,
  normalizePostedAt,
  snapshotHtml,
  tooShort,
} from './ats-common.js'
import { hostMatches } from './sources.js'
import type { JdFetchContext, JdFetchResult, JdProvider, JdStructured } from './types.js'

/**
 * 飞书招聘（Feishu Recruiting / ATSX）适配器。
 *
 * 端点形态来自 job-pro 的 feishu.ts / xpeng.ts（2026-05~07 验证）：
 *   GET  https://<host>/api/v1/job/posts/<id>?portal_type=3          （部分租户有）
 *   POST https://<host>/api/v1/search/job/posts                       （全部租户有）
 * 两个端点都要 `portal-channel` / `website-path`，值取自详情页 URL 的路径前缀；
 * 自定义域与小米 fork 反而不能带这两个头，所以按「标准 → 空门户 → 省略头」依次试。
 * 没有按 id 详情接口时，从公开搜索列表里按 id 找（最多两页，每页 100 条）。
 *
 * 全部匿名、无 cookie、无签名；失败由管线降级到通用 HTTP / 粘贴。
 */

const FEISHU_SUFFIXES = ['jobs.feishu.cn', 'jobs.f.mioffice.cn'] as const
/** 自建域但跑飞书招聘的租户（job-pro 注册表里的 source） */
const FEISHU_CUSTOM_HOSTS = new Set(['careers.iqiyi.com', 'hr.sensetime.com'])

export interface FeishuTarget {
  host: string
  /** 门户 channel：campus / index / 379481 / ''（根门户） */
  channel: string
  id: string
}

export function isFeishuHost(host: string): boolean {
  return FEISHU_CUSTOM_HOSTS.has(host) || FEISHU_SUFFIXES.some((suffix) => hostMatches(host, suffix))
}

/** https://<host>/<channel>/position/<id>/detail，channel 可缺省（根门户） */
export function parseFeishuUrl(url: URL): FeishuTarget | null {
  const host = url.hostname.toLowerCase()
  if (!isFeishuHost(host)) return null
  const withChannel = /^\/([^/]+)\/position\/([^/]+)\/detail\/?$/.exec(url.pathname)
  if (withChannel?.[1] && withChannel[2]) {
    return { host, channel: withChannel[1], id: withChannel[2] }
  }
  const root = /^\/position\/([^/]+)\/detail\/?$/.exec(url.pathname)
  if (root?.[1]) return { host, channel: '', id: root[1] }
  return null
}

interface FeishuPost {
  id?: string | number
  title?: string
  sub_title?: string | null
  description?: string
  requirement?: string
  city_info?: { name?: string } | null
  city_list?: { name?: string }[] | null
  recruit_type?: { name?: string } | null
  publish_time?: number
}

interface FeishuSearchData {
  job_post_list?: FeishuPost[]
  count?: number
}

interface FeishuEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

interface FeishuDetailData {
  job_post_detail?: FeishuPost | null
}

interface HeaderVariant {
  channel: string
  headers: Record<string, string>
}

/** 三种门户头写法，覆盖标准子域 / 根门户 / 不带 portal-channel 的 bespoke 租户 */
function headerVariants(host: string, channel: string): HeaderVariant[] {
  const make = (value: string | null): Record<string, string> => {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'portal-platform': 'pc',
      referer: value ? `https://${host}/${value}/position` : `https://${host}/`,
    }
    if (value !== null) {
      headers['portal-channel'] = value
      headers['website-path'] = value
    }
    return headers
  }
  const variants: HeaderVariant[] = [{ channel, headers: make(channel) }]
  if (channel) variants.push({ channel: '', headers: make('') })
  variants.push({ channel, headers: make(null) })
  return variants
}

async function getDetail(
  ctx: JdFetchContext,
  host: string,
  id: string,
  variant: HeaderVariant,
): Promise<FeishuPost | null> {
  const payload = await atsCall<FeishuEnvelope<FeishuDetailData>>(ctx, {
    url: `https://${host}/api/v1/job/posts/${encodeURIComponent(id)}?portal_type=3`,
    method: 'GET',
    headers: variant.headers,
  })
  // code:0 但没有 job_post_detail 是上游干净的「岗位不存在」信号
  if (!payload || payload.code !== 0) return null
  return payload.data?.job_post_detail ?? null
}

async function searchById(
  ctx: JdFetchContext,
  host: string,
  id: string,
  variant: HeaderVariant,
): Promise<{ post: FeishuPost; page: number } | null> {
  for (let page = 0; page < 2; page += 1) {
    const payload = await atsCall<FeishuEnvelope<FeishuSearchData>>(ctx, {
      url: `https://${host}/api/v1/search/job/posts`,
      method: 'POST',
      headers: variant.headers,
      json: {
        keyword: '',
        limit: 100,
        offset: page * 100,
        portal_type: 3,
        portal_entrance: 1,
        language: 'zh',
      },
    })
    if (!payload || payload.code !== 0) return null
    const posts = payload.data?.job_post_list ?? []
    const hit = posts.find((post) => String(post.id ?? '') === id)
    if (hit) return { post: hit, page: page + 1 }
    if (posts.length < 100) return null
  }
  return null
}

function buildResult(target: FeishuTarget, post: FeishuPost, warnings: string[]): JdFetchResult {
  const title = post.title?.trim() || null
  const description = post.description ?? ''
  const requirement = post.requirement ?? ''
  const text = composeJdText([description, requirement])
  if (isTooShort(text)) throw tooShort('飞书招聘', text.length)

  const city = post.city_list?.find((item) => item?.name)?.name ?? post.city_info?.name ?? null
  const applyUrl = `https://${target.host}/${target.channel ? `${target.channel}/` : ''}position/${target.id}/detail`
  const structured: JdStructured = {
    title,
    city: city ?? null,
    postedAt: normalizePostedAt(post.publish_time),
    applyUrl,
  }
  return {
    title,
    text,
    html: snapshotHtml(
      title ?? '岗位详情',
      `<h2>职位描述</h2>${description}<h2>任职要求</h2>${requirement}`,
      `飞书招聘 / ${target.host} / ${target.id}`,
    ),
    finalUrl: applyUrl,
    provider: 'feishu',
    structured,
    warnings,
  }
}

export const feishuProvider: JdProvider = {
  id: 'feishu',
  match: (url) => Boolean(parseFeishuUrl(url)),
  async fetch(url: URL, ctx: JdFetchContext): Promise<JdFetchResult> {
    const target = parseFeishuUrl(url)
    if (!target) throw new AppError('JD_ATS_FAILED', '飞书招聘链接里找不到岗位编号', 400)

    const variants = headerVariants(target.host, target.channel)
    for (const [index, variant] of variants.entries()) {
      const detail = await getDetail(ctx, target.host, target.id, variant)
      if (detail) {
        return buildResult(target, detail, [`飞书招聘门户：${variant.channel || '根门户'}`])
      }
      // 搜索扫页只在首选门户做一次，避免为了一个岗位打十几个请求
      if (index === 0) {
        const swept = await searchById(ctx, target.host, target.id, variant)
        if (swept) {
          return buildResult(target, swept.post, [
            `飞书招聘没有按 id 的公开详情接口，从公开搜索列表第 ${swept.page} 页取到`,
          ])
        }
      }
    }
    throw new AppError(
      'JD_ATS_FAILED',
      '飞书招聘公开接口里找不到这个岗位（可能已下线，或链接里的门户与岗位不属于同一门户）',
      502,
      { provider: 'feishu', host: target.host, id: target.id },
    )
  },
}
