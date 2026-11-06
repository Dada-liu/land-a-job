import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 令牌自举的行为约定（这是「dev 打开页面报 无法获取本机令牌（HTTP 502）」的根因所在）：
 * 1. 失败必须**很快拒绝**，不能把请求吊着——吊着页面就永远停在「读取中」，连错误都看不到；
 * 2. 失败结果不得被缓存，后端起来后同一个页面要能自己恢复，不需要硬刷新；
 * 3. 成功之后并发请求共用一次自举。
 *
 * 重试刻意不放在这里：react-query 自己会限次数重试，App 还会在健康检查恢复时作废重取。
 * api.ts 用的是相对路径 fetch，Node 里没有 origin，所以整段替换 globalThis.fetch。
 */
const TOKEN = 'a'.repeat(48)
let calls: string[] = []
let responses: (() => Response)[] = []

function queueResponse(factory: () => Response): void {
  responses.push(factory)
}

function ok(): Response {
  return new Response(JSON.stringify({ token: TOKEN }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function badGateway(): Response {
  return new Response('', { status: 502 })
}

beforeEach(() => {
  calls = []
  responses = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input))
    const next = responses.shift()
    // 队列空了就当作后端一直不可用
    return next ? next() : badGateway()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function freshApi() {
  vi.resetModules()
  return import('../src/lib/api')
}

describe('getToken', () => {
  it('拿到令牌后复用，不重复自举', async () => {
    const api = await freshApi()
    responses = [ok]

    const [first, second] = await Promise.all([api.getToken(), api.getToken()])
    expect(first).toBe(TOKEN)
    expect(second).toBe(TOKEN)
    expect(calls).toHaveLength(1)
  })

  it('502 时立刻拒绝，带上状态码与可读提示', async () => {
    const api = await freshApi()
    const started = Date.now()

    await expect(api.getToken()).rejects.toMatchObject({ status: 502, code: 'BOOTSTRAP_FAILED' })
    await expect(api.getToken()).rejects.toThrow(/无法获取本机令牌（HTTP 502）/)
    // 一次尝试、不重试：必须远快于任何「看起来像卡死」的量级
    expect(Date.now() - started).toBeLessThan(2_000)
    // 上面两次调用各自尝试一次：失败不缓存，所以第二次真的又发了一次
    expect(calls).toHaveLength(2)
  })

  it('失败不缓存：后端恢复后同一个页面能自愈', async () => {
    const api = await freshApi()

    await expect(api.getToken()).rejects.toBeInstanceOf(Error)
    responses = [ok]
    await expect(api.getToken()).resolves.toBe(TOKEN)
  })

  it('bootstrap 没返回令牌时算失败，不可当成空字符串继续用', async () => {
    const api = await freshApi()
    queueResponse(() => new Response(JSON.stringify({}), { status: 200 }))

    await expect(api.getToken()).rejects.toThrow(/未返回令牌/)
  })
})
