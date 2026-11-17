import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ExternalLink } from 'lucide-react'
import { useT } from '../i18n'

/** 一层薄薄的样式原子：只统一边框/圆角/字号，不引入组件库 */

const FIELD_BASE =
  'rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-500 disabled:bg-stone-50'

/**
 * 宽度默认撑满，但调用点显式传了 `w-*` 就听调用点的。
 *
 * 不能靠拼串解决：`w-full` 与 `w-56` 同属 width，谁赢由 Tailwind 生成的 CSS 顺序决定
 * （`w-full` 排在 `w-56` 后面），写在后面的 class 并不一定生效。曾经因此让公司库/岗位库的
 * 搜索框吃掉整行，把旁边的「新建公司」挤成两行。
 */
function fieldWidth(className: string): string {
  return /(?:^|\s)w-/.test(className) ? '' : 'w-full'
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`${FIELD_BASE} ${fieldWidth(className)} ${className}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`${FIELD_BASE} ${fieldWidth(className)} leading-relaxed ${className}`} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-stone-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-stone-400">{hint}</span> : null}
    </label>
  )
}

/* -------------------------------- 悬浮提示 -------------------------------- */

const TIP_GAP = 6

/**
 * 轻量 tooltip：包一层 span，气泡挂 portal 到 body，`position: fixed` 按触发元素算位置。
 *
 * 为什么不直接用原生 `title`：它的弹出由系统渲染，延迟约 1 秒、样式跟随操作系统、
 * 鼠标一动就消失——图标按钮上「hover 看说明」基本等于没有提示。
 *
 * 为什么要 portal：纯 CSS 的气泡是 `absolute`，只要祖先有 `overflow` 就会被裁掉
 * （下拉菜单、表格的横向滚动容器都是这样）。挂到 body 上就不受任何容器影响了。
 *
 * 用法：把可交互元素（button/a）当 children 传进来。气泡是兄弟节点且
 * `pointer-events-none`，不会出现「按钮里嵌按钮」，也不会抢鼠标。
 */
export function Tooltip({
  label,
  side = 'top',
  children,
  className = '',
}: {
  label: ReactNode
  /** 空间不够时（比如贴着页面顶部）改成 bottom */
  side?: 'top' | 'bottom'
  children: ReactNode
  className?: string
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  /** 打开那一刻量到的坐标；null 表示没显示 */
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)

  const show = () => {
    const element = anchorRef.current
    if (!element) return
    const box = element.getBoundingClientRect()
    setAnchor({ left: box.left + box.width / 2, top: box.top - TIP_GAP, bottom: box.bottom + TIP_GAP })
  }
  const hide = () => setAnchor(null)

  // 坐标是打开时的快照：滚动/改窗口就收起，免得气泡浮在原地
  useEffect(() => {
    if (!anchor) return
    const close = () => setAnchor(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [anchor])

  return (
    <span
      ref={anchorRef}
      className={`inline-flex ${className}`}
      // onFocus/onBlur 在 React 里是冒泡的（等价 focusin/focusout），键盘 Tab 到按钮也会显示
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {anchor
        ? createPortal(
            <span
              role="tooltip"
              style={{
                left: anchor.left,
                top: side === 'top' ? anchor.top : anchor.bottom,
                // 水平居中靠 translate，不用先量气泡宽度
                transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              }}
              className="pointer-events-none fixed z-[70] whitespace-nowrap rounded bg-stone-900 px-1.5 py-1 text-[11px] leading-none text-white shadow-sm"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  )
}

/* -------------------------------- 下拉选择 -------------------------------- */

/** 选项行右侧的小动作：点击不选中选项，而是打开一个页面（新标签页） */
export interface SelectOptionAction {
  /** 悬浮提示与无障碍名称 */
  label: string
  /** 用 <a target="_blank"> 打开，保留中键/右键「新标签页打开」的原生行为 */
  href: string
  icon?: ReactNode
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  action?: SelectOptionAction
}

/** 与原生 select 的 onChange 同形：调用点继续写 `event.target.value` */
export type SelectChangeEvent = { target: { value: string } }

/** 把 <option> 的 children（可能是字符串 + 条件片段）摊成纯文本 */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

/**
 * 兼容历史写法：把 `<option>` 子节点摊平成选项数组。
 * 全站四十多个调用点都写着 `<option value=…>`，这样迁移时不用逐个改写成 options 数组，
 * 也就不会漏掉某个 select 又变回原生控件。
 */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const items: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return
    const props = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode }
    const label = nodeText(props.children)
    items.push({
      value: props.value === undefined ? label : String(props.value),
      label,
      disabled: props.disabled,
    })
  })
  return items
}

const MENU_MAX_HEIGHT = 264
const MENU_GAP = 4
/** 搜索型下拉的搜索框占位高度，参与「往上弹还是往下弹」的估算 */
const SEARCH_BOX_HEIGHT = 42

/**
 * 前端过滤：只按选项可见文字做包含匹配，不看 value。
 * value 对筛选型下拉是公司 id / uuid，拿它匹配只会误导。
 */
function matchOptions(items: SelectOption[], keyword: string): SelectOption[] {
  const needle = keyword.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => item.label.toLowerCase().includes(needle))
}

interface MenuRect {
  left: number
  minWidth: number
  top: number
  up: boolean
  maxHeight: number
}

type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange' | 'onClick' | 'children' | 'multiple' | 'size'
> & {
  value?: string | number
  onChange?: (event: SelectChangeEvent) => void
  onClick?: MouseEventHandler<HTMLButtonElement>
  /** 新写法；不传则从 `<option>` 子节点推导 */
  options?: SelectOption[]
  children?: ReactNode
  /**
   * 选项多时打开弹层顶部给一个搜索框，输入即在前端过滤。
   * 默认关：状态/排序这类三五个固定选项加了搜索框只会多一次点击。
   */
  searchable?: boolean
  /** 搜索框占位文案，默认「搜索选项」 */
  searchPlaceholder?: string
}

/**
 * 自定义下拉：外观与本页其它输入框一致，弹层挂 portal 到 body。
 *
 * 为什么不用原生 `<select>`：原生控件的弹出列表由系统渲染，字号/间距/圆角都跟页面不搭，
 * 在 Windows 与 macOS 上还长得不一样。这里用 button + listbox 自己画，
 * 位置用 fixed 算（弹窗/抽屉的内容区是 overflow-auto，absolute 会被裁掉）。
 *
 * 无障碍：触发器是 combobox 语义，方向键/回车/Esc 可用；非搜索型焦点始终留在触发器上，
 * 所以键盘事件只在触发器上处理，弹层里的选项靠 aria-activedescendant 播报。
 * 搜索型打开后焦点进搜索框，由搜索框接管同一套键位（选项列表同上播报）。
 */
export function Select(props: SelectProps) {
  const {
    value,
    onChange,
    options,
    children,
    className = '',
    disabled,
    onClick,
    searchable = false,
    searchPlaceholder,
    ...rest
  } = props
  const t = useT()
  const all = useMemo(() => options ?? optionsFromChildren(children), [options, children])
  const currentValue = value === undefined || value === null ? '' : String(value)
  const current = all.find((item) => item.value === currentValue)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<MenuRect | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [query, setQuery] = useState('')

  /** 当前真正渲染的选项：搜了就只剩命中的那些，键盘上下也跟着它走 */
  const items = useMemo(() => (searchable ? matchOptions(all, query) : all), [all, query, searchable])

  const firstEnabled = useCallback((list: SelectOption[], from = 0) => {
    for (let i = 0; i < list.length; i += 1) {
      const index = (from + i) % list.length
      if (!list[index]?.disabled) return index
    }
    return 0
  }, [])

  // 位置在打开后同步算一次：先量触发器，再决定往上弹还是往下弹。
  // 估算按**完整**选项数算，不跟着搜索结果变：否则边打字边缩，弹层会在「往上/往下」之间跳。
  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      return
    }
    const element = triggerRef.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const estimate = Math.min(MENU_MAX_HEIGHT, all.length * 28 + 10 + (searchable ? SEARCH_BOX_HEIGHT : 0))
    const spaceBelow = window.innerHeight - box.bottom - MENU_GAP - 8
    const spaceAbove = box.top - MENU_GAP - 8
    const up = spaceBelow < estimate && spaceAbove > spaceBelow
    setRect({
      left: box.left,
      minWidth: box.width,
      top: up ? box.top - MENU_GAP : box.bottom + MENU_GAP,
      up,
      maxHeight: Math.min(MENU_MAX_HEIGHT, Math.max(96, up ? spaceAbove : spaceBelow)),
    })
  }, [open, all.length, searchable])

  // 搜索型下拉打开后把焦点交给搜索框：用户点了下拉就是想直接敲字。
  // 依赖 rect 而不是 open：弹层要等 rect 算完才挂到 body 上。
  useEffect(() => {
    if (!open || !searchable || !rect) return
    searchRef.current?.focus()
  }, [open, searchable, rect])

  // 关掉时机：点外部 / Esc / 滚动 / 改窗口大小。
  // 滚动要捕获阶段监听，否则抽屉内容区滚动时弹层会浮在半空。
  useEffect(() => {
    if (!open) return
    const closeOnPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', closeOnPointerDown, true)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', closeOnPointerDown, true)
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const openMenu = () => {
    const selected = all.findIndex((item) => item.value === currentValue && !item.disabled)
    setQuery('')
    setActiveIndex(selected >= 0 ? selected : firstEnabled(all))
    setOpen(true)
  }

  const choose = (item: SelectOption) => {
    if (item.disabled) return
    onChange?.({ target: { value: item.value } })
    setOpen(false)
    triggerRef.current?.focus()
  }

  /** 方向键在一屏（可能是过滤后的）选项里挪，跳过 disabled；空列表时什么都不做 */
  const moveActive = (step: number) => {
    if (items.length === 0) return
    const from = Math.min(activeIndex, items.length - 1)
    setActiveIndex(firstEnabled(items, (from + step + items.length) % items.length))
  }

  /** 输入即过滤：命中列表变了，高亮跟着回到第一条可用项，回车才有东西可落 */
  const changeQuery = (next: string) => {
    const matched = matchOptions(all, next)
    const first = matched.findIndex((item) => !item.disabled)
    setQuery(next)
    setActiveIndex(first >= 0 ? first : 0)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'Escape' && open) {
      // 抽屉/弹窗也在 document 上听 Esc，这里先吃掉，免得「关下拉」顺手把抽屉关了
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openMenu()
        return
      }
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      const item = items[activeIndex]
      if (item) choose(item)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  /**
   * 搜索框里的键盘：上下挪高亮、回车落选、Esc 收起并把焦点还给触发器。
   * 搜索框在 portal 里（body 下），Esc 必须 stopPropagation，否则会顺带关掉外层抽屉。
   */
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const item = items[activeIndex]
      if (item) choose(item)
      return
    }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <div className={className}>
      <button
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        ref={triggerRef}
        type="button"
        role="combobox"
        /** E2E 与调试用：原生 select 能读 el.value，这里用 data-value 顶上 */
        data-value={currentValue}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && !searchable && items[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event)
          if (open) setOpen(false)
          else openMenu()
        }}
        onKeyDown={onKeyDown}
        className={`${FIELD_BASE} flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:text-stone-400`}
      >
        <span className={`truncate ${current ? '' : 'text-stone-400'}`}>{current?.label ?? ' '}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                left: rect.left,
                top: rect.top,
                minWidth: rect.minWidth,
                maxWidth: 360,
                maxHeight: rect.maxHeight,
                transform: rect.up ? 'translateY(-100%)' : undefined,
              }}
              /**
               * 搜索型下拉：搜索框固定在上、选项区自己滚。
               * 若让整个弹层滚动，输入几个字后搜索框会被滚出可视区。
               */
              className="z-[60] flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg shadow-stone-900/5"
            >
              {searchable ? (
                <div className="shrink-0 border-b border-stone-100 p-1.5">
                  <input
                    ref={searchRef}
                    /** 一个页面同时只可能开一个弹层，E2E 用这个抓搜索框 */
                    data-select-search=""
                    type="text"
                    role="combobox"
                    aria-expanded
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={items[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
                    aria-label={searchPlaceholder ?? t('搜索选项')}
                    placeholder={searchPlaceholder ?? t('搜索选项')}
                    value={query}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => changeQuery(event.target.value)}
                    onKeyDown={onSearchKeyDown}
                    className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-900 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-500"
                  />
                </div>
              ) : null}
              <div id={listboxId} role="listbox" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
                {items.length === 0 ? (
                  <div className="px-2.5 py-1.5 text-xs text-stone-400">
                    {all.length === 0 ? t('没有可选项') : t('没有匹配的选项')}
                  </div>
                ) : (
                  items.map((item, index) => {
                    const selected = item.value === currentValue
                    return (
                      /**
                       * 用 div 而不是 button：选项行里可能带一个「打开」链接（SelectOptionAction），
                       * button 里不能再嵌 a/button。选中逻辑仍在 onClick 上，键位由触发器/搜索框接管。
                       */
                      <div
                        key={`${item.value}-${index}`}
                        id={`${listboxId}-${index}`}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={item.disabled || undefined}
                        data-value={item.value}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(item)}
                        className={[
                          'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
                          item.disabled
                            ? 'cursor-not-allowed text-stone-300'
                            : index === activeIndex
                              ? 'cursor-pointer bg-stone-100 text-stone-900'
                              : 'cursor-pointer text-stone-700',
                        ].join(' ')}
                      >
                        <span className="truncate">{item.label}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {selected ? <Check className="h-3.5 w-3.5 text-stone-900" /> : null}
                          {item.action ? (
                            <Tooltip label={item.action.label}>
                              <a
                                href={item.action.href}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={item.action.label}
                                data-select-action=""
                                onClick={(event) => {
                                  // 别让点击行内的链接也被当成「选中这个选项」
                                  event.stopPropagation()
                                  // 收起下拉：新标签页打开后回来还停着一个不知从哪冒出来的菜单很怪
                                  setOpen(false)
                                }}
                                className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-900"
                              >
                                {item.action.icon ?? <ExternalLink className="h-3 w-3" />}
                              </a>
                            </Tooltip>
                          ) : null}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-stone-900 text-white hover:bg-stone-800 disabled:bg-stone-400',
  secondary: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:text-stone-400',
  ghost: 'text-stone-600 hover:bg-stone-100 disabled:text-stone-400',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:text-red-300',
  /** 二次确认里的「确认删除」：危险动作用实心红，避免和普通按钮看起来一样重 */
  'danger-solid': 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
}

export function Button({
  variant = 'secondary',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/**
 * Card 兜底把其余属性透传下去。
 * 之前只解构 children/className，导致 <Card data-testid> 被静默丢掉——
 * 页面看着正常，E2E 却找不到元素；这种「属性消失」比报错更难查。
 */
export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-xl border border-stone-200 bg-white ${className}`}>
      {children}
    </div>
  )
}

export function SectionTitle({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium text-stone-900">{children}</h3>
      {extra ? <div className="text-[11px] text-stone-400">{extra}</div> : null}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 px-4 py-8 text-center">
      <div className="text-sm text-stone-600">{title}</div>
      {hint ? <div className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-stone-400">{hint}</div> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function PageHeader({
  title,
  titleExtra,
  description,
  descriptionClassName = 'max-w-2xl',
  actions,
}: {
  title: string
  /**
   * 标题右侧的小动作（目前是「复制名称」）。
   * 单独开一个口而不是让调用点自己拼节点：标题的排版（字号/间距）只在 PageHeader 里定义一次。
   */
  titleExtra?: ReactNode
  description?: string
  /** 少数页面的一句话说明本身就很短但被 max-w-2xl 提前折断，可传 max-w-none 让它整行铺开 */
  descriptionClassName?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
          {titleExtra}
        </div>
        {description ? <p className={`mt-1 text-sm text-stone-500 ${descriptionClassName}`}>{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  )
}
