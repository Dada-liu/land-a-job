import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * 轻量提示条：不做动画库、不做队列去重，够用就行。
 *
 * 位置固定在**页面顶部**。之前底部/顶部分两套，结果是「删除这条投递」这类操作
 * 的结论贴着窗口底边弹出来，用户点完按钮（尤其在右侧抽屉里）根本扫不到，
 * 以为没生效。全局提示只有一处落点最不容易被忽略，也没必要让用户去猜哪条在哪儿。
 */
export interface ToastItem {
  id: number
  kind: 'info' | 'error' | 'success'
  message: string
}

interface ToastApi {
  push: (message: string, kind?: ToastItem['kind']) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const KIND_STYLES: Record<ToastItem['kind'], string> = {
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  info: 'border-stone-200 bg-white text-stone-700',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, message }])
    // 错误留久一点，用户需要看清"为什么失败"（多半还要回去改操作）
    const ttl = kind === 'error' ? 8000 : 3000
    setTimeout(() => setItems((prev) => prev.filter((item) => item.id !== id)), ttl)
  }, [])

  const api = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        data-toast
        className={[
          'pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4',
          // 落在顶栏（h-14）下面，不盖住页面标题与状态
          'top-[4.5rem]',
          // 桌面端侧栏占 224px（lg:static），固定定位不受它影响，补 padding 才在内容区居中
          'lg:pl-56',
        ].join(' ')}
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={[
              'pointer-events-auto max-w-lg rounded-lg border px-3.5 py-2 text-xs leading-relaxed shadow-md',
              KIND_STYLES[item.kind],
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
