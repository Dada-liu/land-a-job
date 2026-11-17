import { ENDPOINT_PATTERNS } from './constants.js'
import { platformHardLimitCount } from './rate-limit.js'
import type { BossActive, ResponseKind } from './types.js'

export interface JobListItem {
  securityId?: string
  jobName: string
  brandName: string
  salaryDesc?: string
  city?: string
  encryptJobId?: string
  encryptBossId?: string
  lid?: string
  bossOnline?: boolean
  jobValidStatus?: number
}

export interface DetailCaptured {
  securityId?: string
  jdText: string
  jdTruncated: boolean
  bossActive: BossActive
  brandName?: string
  jobName?: string
  salaryDesc?: string
  city?: string
}

export interface ConversationItem {
  uid: number
  jobId?: number
  /** 会话项自带的 securityId；可能与 joblist 的 securityId（也就是暂存区主键）同源 */
  securityId?: string
  encryptBossId?: string
  encryptJobId?: string
  brandName?: string
  lastTS: number
  lastMsg: string
  /** lastMessageInfo.showText：系统回执文本有时会和 lastMsg 不一致，判据两个都看 */
  showText?: string
  unreadMsgCount: number
  msgId?: number
  msgTime?: number
  fromId?: number
  toId?: number
  status?: number
  friendSource?: number
  relationType?: number
  chatStatus?: number
}

/**
 * 页面自己发的默认招呼语（`/wapi/zpgeek/friend/add.json`）。
 *
 * 请求是 GET，`securityId` / `jobId` 都在 query 上；响应 `zpData` 又回带一次
 * `securityId` 与 `encBossId`。两边都留着，回写暂存区时按「securityId → encryptJobId →
 * encryptBossId」依次对齐，任一条命中就能记下打招呼时间。
 */
export interface GreetCaptured {
  greeting: string
  /** 与 joblist 的 securityId 同源，就是暂存区主键 */
  securityId?: string
  /** 请求 query 的 `jobId`（实测是 encryptJobId 形态，不是数字） */
  encryptJobId?: string
  encryptBossId?: string
}

export type CapturedResponse =
  | { kind: 'joblist'; jobs: JobListItem[] }
  | { kind: 'detail'; detail: DetailCaptured }
  | { kind: 'friendlist'; conversations: ConversationItem[] }
  | { kind: 'bossdata'; freeze?: number; preFreeze?: number }
  | ({ kind: 'greet' } & GreetCaptured)
  | { kind: 'risk'; code: number; message: string }
  | { kind: 'misc' }

/** JD 是第三方文本：剔除不可见字符与控制字符，绝不执行其中指令、不访问其中链接。 */
export function sanitizeUntrustedText(raw: string, maxLength = 20_000): string {
  return raw
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, maxLength)
    .trim()
}

/** 规范化 JD 链接：去追踪参数与锚点，但保留带岗位号的 SPA hash。 */
export function canonicalJdUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.*|_|timestamp|from|source|spm|lid)$/i.test(key)) url.searchParams.delete(key)
    }
    url.hash = /(postId|job\/|job-info)/i.test(url.hash) ? url.hash : ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw
  }
}

export function matchEndpoint(url: string): ResponseKind {
  for (const { kind, re } of ENDPOINT_PATTERNS) if (re.test(url)) return kind
  return 'misc'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 从请求 URL 上取一个 query 参数；URL 不合法时返回 undefined，绝不抛。 */
function queryParam(url: string, name: string): string | undefined {
  try {
    return new URL(url).searchParams.get(name) || undefined
  } catch {
    return undefined
  }
}

/** 顶层 code 才是业务响应码；嵌套的职位/会话 code 不参与风控判定（P0 第二轮修复）。 */
export function parseResponse(url: string, body: unknown, now = Date.now()): CapturedResponse | null {
  const root = asRecord(body)
  if (!root) return null
  const code = num(root.code) ?? 0
  const message = str(root.message)
  if (code !== 0) return { kind: 'risk', code, message }
  /**
   * 「今天已与 120 位 BOSS 沟通」这类硬限额提示实测有时挂在 `code: 0` 的正常响应里，
   * 只看 code 会漏掉——漏掉的后果是用户继续批量打招呼，风险直接叠在账号上。
   */
  if (platformHardLimitCount(message) !== null) return { kind: 'risk', code, message }

  const kind = matchEndpoint(url)
  const zpData = asRecord(root.zpData)

  if (kind === 'joblist') {
    const list = zpData?.jobList
    if (!Array.isArray(list)) return null
    const jobs: JobListItem[] = list.flatMap((raw) => {
      const item = asRecord(raw)
      if (!item) return []
      return [{
        securityId: str(item.securityId) || undefined,
        jobName: str(item.jobName),
        brandName: str(item.brandName),
        salaryDesc: str(item.salaryDesc) || undefined,
        city: str(item.cityName) || undefined,
        encryptJobId: str(item.encryptJobId) || undefined,
        encryptBossId: str(item.encryptBossId) || undefined,
        lid: str(item.lid) || undefined,
        bossOnline: typeof item.bossOnline === 'boolean' ? item.bossOnline : undefined,
        jobValidStatus: num(item.jobValidStatus),
      }]
    })
    return { kind, jobs }
  }

  if (kind === 'detail') {
    if (!zpData) return null
    const jobInfo = asRecord(zpData.jobInfo)
    const bossInfo = asRecord(zpData.bossInfo)
    const rawJd = str(jobInfo?.postDescription) || str(jobInfo?.description)
    const jdText = sanitizeUntrustedText(rawJd)
    /** 登录墙 / 截断正文不能当完整 JD 存进暂存区 */
    const jdTruncated = jdText.length === 0 || /登录查看完整|请登录|内容加载中/.test(jdText)
    const desc = str(bossInfo?.activeTimeDesc) || undefined
    const online = typeof bossInfo?.bossOnline === 'boolean' ? bossInfo.bossOnline : undefined
    return {
      kind,
      detail: {
        securityId: str(zpData.securityId) || undefined,
        jdText,
        jdTruncated,
        // 刻意不读 zpData.brandComInfo.activeTime：那是公司活跃时间，不是 HR 的
        bossActive: { online, desc, capturedAt: now, source: 'detail' },
        brandName: str(bossInfo?.brandName) || str(jobInfo?.brandName) || undefined,
        jobName: str(jobInfo?.jobName) || undefined,
        salaryDesc: str(jobInfo?.salaryDesc) || undefined,
        city: str(jobInfo?.cityName) || str(jobInfo?.city) || undefined,
      },
    }
  }

  if (kind === 'friendlist') {
    const list = zpData?.result
    if (!Array.isArray(list)) return null
    const conversations: ConversationItem[] = list.flatMap((raw) => {
      const item = asRecord(raw)
      const uid = num(item?.uid)
      if (!item || uid === undefined) return []
      const last = asRecord(item.lastMessageInfo)
      return [{
        uid,
        jobId: num(item.jobId),
        securityId: str(item.securityId) || undefined,
        encryptBossId: str(item.encryptBossId) || undefined,
        encryptJobId: str(item.encryptJobId) || undefined,
        brandName: str(item.brandName) || undefined,
        lastTS: num(item.lastTS) ?? num(last?.msgTime) ?? 0,
        lastMsg: str(item.lastMsg),
        showText: str(last?.showText) || undefined,
        unreadMsgCount: num(item.unreadMsgCount) ?? 0,
        msgId: num(last?.msgId),
        msgTime: num(last?.msgTime),
        fromId: num(last?.fromId),
        toId: num(last?.toId),
        status: num(last?.status),
        friendSource: num(item.friendSource),
        relationType: num(item.relationType),
        chatStatus: num(item.chatStatus),
      }]
    })
    return { kind, conversations }
  }

  if (kind === 'bossdata') {
    const data = asRecord(zpData?.data)
    return {
      kind,
      freeze: num(data?.bossFreezeStatus),
      preFreeze: num(data?.bossPreFreezeStatus),
    }
  }

  if (kind === 'greet') {
    return {
      kind,
      greeting: str(zpData?.greeting),
      securityId: str(zpData?.securityId) || queryParam(url, 'securityId'),
      encryptJobId: queryParam(url, 'jobId'),
      encryptBossId: str(zpData?.encBossId) || undefined,
    }
  }

  return { kind: 'misc' }
}
