import { readFileSync } from 'node:fs'
import type { Db } from './index.js'

interface Migration {
  version: number
  name: string
}

/**
 * 迁移表用代码声明而不是扫目录：顺序明确、打包后也不依赖目录遍历。
 * 新增迁移时在末尾追加，version 必须递增且不回改。
 */
const MIGRATIONS: Migration[] = [
  { version: 1, name: '001_init' },
  { version: 2, name: '002_jd_source' },
]

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    const sql = readFileSync(new URL(`./migrations/${migration.name}.sql`, import.meta.url), 'utf8')
    db.transaction(() => {
      db.exec(sql)
      db.pragma(`user_version = ${migration.version}`)
    })()
  }
}
