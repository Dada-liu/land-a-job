/**
 * 纸面编辑的「焦点跟着内容走」。
 *
 * 背景：ResumePages 的每一页都会渲染**整份**模板，再靠 `translateY(-offset)` + 视口裁剪
 * 只露出属于这一页的那一段。所以同一个字段在页面上有 N 个副本，用户编辑的是当前露出来的那份。
 *
 * 一旦输入把整块内容顶到下一页（分页边界是按块算的），刚露出来的那份会被裁掉，
 * 而光标还留在被裁掉的那个副本里——用户看不见插入点，继续打字像在往空气里写。
 * 极端情况下（页数减少）那个副本会被直接卸载，焦点掉到 body，输入直接断掉。
 *
 * 这里做的事：记住「正在编辑哪个字段、光标在第几个字」，分页稳定后如果当前副本不可见了，
 * 就把焦点和光标搬到同一个字段的可见副本上。字段名（data-freeform-field）跨页稳定，
 * 所以搬过去之后光标位置能对上。
 */
interface EditSession {
  field: string
  element: HTMLElement
  /** 最近一次记录的光标偏移（元素被卸载后还能靠它还原） */
  offset: number
  /** 最近一次活动时间：元素被卸载后据此判断「是不是刚刚还在打字」 */
  lastActive: number
}

let session: EditSession | null = null
let scheduled = false

/** 元素被卸载后，超过这个时间就不再抢回焦点（防止离开页面后又把光标塞进别的字段） */
const RESTORE_WINDOW_MS = 3000

export function rememberField(field: string, element: HTMLElement): void {
  session = { field, element, offset: readCaretOffset(element), lastActive: Date.now() }
}

export function updateFieldCaret(element: HTMLElement): void {
  if (session?.element !== element) return
  session.offset = readCaretOffset(element)
  session.lastActive = Date.now()
}

export function forgetField(element: HTMLElement): void {
  if (session?.element === element) session = null
}

/**
 * 组件卸载时的收尾。
 *
 * 「内容变少 → 页数回落 → 正在编辑的那一页被整个卸载」时，焦点会直接掉到 body，
 * 用户再打字就什么都没发生。这里**不清** session（还要靠它把焦点接回去），
 * 只安排一次检查，让焦点落到同一字段仍然存在的副本上。
 */
export function releaseField(element: HTMLElement): void {
  if (session?.element === element) scheduleVisibleFocus()
}

/** 分页会晚一帧（ResumePages 在 rAF 里测量完才 setPagination），所以要等两帧再看 */
export function scheduleVisibleFocus(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scheduled = false
      ensureVisibleFocus()
    })
  })
}

/** 光标在元素文本里的字符偏移 */
function readCaretOffset(element: HTMLElement): number {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer)) return 0
  const measure = document.createRange()
  measure.selectNodeContents(element)
  measure.setEnd(range.startContainer, range.startOffset)
  return measure.toString().length
}

/** 把光标放到第 offset 个字符处（超出就落到末尾） */
function writeCaretOffset(element: HTMLElement, offset: number): void {
  const selection = document.getSelection()
  if (!selection) return
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let lastText: Text | null = null
  let node = walker.nextNode() as Text | null

  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= length
    lastText = node
    node = walker.nextNode() as Text | null
  }

  if (lastText) range.setStart(lastText, lastText.textContent?.length ?? 0)
  else range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 同一字段的所有副本 */
function copiesOf(field: string): HTMLElement[] {
  const stack = document.querySelector('[data-resume-stack]')
  if (!stack) return []
  return Array.from(stack.querySelectorAll<HTMLElement>('[data-freeform-field]')).filter(
    (element) => element.dataset.freeformField === field,
  )
}

/** 这个副本所在页的「纸面视口」（超出部分会被裁掉） */
function viewportOf(element: HTMLElement): DOMRect | null {
  const viewport = element.closest('[data-resume-viewport]')
  return viewport ? viewport.getBoundingClientRect() : null
}

/** 在第 offset 个字符处放一个空 Range，用它量光标的位置 */
function caretRect(element: HTMLElement, offset: number): DOMRect | null {
  const range = document.createRange()
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, offset)
  let lastText: Text | null = null
  let node = walker.nextNode() as Text | null

  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      const rect = range.getBoundingClientRect()
      if (isUsableRect(rect)) return rect
      break
    }
    remaining -= length
    lastText = node
    node = walker.nextNode() as Text | null
  }

  if (lastText) {
    range.setStart(lastText, lastText.textContent?.length ?? 0)
  } else {
    range.selectNodeContents(element)
  }
  range.collapse(false)
  const rect = range.getBoundingClientRect()
  if (isUsableRect(rect)) return rect

  // 空字段（刚被删干净）拿不到光标矩形，Chrome 会返回全 0：
  // 退回元素自己的位置，否则「删空后换页」这种情况永远判定为「光标不可见」而搬不动焦点
  const box = element.getBoundingClientRect()
  return isUsableRect(box) ? box : null
}

function isUsableRect(rect: DOMRect): boolean {
  return rect.width > 0 || rect.height > 0 || rect.top !== 0 || rect.left !== 0
}

/**
 * 光标是否落在这个副本的可见区域里。
 *
 * 只看「元素有没有面积」是不够的：整块内容比一页还高时，元素在页面上总有露出来的部分，
 * 但光标可能在几千个字之后、早就被裁到视口下面去了。所以按光标位置判断。
 */
function caretVisible(element: HTMLElement, offset: number): boolean {
  const viewport = viewportOf(element)
  if (!viewport) return true
  const caret = caretRect(element, offset)
  if (!caret) return false
  // 空行时光标矩形的宽高可能是 0，只比上下边界（左右由纸宽保证）
  return caret.bottom > viewport.top + 1 && caret.top < viewport.bottom - 1
}

/**
 * 把光标那一点滚进可视区。
 *
 * 换页会改变纸面高度，光标可能刚好落在屏幕外；而 `focus({preventScroll:true})` 和
 * 手动设选区都不会让浏览器自动滚动，用户会以为「字打丢了」。这里只滚一个很小的距离
 * （刚好把光标露出来），不整页跳。
 */
function scrollCaretIntoView(element: HTMLElement, offset: number): void {
  const caret = caretRect(element, offset)
  if (!caret) return
  let scroller = element.parentElement
  while (scroller) {
    const style = getComputedStyle(scroller)
    if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const box = scroller.getBoundingClientRect()
  // 纸面可能被缩放（预览有 50%~200%）：屏幕上的差值要除以缩放比才是 scrollTop 的差值
  const viewport = element.closest<HTMLElement>('[data-resume-viewport]')
  const scale = viewport && viewport.offsetWidth > 0 ? viewport.getBoundingClientRect().width / viewport.offsetWidth : 1
  const margin = 24
  if (caret.bottom > box.bottom - margin) {
    scroller.scrollTop += (caret.bottom - box.bottom + margin) / (scale || 1)
  } else if (caret.top < box.top + margin) {
    scroller.scrollTop -= (box.top - caret.top + margin) / (scale || 1)
  }
}

function ensureVisibleFocus(): void {
  const current = session
  if (!current) return
  const active = document.activeElement
  const connected = current.element.isConnected

  if (connected) {
    // 还在文档里：只有焦点确实停在这个字段上才搬，否则是用户自己点了别处
    if (active !== current.element) return
  } else {
    // 副本被换页卸载了：只在「刚刚还在打字」且焦点确实掉到了 body 时接手。
    // 用户点链接/按钮离开时 activeElement 是那个控件，不能抢回来。
    if (Date.now() - current.lastActive > RESTORE_WINDOW_MS) return
    if (active !== document.body) return
  }

  const offset = connected ? readCaretOffset(current.element) : current.offset
  if (connected && caretVisible(current.element, offset)) return

  for (const copy of copiesOf(current.field)) {
    if (copy === current.element) continue
    if (!caretVisible(copy, offset)) continue
    session = { field: current.field, element: copy, offset, lastActive: Date.now() }
    // preventScroll：换页后内容基本还在原位，先用最小的滚动量把光标露出来即可
    copy.focus({ preventScroll: true })
    writeCaretOffset(copy, offset)
    scrollCaretIntoView(copy, offset)
    return
  }
}
