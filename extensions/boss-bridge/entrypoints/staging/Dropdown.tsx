import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 缓存岗位页的筛选下拉：自绘（不用原生 <select>），样式见 ui.css 的 .fdrop 系列。
 * ui.css 与 popup 共用，所以类名一律带 fdrop 前缀，别改成通用名。
 */

export interface DropdownItem {
  value: string
  label: string
  /** 右侧计数，如各流程阶段的条数 */
  count?: number
}

interface BaseProps {
  /** 触发器前缀，如「阶段」 */
  label: string
  items: readonly DropdownItem[]
  /** 菜单贴右边缘（最右侧的下拉用，避免面板溢出页面） */
  align?: 'left' | 'right'
}

/** 点面板外面或按 Esc 关掉：两个下拉共用，省得每处写一遍 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`fdrop-chev ${open ? 'open' : ''}`}
      width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

interface SelectProps extends BaseProps {
  value: string
  /** 视为「不筛选」的取值：选中它时触发器不高亮 */
  emptyValue?: string
  onChange: (value: string) => void
}

/** 单选下拉：阶段 / 活跃度 / 薪资 / 排序 */
export function Select({ label, items, value, emptyValue, onChange, align = 'left' }: SelectProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)
  const current = items.find((item) => item.value === value) ?? items[0]
  const active = value !== emptyValue

  return (
    <div className={`fdrop ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`fdrop-btn ${active ? 'on' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}：${current?.label ?? '—'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fdrop-k">{label}</span>
        <span className="fdrop-v">{current?.label ?? '—'}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className={`fdrop-menu ${align === 'right' ? 'right' : ''}`} role="listbox">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={item.value === value}
              className={`fdrop-opt ${item.value === value ? 'on' : ''}`}
              onClick={() => {
                onChange(item.value)
                setOpen(false)
              }}
            >
              <span className="fdrop-tick">{item.value === value ? '✓' : ''}</span>
              <span className="fdrop-text">{item.label}</span>
              {item.count !== undefined && <span className="fdrop-n">{item.count}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface MultiSelectProps extends BaseProps {
  value: readonly string[]
  onChange: (value: string[]) => void
}

/** 多选下拉（带勾选框）：几个可以叠加的布尔条件塞一处，省下三行 chip */
export function MultiSelect({ label, items, value, onChange, align = 'left' }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const ref = useDismiss(open, close)

  const picked = items.filter((item) => value.includes(item.value))
  const summary = picked.length === 0
    ? '不限'
    : picked.length === 1
      ? picked[0]?.label ?? '不限'
      : `${picked.length} 项`

  function toggle(next: string) {
    onChange(value.includes(next) ? value.filter((v) => v !== next) : [...value, next])
  }

  return (
    <div className={`fdrop ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`fdrop-btn ${picked.length > 0 ? 'on' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}：${summary}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fdrop-k">{label}</span>
        <span className="fdrop-v">{summary}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div className={`fdrop-menu ${align === 'right' ? 'right' : ''}`} role="listbox" aria-multiselectable="true">
          {items.map((item) => {
            const on = value.includes(item.value)
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={on}
                className={`fdrop-opt ${on ? 'on' : ''}`}
                onClick={() => toggle(item.value)}
              >
                <span className="fdrop-box">{on ? '✓' : ''}</span>
                <span className="fdrop-text">{item.label}</span>
                {item.count !== undefined && <span className="fdrop-n">{item.count}</span>}
              </button>
            )
          })}
          {picked.length > 0 && (
            <div className="fdrop-foot">
              <button type="button" className="fdrop-opt quiet" onClick={() => onChange([])}>清空</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
