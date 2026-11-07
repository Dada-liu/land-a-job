import { clampWeeklyTarget, type SettingsPatch } from '@land/core'
import type { Db } from '../index.js'

/**
 * 本机偏好（settings 表：一行一个 key/value）。
 *
 * 只放「用户自己在界面上调过的偏好」：不是业务数据，所以没有 provenance、
 * 没有软删、也没有乐观锁——单人单机，最后点的那个就是他要的。
 * 读的时候一律经过 `clampWeeklyTarget()`：这张表是纯文本，能被人手改，
 * 也能被导出的 JSON 直接写回来。
 */
const WEEKLY_TARGET_KEY = 'weeklyTarget'

export interface AppSettings {
  /** 本周有效投递目标（北极星的分母） */
  weeklyTarget: number
}

function readRaw(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function writeRaw(db: Db, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function readSettings(db: Db): AppSettings {
  const raw = readRaw(db, WEEKLY_TARGET_KEY)
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10)
  return { weeklyTarget: clampWeeklyTarget(parsed) }
}

export function writeSettings(db: Db, patch: SettingsPatch): AppSettings {
  if (patch.weeklyTarget !== undefined) writeRaw(db, WEEKLY_TARGET_KEY, String(patch.weeklyTarget))
  return readSettings(db)
}
