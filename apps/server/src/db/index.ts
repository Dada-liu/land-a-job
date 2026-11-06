import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { migrate } from './migrate.js'

export type Db = Database.Database

/**
 * 打开本地库并执行迁移。
 *
 * WAL 让「读看板」与「写事件」互不阻塞；busy_timeout 容忍 MCP 与页面短时并发。
 * 注意：PRAGMA journal_mode 不能在事务中切换，所以放在迁移之前。
 */
export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number
}

export function countTables(db: Db): number {
  const row = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get() as { n: number } | undefined
  return row?.n ?? 0
}
