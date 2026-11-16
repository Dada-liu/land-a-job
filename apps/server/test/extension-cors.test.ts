import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type LandApp } from '../src/app.js'
import { parseExtensionOrigins } from '../src/extension-cors.js'

const ORIGIN = `chrome-extension://${'a'.repeat(32)}`
const TOKEN = 'cors-test-token'
const dir = mkdtempSync(path.join(tmpdir(), 'land-cors-'))
let enabled: LandApp
let disabled: LandApp

beforeAll(async () => {
  const base = {
    token: TOKEN,
    port: 4399,
    webRoot: null,
    logger: false as const,
  }
  enabled = await buildApp({
    ...base,
    dbFile: path.join(dir, 'enabled.db'),
    extensionOrigins: new Set([ORIGIN]),
  })
  disabled = await buildApp({
    ...base,
    dbFile: path.join(dir, 'disabled.db'),
    extensionOrigins: new Set(),
  })
})

afterAll(async () => {
  await enabled.close()
  await disabled.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('扩展 CORS 白名单解析', () => {
  it('接受裸扩展 ID 与完整源，拒绝其它来源', () => {
    const parsed = parseExtensionOrigins(`${'a'.repeat(32)}, chrome-extension://${'b'.repeat(32)}, https://evil.example, junk`)
    expect([...parsed]).toEqual([ORIGIN, `chrome-extension://${'b'.repeat(32)}`])
  })

  it('空值返回空集合（功能默认关闭）', () => {
    expect(parseExtensionOrigins(undefined).size).toBe(0)
    expect(parseExtensionOrigins('  ,  ').size).toBe(0)
  })
})

describe('白名单开启时', () => {
  it('OPTIONS 预检直接 204，并只放行指定头与方法', async () => {
    const res = await enabled.app.inject({
      method: 'OPTIONS',
      url: '/api/jobs',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-land-token,content-type',
      },
    })
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
    expect(res.headers['access-control-allow-headers']).toBe('x-land-token,content-type')
    expect(res.headers['access-control-allow-methods']).toContain('POST')
  })

  it('正常响应带白名单源', async () => {
    const res = await enabled.app.inject({ method: 'GET', url: '/api/health', headers: { origin: ORIGIN } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN)
  })

  it('令牌校验没有被 CORS 绕过', async () => {
    const noToken = await enabled.app.inject({
      method: 'GET', url: '/api/jobs', headers: { origin: ORIGIN },
    })
    expect(noToken.statusCode).toBe(401)

    const withToken = await enabled.app.inject({
      method: 'GET', url: '/api/jobs', headers: { origin: ORIGIN, 'x-land-token': TOKEN },
    })
    expect(withToken.statusCode).toBe(200)
    expect(withToken.headers['access-control-allow-origin']).toBe(ORIGIN)
  })

  it('非白名单源不拿到 CORS 头，预检仍被鉴权拦截', async () => {
    const other = `chrome-extension://${'c'.repeat(32)}`
    const preflight = await enabled.app.inject({ method: 'OPTIONS', url: '/api/jobs', headers: { origin: other } })
    expect(preflight.statusCode).toBe(401)
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()

    const plain = await enabled.app.inject({
      method: 'GET', url: '/api/health', headers: { origin: other },
    })
    expect(plain.headers['access-control-allow-origin']).toBeUndefined()
  })
})

describe('白名单关闭时（默认）', () => {
  it('行为与改造前一致：无 CORS 头，预检被 401 拦下', async () => {
    const preflight = await disabled.app.inject({ method: 'OPTIONS', url: '/api/jobs', headers: { origin: ORIGIN } })
    expect(preflight.statusCode).toBe(401)
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()

    const plain = await disabled.app.inject({ method: 'GET', url: '/api/health', headers: { origin: ORIGIN } })
    expect(plain.statusCode).toBe(200)
    expect(plain.headers['access-control-allow-origin']).toBeUndefined()
  })
})
