import { randomUUID } from 'node:crypto'
import path from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { DATA_LAYOUT } from '@land/core'
import { DATA_DIR, FILES_DIR } from '../config.js'
import { AppError, ConflictError, NotFoundError } from '../errors.js'
import { findChromeExecutable } from '../resume/export.js'
import { inspectForm, summarizeFields, type FieldInfo } from './inspect.js'
import { detectBlockers, type BlockerReport } from './guard.js'
import { fillForm, type FillResult } from './fill.js'
import { runSubmit } from './submit.js'

/**
 * 投递会话（P4-1）。
 *
 * 设计取舍：
 * - **单例**：同时开两个会话会抢同一个浏览器 profile（同一目录 Chrome 只允许一个实例），
 *   也让「当前正在填哪个岗位」变得含糊。要换岗位先关掉当前会话。
 * - **15 分钟空闲超时**：用户去泡杯咖啡回来发现浏览器自己关了，比留下一个僵尸 Chrome 进程好。
 * - **复用 user-data-dir**：登录态留在 data/browser-profile，下次投同站不用重新登录。
 */

const IDLE_TTL_MS = 15 * 60 * 1000

export type ApplyStatus = 'open' | 'filled' | 'blocked' | 'submitted' | 'closed'

export interface PublicApplySession {
  id: string
  jobId: string
  resumeId: string | null
  url: string
  status: ApplyStatus
  step: number
  fields: FieldInfo[]
  /** 需要人工处理的字段（文件上传等） */
  manualFields: string[]
  createdAt: string
  updatedAt: string
  blocker?: BlockerReport
  fillResults?: FillResult[]
  headless: boolean
}

interface Session extends PublicApplySession {
  browser: Browser
  page: Page
  lastTouched: number
}

const sessions = new Map<string, Session>()
let sweeper: NodeJS.Timeout | null = null

function ensureSweeper(): void {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (now - session.lastTouched > IDLE_TTL_MS) {
        void destroy(id, 'idle_timeout')
      }
    }
  }, 60_000)
  // 定时器不能拖住进程退出
  sweeper.unref()
}

function toPublic(session: Session): PublicApplySession {
  const { browser: _browser, page: _page, lastTouched: _lastTouched, ...rest } = session
  return rest
}

function touch(session: Session): void {
  session.lastTouched = Date.now()
  session.updatedAt = new Date().toISOString()
}

function aliveSession(): Session | null {
  for (const session of sessions.values()) {
    if (session.status !== 'closed') return session
  }
  return null
}

async function destroy(id: string, reason: string): Promise<void> {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  session.status = 'closed'
  session.updatedAt = new Date().toISOString()
  session.blocker = { blocked: false, reason }
  try {
    await session.browser.close()
  } catch {
    // 浏览器可能已被用户手动关掉，忽略
  }
}

/**
 * 取一个已经「挂上主 frame」的页面。
 *
 * 刚 launch 出来的浏览器再 newPage() 时，渲染进程还没完成 frame tree 初始化，
 * 紧接着 goto 会抛 `Requesting main frame too early!`。浏览器启动时本来就带一个
 * about:blank 页，复用它最稳；实在没有才新建。
 */
async function acquirePage(browser: Browser): Promise<Page> {
  const pages = await browser.pages()
  const blank = pages.find((item) => {
    try {
      return item.url() === 'about:blank'
    } catch {
      // 主 frame 还没挂上时 url() 会抛，这种页面直接跳过
      return false
    }
  })
  const page = blank ?? pages[0] ?? (await browser.newPage())
  page.setDefaultTimeout(30_000)
  return page
}

/** 导航重试：只对「frame 还没就绪」这类瞬时错误重试，真·打不开（域名错、证书错）直接抛 */
async function gotoWithRetry(page: Page, url: string): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (!/main frame too early|frame was detached|Session closed|Target closed/i.test(message)) throw error
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt))
    }
  }
  throw lastError
}

export async function openSession(input: {
  jobId: string
  resumeId?: string | null
  url: string
  headless?: boolean
}): Promise<PublicApplySession> {
  const existing = aliveSession()
  if (existing) {
    throw new ConflictError('已有进行中的投递会话，请先结束当前会话再开新的', {
      sessionId: existing.id,
      jobId: existing.jobId,
      url: existing.url,
    })
  }

  const executablePath = findChromeExecutable()
  if (!executablePath) {
    throw new AppError('CHROME_NOT_FOUND', '找不到本机 Chrome，无法启动投递助手；可改用「复制粘贴」面板手动投递', 501)
  }

  ensureSweeper()
  // 无显示环境（CI / 远程终端）用环境变量兜底：正常使用应当有头，方便人工登录
  const headless = input.headless ?? process.env.LAND_APPLY_HEADLESS === '1'

  let browser: Browser | null = null
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless,
      userDataDir: path.join(DATA_DIR, DATA_LAYOUT.browserProfile),
      /**
       * `--no-sandbox` 与 PDF 导出保持一致，不是随手加的：
       * 没有它时 Chrome 在受限环境（CI、容器、宿主沙箱里）启动后立刻退出，
       * 而 puppeteer 只会在下一步抛 `Requesting main frame too early!`——
       * 报错说的是 frame，真因是进程已经死了，排查起来很费时间。
       */
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1440,960',
      ],
      defaultViewport: { width: 1440, height: 900 },
    })

    const page = await acquirePage(browser)
    await gotoWithRetry(page, input.url)
    // 等渲染完成的柔和等待：某些站点首屏是骨架屏
    await new Promise((resolve) => setTimeout(resolve, 300))

    const blocker = await detectBlockers(page)
    const fields = await inspectForm(page)
    const { manual } = summarizeFields(fields)

    const now = new Date().toISOString()
    const session: Session = {
      id: randomUUID(),
      jobId: input.jobId,
      resumeId: input.resumeId ?? null,
      url: page.url() || input.url,
      status: blocker.blocked ? 'blocked' : 'open',
      step: 1,
      fields,
      manualFields: manual.map((field) => field.label || field.key),
      createdAt: now,
      updatedAt: now,
      blocker,
      headless,
      browser,
      page,
      lastTouched: Date.now(),
    }
    sessions.set(session.id, session)
    return toPublic(session)
  } catch (error) {
    const died = browser !== null && !browser.connected
    if (browser && browser.connected) await browser.close().catch(() => undefined)
    if (error instanceof AppError) throw error
    const message = error instanceof Error ? error.message : String(error)
    if (died) {
      throw new AppError(
        'CHROME_LAUNCH_FAILED',
        `Chrome 启动后立即退出：${message}。请确认本机 Chrome 可在无沙箱参数下启动，或改用「复制粘贴」面板手动投递`,
        502,
      )
    }
    throw new AppError('APPLY_OPEN_FAILED', `打开页面失败：${message}`, 502)
  }
}

export function getSession(id: string): PublicApplySession {
  const session = sessions.get(id)
  if (!session) throw new NotFoundError('投递会话', id)
  touch(session)
  return toPublic(session)
}

export function currentSession(): PublicApplySession | null {
  const session = aliveSession()
  return session ? toPublic(session) : null
}

export async function reInspect(id: string): Promise<PublicApplySession> {
  const session = sessions.get(id)
  if (!session) throw new NotFoundError('投递会话', id)
  const blocker = await detectBlockers(session.page)
  const fields = await inspectForm(session.page)
  const { manual } = summarizeFields(fields)
  session.fields = fields
  session.manualFields = manual.map((field) => field.label || field.key)
  session.blocker = blocker
  if (blocker.blocked && session.status === 'open') session.status = 'blocked'
  touch(session)
  return toPublic(session)
}

export async function fillSession(id: string, values: Record<string, string>): Promise<PublicApplySession> {
  const session = sessions.get(id)
  if (!session) throw new NotFoundError('投递会话', id)
  if (session.status === 'closed') throw new AppError('SESSION_CLOSED', '会话已结束', 409)

  const blocker = await detectBlockers(session.page)
  if (blocker.blocked) {
    session.blocker = blocker
    session.status = 'blocked'
    touch(session)
    throw new AppError('APPLY_BLOCKED', blocker.reason ?? '页面被拦截，需要人工处理', 409)
  }

  const results = await fillForm(session.page, session.fields, values)
  session.fillResults = results
  session.status = results.some((item) => !item.ok) ? 'open' : 'filled'
  touch(session)

  // 填完后重新扫一遍：多步表单可能因为填了某字段而展开新字段
  const fields = await inspectForm(session.page)
  session.fields = fields
  const { manual } = summarizeFields(fields)
  session.manualFields = manual.map((field) => field.label || field.key)
  return toPublic(session)
}

export interface SubmitResult {
  session: PublicApplySession
  finalUrl: string
  screenshotPath: string | null
  buttonText: string | null
  emptyRequired: string[]
}

export async function submitSession(id: string, confirm: boolean): Promise<SubmitResult> {
  if (!confirm) {
    throw new AppError('CONFIRM_REQUIRED', '提交是对外部世界的操作，必须显式 confirm: true', 400)
  }
  const session = sessions.get(id)
  if (!session) throw new NotFoundError('投递会话', id)
  if (session.status === 'closed') throw new AppError('SESSION_CLOSED', '会话已结束', 409)

  const blocker = await detectBlockers(session.page)
  if (blocker.blocked) {
    session.blocker = blocker
    session.status = 'blocked'
    touch(session)
    throw new AppError('APPLY_BLOCKED', blocker.reason ?? '页面被拦截，需要人工处理', 409)
  }

  const outcome = await runSubmit(session.page, FILES_DIR, session.id)
  session.status = 'submitted'
  touch(session)
  const snapshot = toPublic(session)
  // 提交后浏览器立刻关掉：留着一个已提交的页面没有价值，还占内存
  await destroy(id, 'submitted')

  return {
    session: snapshot,
    finalUrl: outcome.finalUrl,
    screenshotPath: outcome.screenshotPath,
    buttonText: outcome.buttonText,
    emptyRequired: outcome.emptyRequired,
  }
}

export async function closeSession(id: string): Promise<void> {
  await destroy(id, 'user_closed')
}

export async function closeAllSessions(): Promise<void> {
  for (const id of [...sessions.keys()]) await destroy(id, 'shutdown')
  if (sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
}
