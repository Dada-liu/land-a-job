import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useFreeformEdit } from './context'
import { forgetField, releaseField, rememberField, scheduleVisibleFocus, updateFieldCaret } from './focus'

/**
 * 停止输入多久后把文字落库。
 *
 * 太短：每敲一个字都会重新分页（ResumePages 是按真实文本高度切页的），
 * 纸面会一直抖；太长：长段落看不到「纸面在往上长」。400ms 是两者的折中。
 */
const COMMIT_DELAY = 400

/** 可编辑文本的公共外观：悬停给一层淡底，聚焦给一圈细环，让人看得出「这里能改」 */
const EDITABLE_BASE =
  '-mx-1 rounded px-1 outline-none transition-colors hover:bg-stone-100/70 focus:bg-stone-50 focus:ring-1 focus:ring-stone-300'

export interface EditableTextProps {
  value: string
  onChange: (next: string) => void
  /** 无障碍名称，例如「姓名」「公司」 */
  label: string
  /** 机器名，落到 data-freeform-field 上，供 E2E 定位 / 调试 */
  field: string
  as?: 'div' | 'span' | 'p' | 'h1' | 'h2' | 'li'
  className?: string
  /** true = 允许换行（回车换行）；false = 单行（回车结束编辑） */
  multiline?: boolean
}

/** contenteditable 敲回车会插 <div> / <br>，统一按 innerText 折回纯文本 */
function readText(element: HTMLElement, multiline: boolean): string {
  const raw = element.innerText.replace(/\u00a0/g, ' ')
  if (!multiline) return raw.replace(/\s*\n+\s*/g, ' ').trim()
  return raw.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
}

/**
 * 纸面上可直接编辑的一段文字。
 *
 * 关键实现：**React 不管这个元素的文字**。文本只在两种时机由 ref 写进 DOM——
 * 挂载后、以及外部（左侧面板 / Agent / 冲突重载）改了值且元素没在编辑。
 * 如果把 `value` 当 children 渲染，React 每次重渲染都会重设文本节点，光标会跳回开头。
 *
 * 没有 FreeformEditProvider 时它退化成纯文本节点：打印页与无头导出走的就是这条路，
 * 所以「纸上看到的」和「导出 PDF 的」是同一份 JSX。
 */
export function EditableText({
  value,
  onChange,
  label,
  field,
  as = 'div',
  className = '',
  multiline = false,
}: EditableTextProps) {
  const edit = useFreeformEdit()
  const ref = useRef<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  /** 输入法拼字中？见 commit() 里的说明 */
  const composing = useRef(false)

  // 外部改动同步进 DOM；正在打字的元素跳过，否则光标会被顶到开头。
  //
  // 这里比对/写入都用 textContent 而不是 innerText：离屏测量层是 `visibility: hidden`，
  // Chrome 对隐藏元素的 innerText 一律返回空串，于是「值被删空」时
  //   `'' !== ''` 不成立 → 永远不清空 → 测量层还留着旧文本 → 分页永远不缩回去。
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    if (document.activeElement === element) return
    if (element.textContent !== value) element.textContent = value
  }, [value, edit])

  // 值一变就可能重新分页：检查一下正在编辑的副本是不是被裁到下一页去了（见 focus.ts）
  useLayoutEffect(() => {
    scheduleVisibleFocus()
  }, [value])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // 卸载时如果正被编辑（换页把这一页删掉了），安排把焦点接到还存在的副本上
  useEffect(() => {
    const element = ref.current
    return () => {
      if (element) releaseField(element)
    }
  }, [])

  if (!edit) {
    const Tag = as
    return <Tag className={className}>{value}</Tag>
  }

  const commit = () => {
    const element = ref.current
    if (!element) return
    // 输入法拼字过程中不提交：这时候提交会触发重新分页，甚至把焦点搬到另一页的副本上，
    // 拼音候选到一半就被打断，用户打出来的字直接丢。
    if (composing.current) return
    const next = readText(element, multiline)
    if (next === value) return
    onChange(next)
    // 提交换页后可能要把焦点搬到新的可见副本上
    scheduleVisibleFocus()
  }

  const schedule = () => {
    const element = ref.current
    if (element) updateFieldCaret(element)
    window.clearTimeout(timer.current)
    if (composing.current) return
    timer.current = window.setTimeout(commit, COMMIT_DELAY)
  }

  const flush = () => {
    window.clearTimeout(timer.current)
    commit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }
    // 单行字段（姓名、公司、时间…）：回车就是「改完了」
    if (event.key === 'Enter' && !multiline) {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    // 只收纯文本：从 Word / 网页粘进来的字号、颜色、表格会把纸面版式弄乱
    event.preventDefault()
    // execCommand 已标记废弃，但它是唯一能保住浏览器原生撤销栈的插入方式
    document.execCommand('insertText', false, text)
  }

  // as 只是标签名，运行时渲染的仍是传进来的标签；这里放宽断言是为了让 ref 能挂到任意标签上
  const Tag = as as 'div'

  /**
   * 空字段必须还有「一块可点的地」（否则用户把公司名删干净，那行就消失了，再也点不回去）：
   * 块级给最小高度，行内给 inline-block + 最小宽高。
   * 多行的行内元素不加 inline-block——那会让整段都跟着首行缩进，跟静态版式不一样。
   */
  const sizing =
    as === 'span'
      ? multiline
        ? ''
        : 'inline-block min-w-[2ch] min-h-[1.2em] align-baseline'
      : // 块级元素用 w-fit：悬停时那层淡底只包住文字，而不是横贯整行（看着像整行被选中了）
        'w-fit max-w-full min-h-[1.2em]'

  return (
    <Tag
      ref={ref as RefObject<HTMLDivElement>}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline || undefined}
      data-freeform-field={field}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      autoCorrect="off"
      onInput={schedule}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
        // 拼字结束再按正常节奏提交（此时内容已经是完整的汉字）
        schedule()
      }}
      onBlur={(event) => {
        forgetField(event.currentTarget)
        flush()
      }}
      onFocus={(event) => rememberField(field, event.currentTarget)}
      // 方向键、点选都会挪光标但不会触发 input，这里补记一次，
      // 万一随后换页，搬过去的光标才能落在同一个字后面
      onKeyUp={(event) => updateFieldCaret(event.currentTarget)}
      onMouseUp={(event) => updateFieldCaret(event.currentTarget)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      className={`${EDITABLE_BASE} ${sizing} ${multiline ? 'whitespace-pre-wrap' : ''} ${className}`}
    />
  )
}
