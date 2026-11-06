import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 右侧抽屉。
 *
 * 用 portal 挂到 body：看板容器有 overflow 滚动，抽屉放在里面会被裁掉；
 * Esc 关闭是必须的——用户拖完卡片手还在键盘上，不该逼他去找 ×。
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'w-[520px]',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  width?: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/20 backdrop-blur-[1px]"
      />
      <aside className={`relative flex h-full max-w-full flex-col bg-white shadow-2xl ${width}`}>
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-stone-900">{title}</div>
            {subtitle ? <div className="mt-0.5 truncate text-[11px] text-stone-500">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            aria-label="关闭抽屉"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t border-stone-200 px-5 py-3">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  )
}
