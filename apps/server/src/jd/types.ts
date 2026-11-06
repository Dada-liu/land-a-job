import type { JdSignals } from '@land/core'

/**
 * JD 采集的公共契约。
 *
 * 设计参考两条外部经验：
 * - job-pro：每类站点一个适配器，返回统一的结构化字段，规则解析、无浏览器、无 LLM。
 * - ai-job-search-cn：按「来源」决定先走哪条路，抓不到就明确降级到粘贴，且抓取内容是不可信数据。
 *
 * 这里的 provider 只做「URL → 正文 + 结构化字段」；关键词抽取与 fit 打分仍由 @land/core
 * 的规则完成，采集层不复制一套词表。
 */

export type JdSourceKind = 'ats' | 'official' | 'aggregator' | 'local' | 'unknown' | 'manual' | 'browser'

export interface JdSourceInfo {
  kind: JdSourceKind
  host: string
  /** 命中的站点适配器 id；null 表示只能走通用 HTTP 提取 */
  adapter: string | null
  /** 域名归属是否可确认（公司自有域、官方 ATS、本机 fixture） */
  trusted: boolean
  label: string
}

/** 站点适配器直接给出的字段。通用 HTTP 路径为空，缺失字段交给正文正则补 */
export interface JdStructured {
  title?: string | null
  company?: string | null
  city?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  level?: string | null
  postedAt?: string | null
  applyUrl?: string | null
}

export interface JdFetchResult {
  title: string | null
  text: string
  /** 用于落快照的原始 HTML（ATS 路径是渲染后的正文 HTML） */
  html: string
  finalUrl: string
  provider: string
  structured: JdStructured
  warnings: string[]
}

export interface JdFetchContext {
  timeoutMs?: number
  /** 测试注入；不传用全局 fetch */
  request?: typeof globalThis.fetch
  /** 岗位标题，用来识别「抓到了列表页而不是详情页」 */
  expectedTitle?: string
  source?: JdSourceInfo
}

export interface JdProvider {
  readonly id: string
  match(url: URL, source: JdSourceInfo): boolean
  fetch(url: URL, ctx: JdFetchContext): Promise<JdFetchResult>
}

export interface JdCollection {
  result: JdFetchResult
  source: JdSourceInfo
  canonicalUrl: string
  signals: JdSignals
  warnings: string[]
}
