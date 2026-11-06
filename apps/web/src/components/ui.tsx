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
import { Check, ChevronDown } from 'lucide-react'

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

/* -------------------------------- 下拉选择 -------------------------------- */

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
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
}

/**
 * 自定义下拉：外观与本页其它输入框一致，弹层挂 portal 到 body。
 *
 * 为什么不用原生 `<select>`：原生控件的弹出列表由系统渲染，字号/间距/圆角都跟页面不搭，
 * 在 Windows 与 macOS 上还长得不一样。这里用 button + listbox 自己画，
 * 位置用 fixed 算（弹窗/抽屉的内容区是 overflow-auto，absolute 会被裁掉）。
 *
 * 无障碍：触发器是 combobox 语义，方向键/回车/Esc 可用；焦点始终留在触发器上，
 * 所以键盘事件只在触发器上处理，弹层里的选项靠 aria-activedescendant 播报。
 */
export function Select(props: SelectProps) {
  const { value, onChange, options, children, className = '', disabled, onClick, ...rest } = props
  const items = useMemo(() => options ?? optionsFromChildren(children), [options, children])
  const currentValue = value === undefined || value === null ? '' : String(value)
  const current = items.find((item) => item.value === currentValue)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<MenuRect | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const firstEnabled = useCallback(
    (from = 0) => {
      for (let i = 0; i < items.length; i += 1) {
        const index = (from + i) % items.length
        if (!items[index]?.disabled) return index
      }
      return 0
    },
    [items],
  )

  // 位置在打开后同步算一次：先量触发器，再决定往上弹还是往下弹
  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      return
    }
    const element = triggerRef.current
    if (!element) return
    const box = element.getBoundingClientRect()
    const estimate = Math.min(MENU_MAX_HEIGHT, items.length * 28 + 10)
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
  }, [open, items.length])

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
    const selected = items.findIndex((item) => item.value === currentValue && !item.disabled)
    setActiveIndex(selected >= 0 ? selected : firstEnabled())
    setOpen(true)
  }

  const choose = (item: SelectOption) => {
    if (item.disabled) return
    onChange?.({ target: { value: item.value } })
    setOpen(false)
    triggerRef.current?.focus()
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
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => firstEnabled((index + step + items.length) % items.length))
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
        aria-activedescendant={open && items[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
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
              id={listboxId}
              role="listbox"
              style={{
                position: 'fixed',
                left: rect.left,
                top: rect.top,
                minWidth: rect.minWidth,
                maxWidth: 360,
                maxHeight: rect.maxHeight,
                transform: rect.up ? 'translateY(-100%)' : undefined,
              }}
              className="z-[60] overflow-y-auto overflow-x-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg shadow-stone-900/5"
            >
              {items.length === 0 ? (
                <div className="px-2.5 py-1.5 text-xs text-stone-400">没有可选项</div>
              ) : (
                items.map((item, index) => {
                  const selected = item.value === currentValue
                  return (
                    <button
                      key={`${item.value}-${index}`}
                      id={`${listboxId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-value={item.value}
                      disabled={item.disabled}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(item)}
                      className={[
                        'flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
                        item.disabled
                          ? 'cursor-not-allowed text-stone-300'
                          : index === activeIndex
                            ? 'bg-stone-100 text-stone-900'
                            : 'text-stone-700',
                      ].join(' ')}
                    >
                      <span className="truncate">{item.label}</span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-stone-900" /> : null}
                    </button>
                  )
                })
              )}
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
  description,
  descriptionClassName = 'max-w-2xl',
  actions,
}: {
  title: string
  description?: string
  /** 少数页面的一句话说明本身就很短但被 max-w-2xl 提前折断，可传 max-w-none 让它整行铺开 */
  descriptionClassName?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
        {description ? <p className={`mt-1 text-sm text-stone-500 ${descriptionClassName}`}>{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  )
}
