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
 * 北森云（Beisen）适配器，覆盖两套不同的产品，端点与报文完全不一样：
 *
 * 1) iTalent —— `<tenant>.zhiye.com`，以及同样用 GetJobAdPageList 的自建门户
 *    详情 URL：https://<tenant>.zhiye.com/{campus|social|intern}/detail?jobAdId=<id>
 *    POST /api/Jobad/GetJobAdPageList（JSON，PageIndex 从 0 开始），
 *    响应 { Code:200, Data:[{ JobAdId, JobAdName, Duty, Require, LocNames, ... }], Count }
 *    没有按 id 的详情接口，只能翻公开列表按 id 找（最多 3 页 × 50 条）。
 *
 * 2) Wecruit（招聘云）—— `wecruit.hotjob.cn` 或客户自有域
 *    详情 URL：https://<host>/{SU…}/pb/<channel>.html#/postDetail?postId=<id>
 *    POST /wecruit/positionInfo/listPositionDetail/{SU…}?iSaJAx=isAjax&request_locale=zh_CN
 *    Content-Type: application/x-www-form-urlencoded，body: postId=<id>&recruitType=<1|2>
 *    响应 { state:"200", data:{ postName, workContent, serviceCondition, workPlaceStr, ... } }
 *    这是北森里唯一直接给「完整 JD 正文」的接口，其余都要拼职责 + 要求。
 *
 * 端点与字段来自 job-pro 的 iflytek.ts / wecruit.ts / vivo.ts（2026-07 验证），全部匿名。
 */

/** 自建域但跑北森 2022 校招门户的租户：需要显式 PortalId */
const ITALENT_CUSTOM_PORTALS: Record<string, string> = {
  'hr-campus.vivo.com': '903cbcbf-4898-46e1-817c-da522a9752b1',
}

interface BeisenItalentTarget {
  kind: 'italent'
  host: string
  id: string
  /** 依次尝试的 PortalId；标准租户用空串 */
  portalIds: string[]
  applyUrl: string
}

interface BeisenWecruitTarget {
  kind: 'wecruit'
  host: string
  channelId: string
  pagePath: string
  id: string
  applyUrl: string
}

export type BeisenTarget = BeisenItalentTarget | BeisenWecruitTarget

export function parseBeisenItalentUrl(url: URL): BeisenItalentTarget | null {
  const host = url.hostname.toLowerCase()
  const customPortal = ITALENT_CUSTOM_PORTALS[host]
  if (!hostMatches(host, 'zhiye.com') && !customPortal) return null
  if (!/^\/(campus|social|intern)\/detail\/?$/.test(url.pathname)) return null
  const id = url.searchParams.get('jobAdId')
  if (!id) return null
  return {
    kind: 'italent',
    host,
    id,
    portalIds: customPortal ? [customPortal, ''] : [''],
    applyUrl: url.toString(),
  }
}

export function parseBeisenWecruitUrl(url: URL): BeisenWecruitTarget | null {
  const match = /^\/(SU[^/]+)\/pb\/([^/]+)\.html$/i.exec(url.pathname)
  if (!match?.[1] || !match[2]) return null
  const hash = url.hash.replace(/^#/, '')
  const queryIndex = hash.indexOf('?')
  const id =
    (queryIndex >= 0 ? new URLSearchParams(hash.slice(queryIndex + 1)).get('postId') : null) ??
    url.searchParams.get('postId')
  if (!id) return null
  return {
    kind: 'wecruit',
    host: url.hostname.toLowerCase(),
    channelId: match[1],
    pagePath: match[2],
    id,
    applyUrl: url.toString(),
  }
}

interface BeisenJobAd {
  JobAdId?: string | number
  Id?: string | number
  JobAdName?: string
  Duty?: string
  Require?: string
  LocNames?: string[]
  Org?: string
  PostDate?: string
}

interface BeisenEnvelope {
  Code?: number
  Message?: string
  Data?: BeisenJobAd[]
  Count?: number
  Total?: number
}

interface WecruitDetail {
  postId?: string
  postName?: string
  workContent?: string
  serviceCondition?: string
  workPlaceStr?: string
  orgName?: string
  department?: string
  publishDate?: string
}

interface WecruitEnvelope {
  state?: string
  msg?: string
  data?: WecruitDetail | null
}

async function fetchItalent(ctx: JdFetchContext, target: BeisenItalentTarget): Promise<BeisenJobAd | null> {
  for (const portalId of target.portalIds) {
    for (let page = 0; page < 3; page += 1) {
      const payload = await atsCall<BeisenEnvelope>(ctx, {
        url: `https://${target.host}/api/Jobad/GetJobAdPageList`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'xmlhttprequest',
          langtype: 'zh_CN',
          origin: `https://${target.host}`,
          referer: `https://${target.host}/jobs`,
        },
        json: {
          PageIndex: page,
          PageSize: 50,
          KeyWords: '',
          SpecialType: 0,
          PortalId: portalId,
          DisplayFields: ['Category', 'Kind', 'LocId', 'Org', 'HeadCount', 'PostDate', 'Salary', 'Duty', 'Require'],
        },
      })
      if (!payload || payload.Code !== 200) break
      const rows = payload.Data ?? []
      const hit = rows.find((row) => String(row.JobAdId ?? row.Id ?? '') === target.id)
      if (hit) return hit
      if (rows.length < 50) break
    }
  }
  return null
}

async function fetchWecruit(ctx: JdFetchContext, target: BeisenWecruitTarget): Promise<WecruitDetail | null> {
  // social 页用 recruitType=2，其它（school/interns）用 1；上游按租户全局找岗位，
  // 两个类型都试一遍即可覆盖链接里的 channel 与实际岗位不一致的情况。
  const recruitTypes = /social/i.test(target.pagePath) ? [2, 1] : [1, 2]
  for (const recruitType of recruitTypes) {
    const payload = await atsCall<WecruitEnvelope>(ctx, {
      url: `https://${target.host}/wecruit/positionInfo/listPositionDetail/${encodeURIComponent(target.channelId)}` +
        `?iSaJAx=isAjax&request_locale=zh_CN&t=${Date.now()}`,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-requested-with': 'XMLHttpRequest',
        'accept-language': 'zh-CN,zh;q=0.9',
        origin: `https://${target.host}`,
        referer: `https://${target.host}/${target.channelId}/pb/posDetail.html`,
      },
      form: { postId: target.id, recruitType },
    })
    if (payload?.state === '200' && payload.data) return payload.data
  }
  return null
}

function buildResult(
  target: BeisenTarget,
  title: string | null,
  description: string,
  requirement: string,
  structured: JdStructured,
): JdFetchResult {
  const text = composeJdText([description, requirement])
  if (isTooShort(text)) throw tooShort('北森云', text.length)
  const note = target.kind === 'italent' ? '北森 iTalent' : '北森 Wecruit'
  return {
    title,
    text,
    html: snapshotHtml(
      title ?? '岗位详情',
      `<h2>主要职责</h2>${description}<h2>任职要求</h2>${requirement}`,
      `${note} / ${target.host} / ${target.id}`,
    ),
    finalUrl: target.applyUrl,
    provider: 'beisen',
    structured,
    warnings: [`${note} 公开接口`],
  }
}

export const beisenProvider: JdProvider = {
  id: 'beisen',
  match: (url) => Boolean(parseBeisenItalentUrl(url) || parseBeisenWecruitUrl(url)),
  async fetch(url: URL, ctx: JdFetchContext): Promise<JdFetchResult> {
    const target = parseBeisenItalentUrl(url) ?? parseBeisenWecruitUrl(url)
    if (!target) throw new AppError('JD_ATS_FAILED', '北森链接里找不到岗位编号', 400)

    if (target.kind === 'italent') {
      const job = await fetchItalent(ctx, target)
      if (!job) {
        throw new AppError('JD_ATS_FAILED', '北森 iTalent 公开列表里找不到这个岗位（可能已下线）', 502, {
          provider: 'beisen',
          family: 'italent',
        })
      }
      return buildResult(target, job.JobAdName?.trim() || null, job.Duty ?? '', job.Require ?? '', {
        title: job.JobAdName?.trim() || null,
        company: job.Org ?? null,
        city: job.LocNames?.[0] ?? null,
        postedAt: normalizePostedAt(job.PostDate),
        applyUrl: target.applyUrl,
      })
    }

    const detail = await fetchWecruit(ctx, target)
    if (!detail) {
      throw new AppError('JD_ATS_FAILED', '北森 Wecruit 没返回这个岗位（state 1017 通常表示已关闭）', 502, {
        provider: 'beisen',
        family: 'wecruit',
      })
    }
    return buildResult(
      target,
      detail.postName?.trim() || null,
      detail.workContent ?? '',
      detail.serviceCondition ?? '',
      {
        title: detail.postName?.trim() || null,
        company: detail.orgName ?? detail.department ?? null,
        city: detail.workPlaceStr ?? null,
        postedAt: normalizePostedAt(detail.publishDate),
        applyUrl: target.applyUrl,
      },
    )
  },
}
