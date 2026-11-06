import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 居中弹窗。与 Drawer 一样挂 portal 到 body（表格容器有 overflow，弹窗放里面会被裁），
 * Esc / 点遮罩都能关；内容区自己滚，头部与底部按钮始终可见。
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 'max-w-2xl',
  testId,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  width?: string
  testId?: string
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-stone-900/25 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="弹窗"
        data-testid={testId}
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl ${width}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
          <div className="min-w-0">
            <div data-testid={testId ? `${testId}-title` : undefined} className="truncate text-sm font-medium text-stone-900">
              {title}
            </div>
            {subtitle ? <div className="mt-0.5 text-[11px] leading-relaxed text-stone-500">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            aria-label="关闭弹窗"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-stone-200 px-5 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
