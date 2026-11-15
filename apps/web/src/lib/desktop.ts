/**
 * 桌面端（Tauri）能力探测与命令封装。
 *
 * 纯 web 用法（浏览器打开 / npm start）下 window.__TAURI__ 不存在，
 * 授权 Gate 一律放行，设置页也不显示桌面端专属内容。
 */

export interface LicenseNone {
  status: 'none'
}

export interface LicenseOk {
  status: 'ok'
  licenseType: string
  /** null = 永久授权 */
  expiresAt: string | null
  daysRemaining: number | null
}

export interface LicenseExpired {
  status: 'expired'
  expiresAt?: string
  message?: string
}

export interface LicenseInvalid {
  status: 'invalid'
  message?: string
}

export interface LicenseError {
  status: 'error'
  code?: number
}

export type LicenseStatus = LicenseNone | LicenseOk | LicenseExpired | LicenseInvalid | LicenseError

export interface AgentSetupInfo {
  dataDir: string
  skillsDir: string
  mcpEntry: string
  serverBin: string
  port: number
}

interface TauriCoreApi {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
}

interface TauriShellApi {
  open: (url: string) => Promise<void>
}

interface TauriGlobal {
  __TAURI__?: {
    core?: TauriCoreApi
    shell?: TauriShellApi
  }
}

function tauri(): TauriGlobal['__TAURI__'] | undefined {
  return (window as unknown as TauriGlobal).__TAURI__
}

export function isDesktop(): boolean {
  return typeof tauri()?.core?.invoke === 'function'
}

export async function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = tauri()?.core
  if (!core) throw new Error('桌面端环境不可用')
  return core.invoke<T>(cmd, args)
}

/** 打开外部链接：桌面端走系统浏览器，纯 web 退化为新标签页。 */
export async function openExternal(url: string): Promise<void> {
  const shell = tauri()?.shell
  if (shell?.open) {
    await shell.open(url)
    return
  }
  window.open(url, '_blank', 'noreferrer')
}

/* ------------------------------ 授权命令封装 ------------------------------ */

/** 启动即校验本地授权码；返回映射后的状态。 */
export async function verifyLicense(): Promise<LicenseStatus> {
  return mapLicenseStatus(await invokeDesktop('verify_license'))
}

export async function activateLicense(key: string): Promise<void> {
  await invokeDesktop('activate_license', { key })
}

export async function deactivateLicense(): Promise<void> {
  await invokeDesktop('deactivate_license')
}

export async function getSavedLicense(): Promise<{ key: string | null; activated: boolean }> {
  return invokeDesktop('get_saved_license')
}

export async function getRenewUrl(): Promise<string> {
  return invokeDesktop('get_renew_url')
}

/** 设置页「通过 Agent 连接」用的本机路径信息。 */
export async function getAgentSetupInfo(): Promise<AgentSetupInfo> {
  return invokeDesktop('get_agent_setup_info')
}

/**
 * 把 Rust verify_license 返回的 JSON 映射成前端状态。
 * 单独成纯函数是为了能单测：授权门禁的每种分支都不能靠手点回归。
 */
export function mapLicenseStatus(raw: unknown): LicenseStatus {
  const body = (raw ?? {}) as Record<string, unknown>
  switch (body.status) {
    case 'ok':
      return {
        status: 'ok',
        licenseType: String(body.licenseType ?? 'paid'),
        expiresAt: (body.expiresAt as string | null) ?? null,
        daysRemaining: (body.daysRemaining as number | null) ?? null,
      }
    case 'expired':
      return {
        status: 'expired',
        expiresAt: body.expiresAt as string | undefined,
        message: body.message as string | undefined,
      }
    case 'invalid':
      return { status: 'invalid', message: body.message as string | undefined }
    case 'error':
      return { status: 'error', code: body.code as number | undefined }
    default:
      return { status: 'none' }
  }
}

/** 临期提醒阈值：剩余天数 ≤7 且非永久授权时显示提醒条。 */
export function isNearExpiry(status: LicenseStatus, days = 7): status is LicenseOk {
  return status.status === 'ok' && status.daysRemaining !== null && status.daysRemaining <= days
}
