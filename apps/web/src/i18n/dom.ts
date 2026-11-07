/**
 * 运行时翻译兜底。
 *
 * 这个应用有 9k 行界面代码、近两千条中文文案，其中一部分由服务端/core 在运行时
 * 拼出来（漏斗提示、待办句子、Skill 名称）。逐个把 JSX 文本节点包进 t() 当然最
 * 规整，但那会是一次横跨 40 个文件、几乎无法靠 review 兜住的改动。
 *
 * 这里改用「渲染边界统一过一遍」：React 把中文写进 DOM 后，我们把文本节点和几个
 * 文案型属性换成字典译文。关键点是**不碰 React 的虚拟 DOM**——React 仍认为自己
 * 渲染的是中文，所以同一句重渲染时它不会去改 DOM；只有文案真的变了才会写入新的
 * 中文字符串，此时 MutationObserver 会再翻一次。原文存在 WeakMap 里，切回中文时
 * 原样还原，不需要刷新页面。
 *
 * 用户录入的数据（公司名、岗位名、备注）不会命中字典，也不会被改动——这是刻意的：
 * 数据是数据，不该因为界面换了语言就被翻译。
 *
 * 新写代码请继续用 `useT()`，显式调用可读、可静态检查；这一层只是把历史界面和
 * 动态句子兜住。两者共用 translate.ts 的同一份字典，不存在两套译文。
 */
import { CJK, translateDynamic, type Locale } from './translate'

/** 只有这几个属性装的是给人看的文案；value / className / data-* 一律不动 */
const TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const

const textOriginals = new WeakMap<Text, string>()
const attrOriginals = new WeakMap<Element, Record<string, string>>()

let observer: MutationObserver | null = null
let titleOriginal: string | null = null
let activeLocale: Locale = 'zh'

function applyText(node: Text, locale: Locale): void {
  const raw = node.nodeValue ?? ''
  if (locale === 'zh') {
    const original = textOriginals.get(node)
    if (original !== undefined && raw !== original) node.nodeValue = original
    return
  }
  // 自己刚写进去的英文文本会再次触发 observer；没有 CJK 就直接返回，闭环在此断开
  if (!CJK.test(raw)) return
  // raw 是中文，说明 React 刚写入了一句新的源文案（计数从 0 变 11 就是这种情况）。
  // 必须把它当作新原文，不能拿 WeakMap 里的旧值——否则会把「0 jobs」一直贴回去。
  textOriginals.set(node, raw)
  const next = translateDynamic(locale, raw)
  if (next !== raw) node.nodeValue = next
}

function applyElement(element: Element, locale: Locale): void {
  const originals = attrOriginals.get(element) ?? {}
  for (const attr of TEXT_ATTRS) {
    if (locale === 'zh') {
      const original = originals[attr]
      if (original !== undefined && element.getAttribute(attr) !== original) {
        element.setAttribute(attr, original)
      }
      continue
    }
    const current = element.getAttribute(attr) ?? ''
    if (!CJK.test(current)) continue
    originals[attr] = current
    const next = translateDynamic(locale, current)
    if (next !== current) element.setAttribute(attr, next)
  }
  if (Object.keys(originals).length > 0) attrOriginals.set(element, originals)
}

function applyTree(node: Node, locale: Locale): void {
  if (node.nodeType === Node.TEXT_NODE) {
    applyText(node as Text, locale)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  // 打印页/文档节点本身也可能带文案
  applyElement(node as Element, locale)
  for (const child of Array.from(node.childNodes)) applyTree(child, locale)
}

function applyTitle(locale: Locale): void {
  if (titleOriginal === null) titleOriginal = document.title
  document.title = locale === 'zh' ? titleOriginal : translateDynamic(locale, titleOriginal)
}

/**
 * 安装/卸载。切换语言时先停掉旧 observer 再重建，避免旧闭包用旧 locale 翻译新节点。
 * 中文模式下不装 observer——中文是原文，没有任何理由持续监听 DOM。
 */
export function installDomI18n(locale: Locale): void {
  if (typeof document === 'undefined' || !document.body) return
  activeLocale = locale
  observer?.disconnect()
  observer = null

  applyTitle(locale)
  applyTree(document.body, locale)

  if (locale === 'zh') return

  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') {
        applyText(record.target as Text, activeLocale)
      } else if (record.type === 'attributes') {
        applyElement(record.target as Element, activeLocale)
      } else if (record.type === 'childList') {
        for (const added of Array.from(record.addedNodes)) applyTree(added, activeLocale)
      }
    }
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TEXT_ATTRS],
  })
}
