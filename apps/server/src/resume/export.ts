import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

/**
 * 无头导出：页面没开也能出 PDF。
 *
 * 为什么不复用浏览器里的 jsPDF 路径：那条路要页面上有人点一下。Agent（MCP）
 * 需要在没人开浏览器时导出，所以这里让本机 Chrome 打开打印页
 * （`/resumes/:id?print=1`）再 page.pdf()。
 *
 * 两个路径用的是同一个 ResumePages 组件，分页结果一致——不会出现
 * 「预览 2 页、导出 3 页」这种只有用户才能发现的错位。
 */

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

export function findChromeExecutable(): string | null {
  const fromEnv = process.env.LAND_CHROME
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return CHROME_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null
}

function sanitize(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

/** 文件名口径与浏览器端保持一致：姓名_岗位_标题_日期 */
export function buildExportName(
  data: { personalInfo?: { name?: string; jobTitle?: string } },
  title: string,
  date = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const parts = [
    data.personalInfo?.name || '简历',
    data.personalInfo?.jobTitle || '岗位',
    title || '简历',
    stamp,
  ]
  return `${parts.map(sanitize).filter(Boolean).join('_')}.pdf`
}

export interface HeadlessExportInput {
  resumeId: string
  resumeTitle: string
  data: { personalInfo?: { name?: string; jobTitle?: string } }
  port: number
  filesDir: string
}

export interface HeadlessExportResult {
  filePath: string
  bytes: number
  via: 'headless'
}

export async function exportResumePdfHeadless(
  input: HeadlessExportInput,
): Promise<HeadlessExportResult> {
  const executablePath = findChromeExecutable()
  if (!executablePath) {
    throw new AppError(
      'CHROME_NOT_FOUND',
      '未找到本机 Chrome/Chromium，无法在页面未打开时导出 PDF；可在浏览器里点「导出 PDF」，或设置环境变量 LAND_CHROME 指向浏览器可执行文件',
      501,
    )
  }

  // 动态导入：puppeteer-core 只在真的导出时才加载，服务启动不受它影响
  const { default: puppeteer } = await import('puppeteer-core')
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
    defaultViewport: { width: 1000, height: 1400, deviceScaleFactor: 2 },
  })

  try {
    const page = await browser.newPage()
    const url = `http://127.0.0.1:${input.port}/resumes/${encodeURIComponent(input.resumeId)}?print=1`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // 打印页会把「分页已稳定」写到 window.__landResumeReady
    await page.waitForFunction('window.__landResumeReady === true', { timeout: 25_000 })
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })

    const dir = path.join(input.filesDir, 'resumes')
    await mkdir(dir, { recursive: true })
    const filePath = path.join(dir, buildExportName(input.data, input.resumeTitle))
    await writeFile(filePath, pdf)
    return { filePath, bytes: pdf.byteLength, via: 'headless' }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      'EXPORT_FAILED',
      `无头导出失败：${error instanceof Error ? error.message : String(error)}`,
      502,
    )
  } finally {
    await browser.close().catch(() => {})
  }
}
