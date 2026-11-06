import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openDb } from '../src/db/index.js'
import { TABLES, columnList, columnOf, fieldList, type TableName } from '../src/db/tables.js'

const dir = mkdtempSync(path.join(tmpdir(), 'land-schema-'))
const db = openDb(path.join(dir, 'land.db'))

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * 这张测试是「DDL 与映射表漂移」的唯一防线：
 * 迁移里加了列但没登记到 TABLES → 该列永远读不出来，
 * 而且不会有任何报错，只会在某天发现「这个字段怎么是空的」。
 */
describe('表结构映射与 DDL 一致', () => {
  const names = Object.keys(TABLES) as TableName[]

  it.each(names)('%s 的列与映射表完全一致', (name) => {
    const spec = TABLES[name]
    const actual = (db.pragma(`table_info(${spec.table})`) as { name: string }[])
      .map((c) => c.name)
      .sort()
    const mapped = fieldList(spec)
      .map((key) => columnOf(spec, key))
      .sort()
    expect(mapped).toEqual(actual)
  })

  it('库里没有未被映射的表', () => {
    const actual = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort()
    const mapped = names.map((n) => TABLES[n].table).sort()
    expect(mapped).toEqual(actual)
  })

  it('columnList 生成的 SQL 片段可直接用于 SELECT', () => {
    for (const name of names) {
      const spec = TABLES[name]
      expect(() => db.prepare(`SELECT ${columnList(spec)} FROM ${spec.table} LIMIT 1`).all()).not.toThrow()
    }
  })
})

describe('迁移', () => {
  it('schema 版本号已推进', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('002 迁移给岗位补上了采集来源列', () => {
    const columns = (db.pragma('table_info(job)') as { name: string }[]).map((column) => column.name)
    expect(columns).toContain('jd_source')
  })

  it('重复执行迁移是幂等的（二次打开不报错）', () => {
    expect(() => openDb(path.join(dir, 'land.db')).close()).not.toThrow()
  })

  it('WAL 与外部键约束已开启', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
