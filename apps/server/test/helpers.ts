import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp, type LandApp } from '../src/app.js'

export const TOKEN = 'test-token-0000'

export interface ApiResult<T = any> {
  status: number
  body: T
}

export interface TestApp extends LandApp {
  dir: string
  call: <T = any>(method: string, url: string, payload?: unknown) => Promise<ApiResult<T>>
}

/**
 * 每个用例一份独立临时库：测试之间不共享状态，也就不会因为执行顺序变化而红。
 * 静态托管关掉（webRoot: null），契约测试只关心 /api。
 */
export async function createTestApp(): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'land-test-'))
  const land = await buildApp({
    dbFile: path.join(dir, 'land.db'),
    token: TOKEN,
    port: 4399,
    webRoot: null,
    logger: false,
  })

  const call = async <T = any>(method: string, url: string, payload?: unknown): Promise<ApiResult<T>> => {
    const response = await land.app.inject({
      method: method as 'GET',
      url: url.startsWith('/api') ? url : `/api${url}`,
      headers: { 'x-land-token': TOKEN },
      ...(payload === undefined ? {} : { payload: payload as object }),
    })
    return {
      status: response.statusCode,
      body: (response.body ? JSON.parse(response.body) : null) as T,
    }
  }

  return Object.assign(land, { dir, call })
}

export async function destroyTestApp(app: TestApp): Promise<void> {
  await app.close()
  rmSync(app.dir, { recursive: true, force: true })
}

export const ISO = (offsetDays = 0): string => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString()
}
