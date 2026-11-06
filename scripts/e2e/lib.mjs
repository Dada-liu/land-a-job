/**
 * 端到端测试共用工具。
 *
 * 每个阶段一个脚本，共用这套「隔离数据目录 + 真起服务 + 真开浏览器」的骨架：
 * - 数据目录用临时目录（LAND_DATA_DIR），绝不碰用户自己的 data/；
 * - 端口从 4410 起递增，避免与正在跑的开发服务抢 4399；
 * - 断言失败立即退出并打印上下文，不做「尽力而为」式的软断言。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

export function findChrome() {
  const fromEnv = process.env.LAND_CHROME
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!found) throw new Error('找不到本机 Chrome，设置 LAND_CHROME 后重试')
  return found
}

let passed = 0
const failures = []

export function ok(condition, message, detail) {
  if (condition) {
    passed += 1
    process.stdout.write(`  ✓ ${message}\n`)
    return
  }
  const suffix = detail === undefined ? '' : `\n      实际：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
  failures.push(`${message}${suffix}`)
  process.stdout.write(`  ✗ ${message}${suffix}\n`)
}

export function eq(actual, expected, message) {
  ok(actual === expected, message, `期望 ${JSON.stringify(expected)}，得到 ${JSON.stringify(actual)}`)
}

export function section(name) {
  process.stdout.write(`\n▶ ${name}\n`)
}

export function summary(name) {
  process.stdout.write('\n' + '─'.repeat(56) + '\n')
  if (failures.length === 0) {
    process.stdout.write(`${name} 通过：${passed} 项断言\n`)
    return 0
  }
  process.stdout.write(`${name} 失败 ${failures.length} 项（通过 ${passed} 项）\n`)
  for (const failure of failures) process.stdout.write(`  · ${failure}\n`)
  return 1
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 起一个隔离的服务实例；返回句柄与 API 客户端 */
export async function startServer({ port = 4410, seed = false, env = {} } = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'land-e2e-'))
  const child = spawn(process.execPath, [path.join(ROOT, 'apps/server/dist/index.js')], {
    env: { ...process.env, LAND_DATA_DIR: dataDir, LAND_PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  let token = ''
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${base}/api/health`)
      if (health.ok) {
        token = readFileSync(path.join(dataDir, '.token'), 'utf8').trim()
        break
      }
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  if (!token) {
    child.kill('SIGKILL')
    throw new Error(`服务未在 20s 内启动：\n${output}`)
  }

  if (seed) {
    await new Promise((resolve, reject) => {
      const seedProcess = spawn(process.execPath, [path.join(ROOT, 'apps/server/dist/seed.js')], {
        env: { ...process.env, LAND_DATA_DIR: dataDir, LAND_PORT: String(port) },
        stdio: 'ignore',
      })
      seedProcess.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed 退出码 ${code}`))))
    })
  }

  const request = async (method, endpoint, body) => {
    const response = await fetch(`${base}/api${endpoint}`, {
      method,
      headers: { 'x-land-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    const payload = text ? JSON.parse(text) : null
    if (!response.ok) {
      const error = new Error(`${method} ${endpoint} → ${response.status} ${payload?.error?.code ?? ''} ${payload?.error?.message ?? ''}`)
      error.status = response.status
      error.payload = payload
      throw error
    }
    return payload?.data
  }

  const api = {
    get: (endpoint) => request('GET', endpoint),
    post: (endpoint, body) => request('POST', endpoint, body ?? {}),
    patch: (endpoint, body) => request('PATCH', endpoint, body ?? {}),
    delete: (endpoint, body) => request('DELETE', endpoint, body),
    /** 期望失败的请求：返回 { status, code } 而不是抛错 */
    expectFail: async (method, endpoint, body) => {
      try {
        await request(method, endpoint, body)
        return { status: 200, code: 'OK' }
      } catch (error) {
        return { status: error.status, code: error.payload?.error?.code }
      }
    },
  }

  return {
    base,
    dataDir,
    token,
    api,
    output: () => output,
    async stop() {
      child.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 300))
      child.kill('SIGKILL')
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export async function launchBrowser() {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
  })
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  return { browser, page, consoleErrors }
}

/** 打开页面并等到「不再是加载态」：以出现指定选择器为准 */
export async function openPage(page, url, selector, timeout = 15_000) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(selector, { timeout })
}

export async function text(page, selector) {
  return page.$eval(selector, (element) => element.textContent?.trim() ?? '')
}

export async function count(page, selector) {
  return page.$$eval(selector, (elements) => elements.length).catch(() => 0)
}

/** 拖拽：dnd-kit 需要连续 pointermove，直接 mouse.move 会触发不了 */
export async function dragTo(page, sourceSelector, targetSelector) {
  const source = await page.$(sourceSelector)
  const target = await page.$(targetSelector)
  if (!source || !target) throw new Error(`拖拽元素不存在：${sourceSelector} → ${targetSelector}`)
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('无法取得拖拽元素坐标')

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // 先走一小段触发 activationConstraint(distance: 4)
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 })
  const steps = 14
  for (let index = 1; index <= steps; index += 1) {
    await page.mouse.move(
      from.x + from.width / 2 + ((to.x + to.width / 2 - from.x - from.width / 2) * index) / steps,
      from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * index) / steps,
    )
    await sleep(16)
  }
  await page.mouse.up()
  await sleep(400)
}

/**
 * 选一个自定义下拉的值。
 *
 * 全站下拉已从原生 `<select>` 换成 button + listbox（原因见 apps/web/src/components/ui.tsx），
 * 而 `page.select()` 只能操作原生控件，所以这里点两下：触发器 → 带 data-value 的选项。
 * 断言当前值时用 pickValue()，不要去读 el.value（按钮上没有这个属性）。
 */
export async function pick(page, trigger, value) {
  await page.click(trigger)
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 })
  const found = await page.evaluate((wanted) => {
    const option = [...document.querySelectorAll('[role="option"]')].find((node) => node.dataset.value === wanted)
    option?.click()
    return Boolean(option)
  }, String(value))
  if (!found) throw new Error(`下拉 ${trigger} 里没有 value=${JSON.stringify(String(value))} 的选项`)
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'), { timeout: 5000 })
}

/** 读自定义下拉的当前值：触发器上的 data-value（与原生 select 的 el.value 等价） */
export async function pickValue(page, trigger) {
  return page.$eval(trigger, (element) => element.dataset.value ?? '')
}

/**
 * 往受控输入框里填值。
 *
 * 不用 `page.type()`：它按字符敲，先要清空原值，而受控输入在三击全选后经常拿不到选区
 * （React 重渲染会把 selection 打回光标位），结果新旧值首尾相连。
 * 这里走原生 value setter + input 事件，React 的 onChange 能正常收到，等价于用户粘贴。
 */
export async function fill(page, selector, value) {
  await page.$eval(
    selector,
    (element, next) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      setter?.call(element, next)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    },
    String(value),
  )
  await sleep(120)
}
