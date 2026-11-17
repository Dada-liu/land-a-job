import { defineContentScript } from 'wxt/utils/define-content-script'
import { parseResumeButton, pickConversation } from '../src/lib/chat-actions.js'
import type { ContentRequest, ContentResponse } from '../src/lib/messages.js'
import { checkSelectors, SELECTOR_REGISTRY } from '../src/lib/selectors.js'

/**
 * 页面侧的确定性动作：注入附件、点开会话、读「发简历」能不能点。
 *
 * 三条纪律：
 * 1. **不代点发送**——发送按钮的状态只读取并回报，最后一击永远留给用户；
 * 2. 上传走页面自己的 file input，页面会自己调 `zpupload` 接口，扩展不碰写接口；
 * 3. 任何一个选择器找不到就返回失败原因，不做「试试别的元素」这种猜测。
 */

function findElement(key: string): Element | null {
  const entry = SELECTOR_REGISTRY.find((item) => item.key === key)
  if (!entry) return null
  for (const selector of entry.selectors) {
    const hit = document.querySelector(selector)
    if (hit) return hit
  }
  return null
}

function base64ToFile(base64: string, fileName: string): File {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], fileName, { type: 'application/pdf' })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 附件列表里的文件名（`.annex-list li` 的文本里带名字与大小） */
function listAttachmentNames(): string[] {
  return Array.from(document.querySelectorAll('.annex-list li, .resume-attachment .annex-item'))
    .map((el) => String(el.textContent ?? '').replace(/\s+/g, ' ').trim())
}

async function uploadPdf(fileName: string, base64: string): Promise<ContentResponse> {
  const input = findElement('attachmentEntry') as HTMLInputElement | null
  if (!(input instanceof HTMLInputElement)) {
    return { ok: false, reason: '没找到附件上传的 file input（选择器 attachmentEntry）' }
  }
  const before = listAttachmentNames().length
  const file = base64ToFile(base64, fileName)
  const transfer = new DataTransfer()
  transfer.items.add(file)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))

  // 页面自己会上传并刷新列表；这里只等「列表变长」这一件事，最多 20 秒
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500)
    const names = listAttachmentNames()
    if (names.length > before) {
      return { ok: true, reason: `附件列表已更新（${before} → ${names.length}）`, value: names[0] }
    }
  }
  return {
    ok: false,
    reason: '已注入文件，但 20 秒内附件列表没有变化；可能需要在页面上手动点一次「上传简历」打开弹窗后重试',
  }
}

async function openConversation(brandName: string): Promise<ContentResponse> {
  const items = Array.from(document.querySelectorAll('.friend-content')).map((el) => ({
    el,
    label: String(el.querySelector('.name-text')?.textContent ?? el.textContent ?? '').trim(),
  }))
  if (!items.length) return { ok: false, reason: '会话列表还没渲染出来（.friend-content 为 0）' }

  const hit = pickConversation(items, brandName)
  if (!hit) {
    return { ok: false, reason: `会话列表里找不到「${brandName}」，不猜、不发`, value: String(items.length) }
  }
  ;(hit.el as HTMLElement).click()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500)
    if (document.querySelector('.chat-input[contenteditable="true"]')) {
      return { ok: true, reason: `已打开「${brandName}」的会话`, value: hit.label }
    }
  }
  return { ok: false, reason: `点了「${brandName}」，但 10 秒内聊天输入区没出现` }
}

function checkResumeButton(): ContentResponse {
  const button = findElement('chatAttachButton') as HTMLElement | null
  if (!button) return { ok: false, reason: '没找到「发简历」按钮（选择器 chatAttachButton）' }
  const text = String(button.textContent ?? '').trim()
  if (text && !text.includes('发简历')) {
    return { ok: false, reason: `chatAttachButton 命中的不是「发简历」（文本：${text.slice(0, 12)}）` }
  }
  const state = parseResumeButton(String(button.className ?? ''), button.getAttribute('aria-label') ?? undefined)
  return { ok: state.available, reason: state.reason, value: state.available ? 'available' : 'blocked' }
}

/**
 * 会话列表是**分页懒加载**的：一次 getGeekFriendList 只回 30 条左右，
 * 页面上的 120 个会话要靠滚动才陆续请求。扩展只做「滚动」这一个 UI 动作，
 * 不点击、不输入、不调用任何接口；每批响应仍由 debugger 被动旁听。
 */
async function scrollConversations(): Promise<ContentResponse> {
  const waitFor = async (): Promise<HTMLElement | null> => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const first = document.querySelector('.friend-content')
      if (first) {
        let node: HTMLElement | null = first as HTMLElement
        while (node) {
          const style = getComputedStyle(node)
          const scrollable = /(auto|scroll)/.test(style.overflowY)
            && node.scrollHeight > node.clientHeight + 20
          if (scrollable) return node
          node = node.parentElement
        }
        return (document.scrollingElement as HTMLElement | null) ?? null
      }
      await sleep(500)
    }
    return null
  }

  const container = await waitFor()
  if (!container) {
    return { ok: false, reason: '会话列表还没渲染出来（.friend-content 为 0），刷新消息页后再试' }
  }

  const before = document.querySelectorAll('.friend-content').length
  let rounds = 0
  let unchanged = 0
  let after = before
  for (; rounds < 12; rounds += 1) {
    container.scrollTop = container.scrollHeight
    await sleep(700)
    const count = document.querySelectorAll('.friend-content').length
    if (count > after) { after = count; unchanged = 0 }
    else if (++unchanged >= 3) break
  }
  return {
    ok: true,
    reason: `会话列表已滚到底（${before} → ${after} 条，滚动 ${rounds + 1} 轮）`,
    value: String(after),
  }
}

/**
 * 新版详情页（`/job_detail/<encryptJobId>.html?securityId=...`）是 SSR：
 * JD 直接渲染在 `.job-sec-text`，**不再请求 `/wapi/zpgeek/job/detail.json`**
 * （2026-11-13 抓包确认）。所以这里只读 DOM，不发任何请求、不点任何按钮。
 */
function readJobDetail(): ContentResponse {
  const body = document.querySelector('.job-sec-text')
  const jdText = String((body as HTMLElement | null)?.innerText ?? body?.textContent ?? '').trim()
  if (jdText.length < 20) {
    return { ok: false, reason: 'JD 区域还没渲染（.job-sec-text 为空或过短）' }
  }
  const text = (selector: string): string | undefined => {
    const value = String(document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return value || undefined
  }
  const nameText = text('.name') ?? ''
  const payload = {
    jdText,
    brandName: text('.company-name'),
    /** .name 里是「岗位名-城市 薪资」，只取薪资前面的岗位名 */
    jobName: (nameText.split(/\s+\d+-\d+K/)[0] ?? '').replace(/-\S+$/, '').trim() || undefined,
    salaryDesc: nameText.match(/(\d+-\d+K[^\s]*)/)?.[1],
    city: text('.info-primary')?.match(/(北京|上海|广州|深圳|杭州|成都|南京|武汉|西安|苏州|天津|重庆|厦门|长沙|郑州|青岛|合肥|福州|济南|大连|宁波|无锡|东莞|佛山|珠海|中山|其他|全国)/)?.[1],
  }
  return { ok: true, reason: `已读取 JD 正文（${jdText.length} 字）`, value: JSON.stringify(payload) }
}

function selfCheck(): ContentResponse {
  const check = checkSelectors(document as unknown as { querySelector: (selector: string) => unknown })
  return {
    ok: check.ok,
    reason: check.ok ? '选择器自检通过' : `缺失：${check.missing.join(', ')}`,
    value: JSON.stringify(check.found),
  }
}

export default defineContentScript({
  matches: ['https://www.zhipin.com/*'],
  runAt: 'document_idle',
  main() {
    chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
      void (async (): Promise<ContentResponse> => {
        switch (message.type) {
          case 'CONTENT_SELF_CHECK':
            return selfCheck()
          case 'CONTENT_UPLOAD_PDF':
            return uploadPdf(message.fileName, message.base64)
          case 'CONTENT_OPEN_CONVERSATION':
            return openConversation(message.brandName)
          case 'CONTENT_CHECK_RESUME_BUTTON':
            return checkResumeButton()
          case 'CONTENT_SCROLL_CONVERSATIONS':
            return scrollConversations()
          case 'CONTENT_READ_JD':
            return readJobDetail()
          default:
            return { ok: false, reason: '未知的内容脚本指令' }
        }
      })()
        .then(sendResponse)
        .catch((error: Error) => sendResponse({ ok: false, reason: error.message }))
      return true
    })
  },
})
