/**
 * 翻译内核。刻意与 React 解耦：DOM 兜底层和 `useT()` 共用这里，
 * 不会出现「组件里一套译文、运行时一套译文」的漂移。
 */
import { EN } from './en'

export type Locale = 'zh' | 'en'
export type Dict = Record<string, string>

export const LOCALES: readonly Locale[] = ['zh', 'en']
export const LOCALE_NAMES: Record<Locale, string> = { zh: '中文', en: 'English' }
export const LOCALE_TAGS: Record<Locale, string> = { zh: 'zh-CN', en: 'en-US' }

export const STORAGE_KEY = 'land.locale'

/** 中日韩统一表意文字；没有 CJK 的字符串直接跳过，省掉整轮匹配 */
export const CJK = /[\u3400-\u9fff]/

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en'
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key]
    return value === undefined ? whole : String(value)
  })
}

/**
 * 显式调用：`t('停滞 {days} 天', { days: 3 })`。
 * 中文模式下也要跑插值——模板串本身就是带 `{}` 的，不插值会漏出占位符。
 */
export function translate(locale: Locale, zh: string, params?: Record<string, string | number>): string {
  if (locale === 'zh') return interpolate(zh, params)
  return interpolate(EN[zh] ?? zh, params)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface CompiledPattern {
  re: RegExp
  names: string[]
  value: string
  /** 原文越长越具体，优先匹配，否则 `样本 {n}` 会吞掉 `样本 {n} 条已投` */
  weight: number
}

/**
 * 带占位符的字典 key 编译成正则。
 * 例如 `'停滞 {days} 天没回音'` → `/^停滞 (.+?) 天没回音$/`。
 * 这一步让「运行时才拼出来的句子」也能被翻译——服务端/core 产出的文案、
 * 以及未及逐个包 t() 的遗留界面，都走这条路。
 */
const PATTERNS: CompiledPattern[] = []

for (const [key, value] of Object.entries(EN)) {
  if (/\{\w+\}/.test(key)) {
    const names: string[] = []
    let source = '^'
    let cursor = 0
    const placeholder = /\{(\w+)\}/g
    let match: RegExpExecArray | null
    while ((match = placeholder.exec(key))) {
      // 数字型占位符只允许匹配数字。否则 `{days} 天` 会把「停留 3 天」整句
      // 吞成一个参数，翻出「停留 3 days」这种半中半英的混合串。
      const numeric = /^(n|days|count|score|min|max|target|y|m|num|total|status|a|b|rows)$/i.test(match[1] ?? '')
      source += escapeRegExp(key.slice(cursor, match.index)) + (numeric ? '(\\d+(?:\\.\\d+)?)' : '(.+?)')
      names.push(match[1] ?? '')
      cursor = match.index + match[0].length
    }
    source += escapeRegExp(key.slice(cursor)) + '$'
    PATTERNS.push({ re: new RegExp(source), names, value, weight: key.length })
  }
}
// 最具体的模式优先：字面量越长越不该被短模式抢先命中
PATTERNS.sort((a, b) => b.weight - a.weight)

/**
 * 动态文本翻译：整句精确命中 → 占位符模式 → 原文。
 *
 * 刻意**不做**短词逐段替换：中文里「匹配」「简历」「已投」都是更长的词的一部分，
 * 替换会把「匹配度」切成「Match度」、「已投递」切成「Applied递」。
 * 复合短语一律在字典里登记成整句，宁可漏译也不要产出半中半英的怪词。
 * 用户自己录入的中文数据不会命中字典，会原样保留——数据不该被翻译。
 */
export function translateDynamic(locale: Locale, raw: string): string {
  if (locale === 'zh' || !raw || !CJK.test(raw)) return raw
  // JSX 文本节点常带换行与缩进空白，而字典 key 是单行的一句；
  // 先在归一化后的文本上匹配，命中后再把原来的首尾空白贴回去。
  const lead = /^\s*/.exec(raw)?.[0] ?? ''
  const trail = /\s*$/.exec(raw)?.[0] ?? ''
  const core = raw.trim().replace(/\s+/g, ' ')
  if (!core) return raw
  const withSpaces = (value: string) => (value === core ? raw : lead + value + trail)

  const exact = EN[core] ?? EN[raw]
  if (exact) return withSpaces(exact)

  for (const pattern of PATTERNS) {
    const hit = pattern.re.exec(core)
    if (!hit) continue
    const params: Record<string, string> = {}
    pattern.names.forEach((name, index) => {
      // 捕获到的常是「react、typescript」这类中文顿号枚举，换成英文逗号
      params[name] = (hit[index + 1] ?? '').replace(/、/g, ', ')
    })
    return withSpaces(interpolate(pattern.value, params))
  }

  return raw
}

/** 给人看的日期；`Nov 7` / `11月7日`。写接口和文件名一律用 ISO，别走这里 */
export function formatDay(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: 'short', day: 'numeric' }).format(date)
}
