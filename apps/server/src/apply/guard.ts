import type { Page } from 'puppeteer-core'

/**
 * 验证码 / 登录墙检测（P4-5）。
 *
 * 检测到位就直接中止，不尝试绕过：绕过验证码既违反站点条款，
 * 也会让「自动投递」变成一门跟风控对抗的生意。这里是求职工具，不是爬虫。
 */

export type BlockerKind = 'captcha' | 'login' | 'error'

export interface BlockerReport {
  blocked: boolean
  kind?: BlockerKind
  reason?: string
}

const CAPTCHA_SELECTORS = [
  'iframe[src*="captcha" i]',
  '[class*="geetest" i]',
  '[id*="captcha" i]',
  '[class*="captcha" i]',
  'iframe[src*="recaptcha" i]',
  '[class*="slider-verify" i]',
]

const LOGIN_SELECTORS = ['input[type="password"]', '[class*="login-form" i]', '[id*="loginForm" i]']

const CAPTCHA_WORDS = ['请输入验证码', '人机验证', '拖动滑块', '安全验证', 'captcha', 'verify you are human']
const LOGIN_WORDS = ['请先登录', '登录后投递', '请登录后继续']

export async function detectBlockers(page: Page): Promise<BlockerReport> {
  const report = await page.evaluate(
    (captchaSelectors: string[], loginSelectors: string[], captchaWords: string[], loginWords: string[]) => {
      const text = (document.body?.innerText ?? '').slice(0, 20_000).toLowerCase()

      for (const selector of captchaSelectors) {
        if (document.querySelector(selector)) return { blocked: true, kind: 'captcha', reason: `页面出现验证组件（${selector}）` }
      }
      for (const word of captchaWords) {
        if (text.includes(word.toLowerCase())) return { blocked: true, kind: 'captcha', reason: `页面提示「${word}」` }
      }
      // 登录墙：有密码框且页面上出现"登录"字样，判定为需要人工登录
      const hasPassword = loginSelectors.some((selector) => document.querySelector(selector))
      if (hasPassword && (text.includes('登录') || text.includes('sign in'))) {
        return { blocked: true, kind: 'login', reason: '页面要求登录，请在打开的浏览器里登录后继续' }
      }
      for (const word of loginWords) {
        if (text.includes(word.toLowerCase())) return { blocked: true, kind: 'login', reason: `页面提示「${word}」` }
      }
      const body = (document.body?.innerText ?? '').trim()
      if (body.length < 20) {
        return { blocked: true, kind: 'error', reason: '页面几乎是空白，可能加载失败或需要脚本渲染' }
      }
      return { blocked: false }
    },
    CAPTCHA_SELECTORS,
    LOGIN_SELECTORS,
    CAPTCHA_WORDS,
    LOGIN_WORDS,
  )

  return report as BlockerReport
}
