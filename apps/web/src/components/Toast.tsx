import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** 轻量提示条：不做动画库、不做队列去重，够用就行 */
export interface ToastItem {
  id: number
  kind: 'info' | 'error' | 'success'
  message: string
}

interface ToastApi {
  push: (message: string, kind?: ToastItem['kind']) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, message }])
    // 错误留久一点，用户需要看清"为什么失败"
    const ttl = kind === 'error' ? 6000 : 3000
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), ttl)
  }, [])

  const api = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={[
              'pointer-events-auto max-w-lg rounded-lg border px-3.5 py-2 text-xs shadow-sm',
              item.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : item.kind === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-stone-200 bg-white text-stone-700',
            ].join(' ')}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用')
  return context
}

/** 把 unknown 错误转成一句人能读的话（ApiError 已带 message） */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
