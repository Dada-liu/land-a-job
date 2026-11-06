import type { Page } from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '../errors.js'

/**
 * 提交与存证（P4-4）。
 *
 * 提交是唯一会产生外部世界后果的动作，所以：
 * 1) 必须显式 confirm；
 * 2) 无论成功失败都截图（失败截图比成功截图更有用）；
 * 3) 截图落到 files/evidence/，路径写进 application.evidence，事后能回看。
 */

const SUBMIT_TEXTS = ['提交申请', '立即投递', '确认投递', '提交简历', '投递简历', '提交', '申请职位', 'submit', 'apply']

export interface SubmitOutcome {
  clicked: boolean
  buttonText: string | null
  finalUrl: string
  screenshotPath: string | null
  /** 提交后仍空着的必填项（前端校验没过时） */
  emptyRequired: string[]
}

export async function clickSubmit(page: Page): Promise<{ clicked: boolean; buttonText: string | null }> {
  const clicked = await page.evaluate((texts: string[]) => {
    const candidates = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'))
    const visible = candidates.filter((element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      return !(element as HTMLButtonElement).disabled
    })

    const textOf = (element: Element): string => {
      if (element instanceof HTMLInputElement) return (element.value || '').trim()
      return (element.textContent || '').trim()
    }

    for (const text of texts) {
      const hit = visible.find((element) => textOf(element).toLowerCase().includes(text.toLowerCase()))
      if (hit) {
        hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        ;(hit as HTMLElement).click()
        return { clicked: true, buttonText: textOf(hit) }
      }
    }

    const typeSubmit = visible.find((element) => (element as HTMLButtonElement).type === 'submit')
    if (typeSubmit) {
      ;(typeSubmit as HTMLElement).click()
      return { clicked: true, buttonText: textOf(typeSubmit) }
    }
    return { clicked: false, buttonText: null }
  }, SUBMIT_TEXTS)

  return clicked
}

export async function captureEvidence(page: Page, filesDir: string, sessionId: string): Promise<string> {
  const dir = path.join(filesDir, 'evidence')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, `${sessionId}-${stamp}.png`)
  const buffer = await page.screenshot({ fullPage: true, type: 'png' })
  await writeFile(file, buffer)
  return file
}

export async function runSubmit(page: Page, filesDir: string, sessionId: string): Promise<SubmitOutcome> {
  const { clicked, buttonText } = await clickSubmit(page)
  if (!clicked) {
    throw new AppError('SUBMIT_BUTTON_NOT_FOUND', '页面上找不到提交按钮，请在浏览器里手动提交，然后回来标记状态', 422)
  }

  // 等网络安静：SPA 提交后往往还有一次 XHR，等不到就截图（截图比等待更可靠）
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 15_000 }).catch(() => undefined)
  await new Promise((resolve) => setTimeout(resolve, 500))

  const screenshotPath = await captureEvidence(page, filesDir, sessionId)
  const emptyRequired = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('input, textarea, select'))
        .filter((element) => {
          const input = element as HTMLInputElement
          if (!input.required || input.disabled) return false
          const rect = element.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return false
          if (input.type === 'checkbox' || input.type === 'radio') return !input.checked
          return !input.value?.trim()
        })
        .map((element) => {
          const input = element as HTMLInputElement
          return input.labels?.[0]?.textContent?.trim() || input.name || input.id || input.type
        }),
    )
    .catch(() => [] as string[])

  return { clicked, buttonText, finalUrl: page.url(), screenshotPath, emptyRequired }
}
