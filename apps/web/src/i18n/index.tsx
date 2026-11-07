/**
 * 轻量 i18n。刻意不引 i18next / react-intl：本项目只有两种语言、没有复数规则、
 * 没有按语言切换的版式差异，一个字典 + 一个 Context 就够，不值得多 40KB。
 *
 * 关键设计：**中文原文就是字典 key**。
 *
 *   t('投递看板')              → 'Pipeline'（en）
 *   t('停滞 {days} 天', {days}) → 'Idle for {days} days'
 *
 * 为什么不用 `nav.pipeline` 这种语义 key：改造是渐进式的，漏包的串在英文模式下
 * 也只会退回中文原文，不会漏出 `nav.pipeline` 这样的占位符；而且字典能一眼对照
 * 原文审校。代价是改中文文案必须同步改字典 key，`npm run check:i18n` 会扫出来。
 *
 * 两套消费方式共用同一份字典：
 *  1. 新代码显式 `useT()` → `t(...)`，可读、可静态检查；
 *  2. `dom.ts` 的运行时兜底，覆盖尚未逐个包裹的遗留界面与服务端产出的句子。
 * 兜底不是「另一套译文」，它调的是 translate.ts 里同一个 translateDynamic()。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { installDomI18n } from './dom'
import {
  LOCALE_TAGS,
  STORAGE_KEY,
  isLocale,
  translate,
  type Locale,
} from './translate'

export type { Locale, Dict } from './translate'
export {
  LOCALES,
  LOCALE_NAMES,
  LOCALE_TAGS,
  STORAGE_KEY,
  isLocale,
  interpolate,
  translate,
  translateDynamic,
  formatDay,
} from './translate'

/**
 * 首次进入的语言：先看用户手动选过什么，再看浏览器。
 * 浏览器是中文的给中文（产品第一用户群），其余一律给英文——传播对象是英文圈的
 * Agent 开发者，让他们进来先看到一屏中文是劝退的。
 * `navigator.languages` 逐项看：`['fr-FR', 'zh-CN']` 这类也应认为能读中文。
 */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh'
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    // 隐私模式下 localStorage 会抛，忽略即可
  }
  const langs =
    navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]
  return langs.some((tag) => /^zh(-|_|$)/i.test(tag)) ? 'zh' : 'en'
}

export interface I18nValue {
  locale: Locale
  setLocale: (next: Locale) => void
  /** 中文原文进，当前语言的文字出 */
  t: (zh: string, params?: Record<string, string | number>) => string
  /** 给 Intl.* / toLocaleDateString 用的标签 */
  tag: string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  // <html lang> 影响屏读软件、断词与打印分页，切语言必须跟着改
  useEffect(() => {
    document.documentElement.lang = LOCALE_TAGS[locale]
  }, [locale])

  // 运行时兜底：装/卸都跟着 locale 走，切回中文时把 DOM 原文还原
  useEffect(() => {
    installDomI18n(locale)
    return () => installDomI18n('zh')
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 存不下也不影响本次会话
    }
  }, [])

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      tag: LOCALE_TAGS[locale],
      t: (zh, params) => translate(locale, zh, params),
    }),
    [locale, setLocale],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n 必须在 I18nProvider 内使用')
  return value
}

/** 只需要翻译时用它，省得每次解构 */
export function useT(): I18nValue['t'] {
  return useI18n().t
}
