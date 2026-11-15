import { useEffect, useState } from 'react'
import { Button, Card, Input } from './ui'
import { useConfirm } from './ConfirmDialog'
import { useToast, errorText } from './Toast'
import {
  getSavedLicense,
  activateLicense,
  deactivateLicense,
  getRenewUrl,
  openExternal,
  type LicenseStatus,
} from '../lib/desktop'

/**
 * 授权激活页（桌面端首次启动 / 授权失效时出现）。
 *
 * 视觉与全应用一致：stone 底色 + 居中 Card + ui.tsx 的 Input/Button。
 * 激活成功后通过 onActivated 通知 Gate 重新校验，进入主界面；
 * 此后不再展示任何授权 UI（临期提醒条除外，见 LicenseGate）。
 */
export default function LicenseActivate({
  status,
  onActivated,
}: {
  status: LicenseStatus
  onActivated: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [key, setKey] = useState('')
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [renewUrl, setRenewUrl] = useState('')
  const [busy, setBusy] = useState<'activate' | 'deactivate' | null>(null)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    getSavedLicense()
      .then((saved) => setSavedKey(saved.key))
      .catch(() => {})
    getRenewUrl()
      .then(setRenewUrl)
      .catch(() => {})
  }, [])

  const submit = async () => {
    setFormError('')
    setBusy('activate')
    try {
      await activateLicense(key)
      toast.push('激活成功', 'success')
      onActivated()
    } catch (error) {
      // 服务端把「码不存在 / 已绑定其他设备 / 已到期」统一放在 message 里
      setFormError(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const deactivate = async () => {
    if (!(await confirm({ title: '解绑本设备？', description: '解绑后这台电脑将停止使用授权，授权码可以在其它设备上激活。', confirmText: '解绑', danger: true }))) {
      return
    }
    setBusy('deactivate')
    try {
      await deactivateLicense()
      setSavedKey(null)
      setKey('')
      toast.push('已解绑本设备', 'success')
      // 让 Gate 重新校验：status 从 expired/invalid 回到 none，清掉到期提示
      onActivated()
    } catch (error) {
      toast.push(`解绑失败：${errorText(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const statusHint = (() => {
    switch (status.status) {
      case 'expired':
        return status.message ?? '授权已到期'
      case 'invalid':
        return status.message ?? '授权码无效'
      case 'error':
        return '无法连接授权服务器，请检查网络后重试'
      default:
        return ''
    }
  })()

  const masked = savedKey
    ? savedKey.length > 8
      ? `${savedKey.slice(0, 9)}****${savedKey.slice(-4)}`
      : '****'
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-stone-900">激活 Land a Job</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-stone-500">
            输入购买后获得的授权码即可开始使用。没有授权码？
            {renewUrl ? (
              <button
                type="button"
                onClick={() => void openExternal(renewUrl)}
                className="text-stone-700 underline decoration-stone-300 underline-offset-2 hover:text-stone-900"
              >
                去商城购买
              </button>
            ) : null}
          </p>
        </div>

        {masked ? (
          <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-600">
            本机已保存授权码 <span className="font-mono">{masked}</span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void deactivate()}
              className="ml-2 text-red-600 underline decoration-red-200 underline-offset-2 hover:text-red-700"
            >
              {busy === 'deactivate' ? '解绑中…' : '解绑本设备'}
            </button>
          </div>
        ) : null}

        {statusHint ? (
          <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            {statusHint}
          </p>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (key.trim() && busy === null) void submit()
          }}
        >
          <Input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="font-mono tracking-wide"
            autoFocus
          />
          {formError ? <p className="text-[12px] text-red-600">{formError}</p> : null}
          <Button type="submit" variant="primary" className="w-full" disabled={busy !== null || !key.trim()}>
            {busy === 'activate' ? '激活中…' : '激活'}
          </Button>
        </form>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-stone-400">
          授权码与当前设备绑定（一机一码）；换电脑请先在原设备解绑。
        </p>
      </Card>
    </div>
  )
}
