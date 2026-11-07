#!/usr/bin/env node
/**
 * 英文字典的静态校验。
 *
 * 为什么需要它：字典以「中文原文」为 key，任何一处中文文案改了字、而字典没跟着改，
 * 翻译就会静默失效——界面不会报错，只是那一句突然变回中文。这类问题只能靠静态检查抓。
 *
 * 检查项：
 *  1. 片段之间有重复 key（后者会覆盖前者，属于真 bug）
 *  2. 源码里 `t('中文')` 的实参在字典里不存在（硬错误）
 *  3. 字典值里残留中文（硬错误）
 *  4. 字典里可能已经用不到的 key（只提示，不失败——服务端在运行时拼出的句子
 *     本来就不会原样出现在前端源码里）
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WEB_SRC = join(ROOT, 'apps/web/src')
const EN_DIR = join(WEB_SRC, 'i18n/en')
const CJK = /[\u3400-\u9fff]/

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * 从 `  'key': 'value',` / `  key: 'value',` 里取 key。
 * 逐行解析而不是整文件正则：`[^:]` 会吃换行，把注释和下一个字典项粘成一个假 key。
 * 长值另起一行时 rest 为空，值检查跳过那一条（key 仍然登记）。
 */
function dictEntries(file) {
  const entries = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^ {2}(?:'([^']+)'|([^\s:'][^:]*?)):[ \t]*(.*)$/.exec(line)
    if (!match) continue
    const key = (match[1] ?? match[2]).trim()
    if (!key || key.startsWith('//') || key.startsWith('/*')) continue
    const rest = match[3]
    const value = rest.startsWith("'") ? rest.slice(1, rest.lastIndexOf("'")) : ''
    entries.push({ key: key.replace(/\\'/g, "'"), value })
  }
  return entries
}

const fragments = readdirSync(EN_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts')
const keys = new Map()
const duplicates = []
const badValues = []
for (const file of fragments) {
  for (const { key, value } of dictEntries(join(EN_DIR, file))) {
    if (keys.has(key)) duplicates.push(`${key} ← ${keys.get(key)} / ${file}`)
    else keys.set(key, file)
    if (CJK.test(value)) badValues.push(`${file}: ${key} → ${value}`)
  }
}

// 源码里的显式 t('…') 调用
const sources = walk(WEB_SRC).filter((f) => !f.includes('/i18n/'))
const allText = sources.map((f) => readFileSync(f, 'utf8')).join('\n')
const missing = new Set()
for (const file of sources) {
  const src = readFileSync(file, 'utf8')
  for (const match of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const key = match[1].replace(/\\'/g, "'")
    if (CJK.test(key) && !keys.has(key)) missing.add(`${relative(ROOT, file)}: ${key}`)
  }
}

const unused = [...keys.keys()].filter((key) => !/\{\w+\}/.test(key) && !allText.includes(key))

console.log(`i18n: ${keys.size} keys across ${fragments.length} fragments`)
console.log(`  duplicate keys : ${duplicates.length}`)
console.log(`  missing t()    : ${missing.size}`)
console.log(`  CJK in values  : ${badValues.length}`)
console.log(`  possibly unused: ${unused.length} (informational)`)
for (const line of duplicates) console.log(`  ✗ duplicate ${line}`)
for (const line of missing) console.log(`  ✗ missing   ${line}`)
for (const line of badValues) console.log(`  ✗ value     ${line}`)
if (unused.length > 0) console.log(`  · e.g. ${unused.slice(0, 6).join(' / ')}`)

if (duplicates.length || missing.size || badValues.length) process.exit(1)
