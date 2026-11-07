import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './ui'
import { useT } from '../i18n'

/**
 * 二次确认。
 *
 * 为什么不用 window.confirm：它是浏览器原生弹窗，样式不可控、在 macOS 上还会挂在
 * 页面外面（Electron/IAB 里更是直接不显示），而且无法说明「删了会一起删掉什么」。
 * 这里统一成页面内弹窗，文案、按钮颜色（危险动作实心红）都由我们决定。
 *
 * 用法：`const confirm = useConfirm()` → `if (!(await confirm({...}))) return`。
 * Promise 化让调用点可以保持线性的「问一句，然后继续原逻辑」写法。
 */

export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((confirmed: boolean) => void) | null>(null)
  const t = useT()

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolver.current
    resolver.current = null
    setRequest(null)
    resolve?.(confirmed)
  }, [])

  const confirm = useCallback<ConfirmFn>((options) => {
    // 上一次还没答完就又弹了一次：按「取消」结算，避免 Promise 永远挂着
    resolver.current?.(false)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setRequest(options)
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={Boolean(request)}
        onClose={() => settle(false)}
        testId="confirm-dialog"
        width="max-w-md"
        title={request?.title ?? ''}
        footer={
          <div className="flex justify-end gap-2">
            <Button data-testid="confirm-cancel" onClick={() => settle(false)}>
              {request?.cancelText ?? t('取消')}
            </Button>
            <Button
              data-testid="confirm-accept"
              variant={request?.danger ? 'danger-solid' : 'primary'}
              onClick={() => settle(true)}
            >
              {request?.confirmText ?? t('确认')}
            </Button>
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-stone-600">
          {request?.description ?? (request?.danger ? t('此操作不可撤销，请确认。') : t('请确认是否继续。'))}
        </p>
      </Modal>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm 必须在 ConfirmProvider 内使用')
  return context
}
