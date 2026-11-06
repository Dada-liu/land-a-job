import { readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { SERVICE_NAME, VERSION } from './config.js'
import { schemaVersion, type Db } from './db/index.js'
import { TABLES } from './db/tables.js'

/**
 * 快照与全库导出（P7-6 / D1）。
 *
 * 单用户本地部署没有备份服务，能依靠的只有两件事：
 * 1. 一个滚动的快照（保留 7 份），挡住「手滑删了」「迁移跑挂了」；
 * 2. 一份全库 JSON，用于换机器时手动迁移。
 *
 * 快照用 `db.backup()` 而不是 `cp`：WAL 模式下主文件随时可能是「半个事务」，
 * 直接复制会得到一打开就报 malformed 的库——这种备份比没有备份更坏，因为它看起来成功了。
 */

export const SNAPSHOT_KEEP = 7

const PREFIX = 'land-'
const SUFFIX = '.db'

export interface SnapshotInfo {
  file: string
  /** 文件名里的时间戳（ISO） */
  createdAt: string
  bytes: number
}

function stamp(now: Date): string {
  // 2026-11-05T09-30-00-123：带毫秒，名字可排序 = 可按时间清理；
  // 只到秒的话「连点两次备份」会撞名，靠加序号反而破坏排序语义
  return now.toISOString().replace(/[:.]/g, '-').replace('Z', '').slice(0, 23)
}

function parseStamp(file: string): string {
  const raw = file.slice(PREFIX.length, -SUFFIX.length)
  // 文件名里没有 ':'，还原成 ISO 只为了给人看
  const iso = raw.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/, 'T$1:$2:$3.$4Z')
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString()
}

export function listSnapshots(dir: string): SnapshotInfo[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.startsWith(PREFIX) && name.endsWith(SUFFIX))
    .map((name) => {
      const file = path.join(dir, name)
      const info = statSync(file)
      return { file, createdAt: parseStamp(name), bytes: info.size }
    })
    // 文件名带时间戳且补零，字典序 = 时间序；按 size 排会随写入波动
    .sort((a, b) => b.file.localeCompare(a.file))
}

export interface SnapshotResult extends SnapshotInfo {
  kept: number
  removed: string[]
}

/** 建一个快照并只保留最近 `keep` 份 */
export async function createSnapshot(db: Db, dir: string, keep = SNAPSHOT_KEEP): Promise<SnapshotResult> {
  const now = new Date()
  const file = path.join(dir, `${PREFIX}${stamp(now)}${SUFFIX}`)
  // 同一秒内连点两次：加序号，绝不覆盖已有快照
  const existing = new Set(listSnapshots(dir).map((item) => item.file))
  let target = file
  let index = 1
  while (existing.has(target)) {
    target = file.replace(SUFFIX, `-${index}${SUFFIX}`)
    index += 1
  }

  await db.backup(target)

  const all = listSnapshots(dir)
  const removed: string[] = []
  for (const snapshot of all.slice(keep)) {
    try {
      unlinkSync(snapshot.file)
      removed.push(snapshot.file)
    } catch {
      // 删不掉（权限/被占用）不该让「备份成功」变成失败：已经有一份可用快照了
    }
  }

  return {
    file: target,
    createdAt: now.toISOString(),
    bytes: statSync(target).size,
    kept: Math.min(all.length, keep),
    removed,
  }
}

export interface ExportDump {
  exportedAt: string
  app: { service: string; version: string; schemaVersion: number }
  /** 每张表的行数，方便对照「导出的是不是完整的」 */
  counts: Record<string, number>
  tables: Record<string, unknown[]>
}

/**
 * 全库导出。
 *
 * 导出的是**原始列**而不是 DTO：DTO 会丢掉 deleted_at、provenance 之外的内部字段，
 * 拿它当迁移源会在新机器上丢历史（软删记录、事件 actor/source）。
 */
export function exportAll(db: Db, now = new Date()): ExportDump {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}

  for (const spec of Object.values(TABLES)) {
    const rows = db.prepare(`SELECT * FROM ${spec.table}`).all() as unknown[]
    tables[spec.table] = rows
    counts[spec.table] = rows.length
  }

  return {
    exportedAt: now.toISOString(),
    app: { service: SERVICE_NAME, version: VERSION, schemaVersion: schemaVersion(db) },
    counts,
    tables,
  }
}
