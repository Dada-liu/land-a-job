import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_LAYOUT, SERVICE_NAME, VERSION } from '@land/core'

export { SERVICE_NAME, VERSION }

/** 源码在 apps/server/src、产物在 apps/server/dist，向上三级都是仓库根 */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

export const DATA_DIR = process.env.LAND_DATA_DIR
  ? path.resolve(process.env.LAND_DATA_DIR)
  : path.join(REPO_ROOT, 'data')

export const DB_FILE = path.join(DATA_DIR, DATA_LAYOUT.db)
export const PORT_FILE = path.join(DATA_DIR, DATA_LAYOUT.portFile)
export const TOKEN_FILE = path.join(DATA_DIR, DATA_LAYOUT.tokenFile)
export const FILES_DIR = path.join(DATA_DIR, DATA_LAYOUT.files)
export const SNAPSHOT_DIR = path.join(DATA_DIR, DATA_LAYOUT.snapshots)
export const LOG_DIR = path.join(DATA_DIR, DATA_LAYOUT.logs)

/** 仅监听本机，不做对外暴露（PRD D1） */
export const HOST = '127.0.0.1'

export const DEFAULT_PORT = Number.parseInt(process.env.LAND_PORT ?? '', 10) || 4399

export const APP_VERSION = VERSION

/** Web 构建产物；缺失时页面会给出构建提示而不是 404 */
export const WEB_ROOT = path.join(REPO_ROOT, 'apps', 'web', 'dist')

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, LOG_DIR, SNAPSHOT_DIR, path.join(FILES_DIR, 'jd'), path.join(FILES_DIR, 'evidence')]) {
    mkdirSync(dir, { recursive: true })
  }
}
