/**
 * tsc 只编译 .ts，SQL 迁移文件需要单独搬运到 dist。
 */
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const from = path.resolve(here, '../src/db/migrations')
const to = path.resolve(here, '../dist/db/migrations')

await mkdir(to, { recursive: true })
await cp(from, to, { recursive: true })
console.log(`[copy-assets] ${path.relative(process.cwd(), from)} -> ${path.relative(process.cwd(), to)}`)
