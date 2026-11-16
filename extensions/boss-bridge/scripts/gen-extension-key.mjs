#!/usr/bin/env node
/**
 * 生成固定的 Chrome 扩展 key（manifest.key）并算出派生扩展 ID。
 *
 * 有了固定 ID，服务端的 LAND_EXTENSION_ORIGINS 白名单才是稳定值：
 *   LAND_EXTENSION_ORIGINS=<这里打印的 32 位 ID> npm run dev -w @land/server
 *
 * 私钥只留在本机 .env（已 gitignore），不要提交、不要分享。
 */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')

if (process.argv.includes('--force') === false) {
  try {
    if (/^WXT_EXTENSION_KEY=/m.test(readFileSync(envPath, 'utf8'))) {
      console.error('已存在 WXT_EXTENSION_KEY，未改动。确需重新生成请加 --force。')
      process.exit(1)
    }
  } catch { /* 还没有 .env */ }
}

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const der = publicKey.export({ type: 'spki', format: 'der' })
const key = der.toString('base64')
const extensionId = createHash('sha256')
  .update(der)
  .digest()
  .subarray(0, 16)
  .toString('hex')
  .split('')
  .map((hex) => String.fromCharCode(97 + Number.parseInt(hex, 16)))
  .join('')

let env = ''
try { env = readFileSync(envPath, 'utf8') } catch { /* 新建 */ }
if (env && !env.endsWith('\n')) env += '\n'
writeFileSync(envPath, `${env}WXT_EXTENSION_KEY=${key}\n`, { mode: 0o600 })

console.log(`扩展 ID：${extensionId}`)
console.log(`已写入 ${envPath} 的 WXT_EXTENSION_KEY`)
console.log(`\n启动服务端时设置：\n  LAND_EXTENSION_ORIGINS=${extensionId} npm run dev -w @land/server`)
