import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isDesktop, isNearExpiry, verifyLicense, getRenewUrl, openExternal, type LicenseStatus } from '../lib/desktop'
import LicenseActivate from './LicenseActivate'

/**
 * 桌面端授权门禁。
 *
 * 行为约定（对应商城授权接入的产品决策）：
 * - 纯 web 用法（浏览器打开）直接放行，没有任何授权 UI；
 * - 桌面端启动即联网校验本地授权码：
 *   - ok → 直接进应用，不展示任何常驻授权 UI；
 *   - ok 但临期（≤7 天）→ 顶部可关闭提醒条 + 续费入口；
 *   - none / invalid / expired / error → 激活页（error 提示检查网络，不放行）。
 * - 首次激活成功后同样不再展示授权 UI。
 */
export default function LicenseGate({ children }: { children: ReactNode }) {
  const desktop = isDesktop()
  const [status, setStatus] = useState<LicenseStatus | null>(null)

  const recheck = useCallback(() => {
    if (!desktop) return
    verifyLicense()
      .then(setStatus)
      .catch(() => setStatus({ status: 'error' }))
  }, [desktop])

  useEffect(() => {
    recheck()
  }, [recheck])

  if (!desktop) return <>{children}</>

  // 首次校验完成前不闪主界面，也不闪激活页
  if (status === null) {
    return <div className="flex min-h-screen items-center justify-center bg-stone-100 text-sm text-stone-400">正在校验授权…</div>
  }

  if (status.status !== 'ok') {
    return <LicenseActivate status={status} onActivated={recheck} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isNearExpiry(status) ? <ExpiryBanner days={status.daysRemaining ?? 0} /> : null}
      {children}
    </div>
  )
}

function ExpiryBanner({ days }: { days: number }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
      <span>
        授权将于 {days} 天后到期
        <button
          type="button"
          onClick={() => void getRenewUrl().then(openExternal)}
          className="ml-2 underline decoration-amber-300 underline-offset-2 hover:text-amber-950"
        >
          去续费
        </button>
      </span>
      <button
        type="button"
        aria-label="关闭提醒"
        onClick={() => setDismissed(true)}
        className="rounded p-0.5 text-amber-700 hover:bg-amber-100 hover:text-amber-900"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
