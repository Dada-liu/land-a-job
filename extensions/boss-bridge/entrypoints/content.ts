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
  /**
   * 匹配用的是 `.name-box` 而不是 `.name-text`：
   * 会话项的标题是「人名 + 公司名 + 职位」（如「陈女士微创软件招聘者」），
   * `.name-text` 只有人名，拿公司名去匹配永远找不到。
   */
  const items = Array.from(document.querySelectorAll('.friend-content')).map((el) => ({
    el,
    label: String(
      el.querySelector('.name-box')?.textContent ?? el.querySelector('.name-text')?.textContent ?? el.textContent ?? '',
    ).trim(),
  }))
  if (!items.length) return { ok: false, reason: '会话列表还没渲染出来（.friend-content 为 0）' }

  const hit = pickConversation(items, brandName)
  if (!hit) {
    return { ok: false, reason: `会话列表里找不到「${brandName}」，不猜、不发`, value: String(items.length) }
  }
  ;(hit.el as HTMLElement).click()

  /**
   * 用时间预算等输入区出现。写死「20 × 500ms」在后台标签页会变成 20 秒
   * （setTimeout 被节流到 1s），一撞上 background 的 12 秒超时就报「内容脚本没响应」。
   */
  const deadline = Date.now() + 6_000
  while (Date.now() < deadline) {
    await sleep(250)
    if (document.querySelector('.chat-input[contenteditable="true"]')) {
      return { ok: true, reason: `已打开「${brandName}」的会话`, value: hit.label }
    }
  }
  return { ok: false, reason: `点了「${brandName}」，但 6 秒内聊天输入区没出现` }
}

/**
 * 在已打开的会话里发一条文本。
 *
 * 只服务「自动发定制招呼语」：文本来自设置里的「招呼语怎么写」模板（`buildGreeting` 渲染），
 * 用户显式打开那个开关才走到这里。发错人不可撤销，所以：
 * 1. 能读到对方名字就核对，对不上不发；
 * 2. 写完先校验输入框内容，再等发送按钮从 disabled 变可点；
 * 3. 发送后用「输入框被清空」确认真的发出去了。
 */
async function sendMessage(text: string, expectBrand?: string): Promise<ContentResponse> {
  const content = text.trim()
  if (!content) return { ok: false, reason: '要发送的内容是空的，已放弃' }
  if (content.length > 600) return { ok: false, reason: `内容太长（${content.length} 字），已放弃发送` }

  /**
   * 会话头部实际是 `.chat-conversation`（内容形如「王女士 易车 HRBP 更多 ai agent产品经理」）。
   * 原来那套 `.chat-content .title / .chat-detail .name` 一个都匹配不到，header 恒为空字符串，
   * 于是「发错公司」的校验从来没生效过——必须换成真能命中的节点。
   */
  const header = String(
    (document.querySelector('.chat-conversation') as HTMLElement | null)?.innerText
      ?? document.querySelector('.name-content')?.textContent
      ?? '',
  ).replace(/\s+/g, ' ').trim()
  if (expectBrand) {
    if (!header) return { ok: false, reason: '读不到当前会话的公司名，为免发错人已放弃发送' }
    if (!header.includes(expectBrand)) {
      return { ok: false, reason: `当前会话是「${header.slice(0, 30)}」，不是「${expectBrand}」，已放弃发送` }
    }
  }

  const input = document.querySelector('.chat-input[contenteditable="true"]') as HTMLElement | null
  if (!input) return { ok: false, reason: '找不到聊天输入框（.chat-input[contenteditable=true]）' }

  input.focus()
  /** 先清空：上一条没发出去的内容留在框里会被拼在一起 */
  const range = document.createRange()
  range.selectNodeContents(input)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.execCommand('delete')
  document.execCommand('insertText', false, content)

  const written = String(input.innerText ?? '').trim()
  if (!written.includes(content.slice(0, 8))) {
    return { ok: false, reason: '文本没写进输入框（可能被富文本拦截），已放弃发送' }
  }

  /**
   * 发送按钮不能用 `.chat-op .btn-send, .btn-sure-v2` 这种并列选择器——它会命中
   * 文档里更靠前的**隐藏「确定」span**（`span.btn-v2.btn-sure-v2`，同样带 btn-sure-v2），
   * 点它毫无反应，输入框当然不会清空。必须按文案「发送」+ 可见 来挑。
   */
  const findSendButton = (): HTMLElement | null => {
    const list = [...document.querySelectorAll<HTMLElement>('.chat-op .btn-send, .btn-send')]
    return list.find((el) => {
      if (!String(el.textContent ?? '').includes('发送')) return false
      if (el.className.includes('disabled') || el.getAttribute('disabled') !== null) return false
      const box = el.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }) ?? null
  }

  /** 等发送按钮从 disabled 变可点：Vue 要等 input 事件生效才解除禁用 */
  const deadline = Date.now() + 3_000
  let button = findSendButton()
  while (!button && Date.now() < deadline) {
    await sleep(200)
    button = findSendButton()
  }
  if (!button) return { ok: false, reason: '发送按钮一直是禁用状态，已放弃发送' }

  button.click()
  /**
   * 真发出去后 BOSS 会清空输入框，这是最可靠的成功信号。
   * 但清空发生在请求回来之后，后台标签被节流时 1.2 秒根本不够——按 deadline 等。
   */
  const clearDeadline = Date.now() + 8_000
  let left = String(input.innerText ?? '').trim()
  while (left && Date.now() < clearDeadline) {
    await sleep(200)
    left = String(input.innerText ?? '').trim()
  }
  if (left) return { ok: false, reason: '点了发送但输入框没清空，可能没发出去（去会话里确认一下）' }
  return { ok: true, reason: `已发送（${content.length} 字）`, value: content.slice(0, 40) }
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
 * JD 正文的容器选择器，按「先精确后兜底」排列。
 *
 * 独立详情页和搜索页右侧分栏面板**不是同一套 DOM**（2026-11-20 实测）：
 * - `/job_detail/<id>.html`：`.job-sec-text`
 * - `/web/geek/jobs` 右侧 `.job-detail-container`：JD 在 `.job-detail-body > .desc`，
 *   整页一个 `.job-sec-text` 都没有
 *
 * 只认 `.job-sec-text` 的结果是全自动每轮都读到空、报「JD 还没渲染」，
 * 连续 5 次把自己熔断，一条招呼都发不出去。
 */
const JD_SELECTORS = [
  '.job-sec-text',
  '.job-detail-body .desc',
  '.job-detail-box .desc',
  '[data-selector="job-description"]',
]

/**
 * 取元素文本：`innerText` 依赖布局，后台标签 / 懒渲染时可能是空字符串，
 * 而 `??` 只在 null/undefined 时兜底，空串会直接把 JD 判成"没渲染"。这里两个都取，用长的。
 */
function elementText(el: Element | null): string {
  if (!el) return ''
  const inner = String((el as HTMLElement).innerText ?? '').trim()
  const content = String(el.textContent ?? '').trim()
  return inner.length >= content.length ? inner : content
}

/** 在给定根节点里找最长的 JD 文本（面板里还有 13 字的地址 `.desc`，取最长才不会选错） */
function jdTextIn(root: ParentNode): string {
  let best = ''
  for (const selector of JD_SELECTORS) {
    const candidate = elementText(root.querySelector(selector))
    if (candidate.length > best.length) best = candidate
  }
  return best
}

/**
 * 新版详情页（`/job_detail/<encryptJobId>.html?securityId=...`）是 SSR：
 * JD 直接渲染在 `.job-sec-text`，**不再请求 `/wapi/zpgeek/job/detail.json`**
 * （2026-11-13 抓包确认）。所以这里只读 DOM，不发任何请求、不点任何按钮。
 */
function readJobDetail(): ContentResponse {
  const jdText = jdTextIn(document)
  if (jdText.length < 20) {
    return { ok: false, reason: 'JD 区域还没渲染（.job-sec-text / .job-detail-body .desc 都为空或过短）' }
  }
  const text = (selector: string): string | undefined => {
    const value = String(document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return value || undefined
  }
  const nameText = text('.name') ?? ''
  const payload = {
    /** 地址栏反推的岗位 ID，落库前用来核对"读到的 JD 是不是这条记录的" */
    id: paneJobId(),
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

/* ---------------- 搜索页：左右分栏，同页浏览（不新开标签、不跳转） ---------------- */

/** 卡片链接形如 `/job_detail/<encryptJobId>.html`，与暂存区主键同一个值 */
function jobIdFromHref(href: string): string | undefined {
  return /\/job_detail\/([^/?#]+)\.html/.exec(href)?.[1]
}

function cardLinks(): HTMLAnchorElement[] {
  return Array.from(document.querySelectorAll('.job-card-box a.job-name')) as HTMLAnchorElement[]
}

function serializeCards(): string {
  const cards = cardLinks().map((link) => {
    const card = link.closest('.job-card-box') ?? link.parentElement
    return {
      id: jobIdFromHref(link.getAttribute('href') ?? ''),
      jobName: String(link.textContent ?? '').trim(),
      brandName: String(card?.querySelector('.boss-name')?.textContent ?? '').trim(),
      city: String(card?.querySelector('.company-location')?.textContent ?? '').replace(/\s+/g, ' ').trim() || undefined,
    }
  }).filter((card) => Boolean(card.id))
  return JSON.stringify(cards)
}

/** 从卡片往上找真正在滚的那个容器；找不到就退回整页滚动 */
function scrollableAncestor(from: Element | null): HTMLElement | null {
  let node: HTMLElement | null = from as HTMLElement | null
  while (node) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) return node
    node = node.parentElement
  }
  return (document.scrollingElement as HTMLElement | null) ?? null
}

/**
 * 读列表卡片（可选往下滚一段）。
 *
 * 搜索页是**整页无限滚动**（列表容器 `overflow: visible`，没有翻页按钮），
 * 分页请求只在滚到接近底部时才发。所以这里分几次小幅下滚、每步停一下——
 * 既像真人滑动，也能稳定把后面的卡片带出来。全程不点击、不输入。
 */
async function scanJobCards(scroll: boolean): Promise<ContentResponse> {
  const before = cardLinks().length
  if (before === 0) {
    return { ok: false, reason: '岗位列表还没渲染（.job-card-box 里没有岗位链接），等页面加载完再试' }
  }
  if (!scroll) {
    return { ok: true, reason: `读到 ${before} 张卡片`, value: serializeCards() }
  }

  const container = scrollableAncestor(cardLinks()[before - 1] ?? null)
  if (!container) return { ok: true, reason: `读到 ${before} 张卡片（没有可滚动容器）`, value: serializeCards() }

  const bottom = () => container.scrollHeight - container.clientHeight
  if (container.scrollTop >= bottom() - 40) {
    return { ok: true, reason: `已经是列表底部（${before} 张卡片），没有更多可加载`, value: serializeCards() }
  }

  for (let step = 0; step < 3; step += 1) {
    const stride = 360 + Math.round(Math.random() * 240)
    container.scrollTop = Math.min(container.scrollTop + stride, bottom())
    await sleep(320)
  }
  /** 滚到底后给页面留出请求下一页的时间 */
  await sleep(1_400)
  const after = cardLinks().length
  return {
    ok: true,
    reason: after > before
      ? `往下滚了 3 段（卡片 ${before} → ${after}）`
      : `往下滚了 3 段（卡片仍 ${after} 张，可能在等下一页响应）`,
    value: serializeCards(),
  }
}

/** 右侧详情面板当前展示的是哪个岗位（「查看更多信息」的链接里带 ID） */
/**
 * 当前页面在讲哪个岗位。
 *
 * 两种页面都要认：搜索页靠右侧面板的「查看更多」链接反推，
 * 独立详情页直接看地址栏——`/job_detail/<id>.html`。
 * 后者此前没实现，导致在详情页上任何岗位级判断都会返回 undefined。
 */
function paneJobId(): string | undefined {
  const fromPath = jobIdFromHref(location.pathname)
  if (fromPath) return fromPath
  const more = document.querySelector('.job-detail-container .more-job-btn') as HTMLAnchorElement | null
  return jobIdFromHref(more?.getAttribute('href') ?? '') ?? undefined
}

/**
 * 点开一张卡片，等右侧面板换成这个岗位。
 *
 * 刻意不用 `chrome.tabs.create` 打开详情：那是一次真实导航，短时间批量「开—停 1 秒—关」
 * 才是服务端能看见的异常序列。分栏页里点卡片只触发页面自己的一次详情请求，和真人一致。
 */
async function openJobCard(id: string): Promise<ContentResponse> {
  const link = cardLinks().find((item) => jobIdFromHref(item.getAttribute('href') ?? '') === id)
  if (!link) return { ok: false, reason: `列表里没有这个岗位的卡片（${id}），可能需要先滚动加载` }

  link.scrollIntoView({ block: 'center' })
  await sleep(250)
  /**
   * **先把响应发出去，再点击**。
   *
   * 点卡片有时会整页导航到 `/job_detail/<id>.html`，content script 随页面卸载，
   * 这时 `sendResponse` 永远发不出去 → background 侧 8 秒超时 → 连点几次把全自动熔断。
   * 延迟 50ms 点击，让响应先走；点没点上由下一步的 `expectId` 核对兜底。
   */
  setTimeout(() => link.click(), 50)
  return { ok: true, reason: '已点击岗位卡片，等页面切换', value: id }
}

/**
 * 读右侧面板的 JD。容器结构和独立详情页不同（面板是 `.job-detail-body > .desc`），
 * 走同一套选择器链；**不新开页面**，所以这条路径不产生额外的导航请求。
 */
function readPaneDetail(): ContentResponse {
  const pane = document.querySelector('.job-detail-container')
  if (!pane) return { ok: false, reason: '右侧详情面板还没出现（这个页面可能不是左右分栏的搜索页）' }

  const jdText = jdTextIn(pane)
  if (jdText.length < 20) return { ok: false, reason: 'JD 区域还没渲染（.job-sec-text / .job-detail-body .desc 都为空或过短）' }

  const text = (selector: string): string | undefined => {
    const value = String(pane.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return value || undefined
  }
  const nameText = text('.job-name') ?? text('.name') ?? ''
  const payload = {
    jdText,
    id: paneJobId(),
    brandName: text('.company-info .name') ?? text('.company-name') ?? text('.sider-company .name'),
    jobName: (nameText.split(/\s+\d+-\d+K/)[0] ?? '').replace(/-\S+$/, '').trim() || undefined,
    salaryDesc: nameText.match(/(\d+-\d+K[^\s]*)/)?.[1],
    city: text('.info-primary')?.match(/(北京|上海|广州|深圳|杭州|成都|南京|武汉|西安|苏州|天津|重庆|厦门|长沙|郑州|青岛|合肥|福州|济南|大连|宁波|无锡|东莞|佛山|珠海|中山|其他|全国)/)?.[1],
  }
  return { ok: true, reason: `已读取 JD 正文（${jdText.length} 字）`, value: JSON.stringify(payload) }
}

/**
 * 点右侧面板里的「立即沟通」。
 *
 * 只点击，不代发任何消息：默认招呼语由页面自己在请求里带上（`friend/add.json`），
 * 扩展依旧只从旁听里确认结果。找不到按钮就返回失败，不做"试试别的元素"。
 *
 * 按钮文案有三种，含义完全不同（2026-11-20 实测，三者的 class 都是 `is-disabled`）：
 * - 「立即沟通」可点 → 还没沟通过，点它
 * - 「继续沟通」     → **此前已沟通过**，点它只会打开会话窗，不发 `friend/add.json`
 * - 「立即沟通」灰的 → 面板换岗位时的渲染瞬态（实测 1.6 秒后即可点），等着，别下结论
 */
async function clickGreet(expectId?: string): Promise<ContentResponse> {
  const here = paneJobId()
  if (expectId && here !== expectId) {
    return { ok: false, reason: `页面上的岗位是 ${here ?? '未知'}，和目标 ${expectId} 不一致，已放弃点击` }
  }

  /** 搜索页在右侧面板里，独立详情页在整页上——两套结构都要认。顺带排除浮层副本 */
  const scope = document.querySelector('.job-detail-container') ?? document
  const allButtons = (): HTMLElement[] => [
    ...scope.querySelectorAll<HTMLElement>('.op-btn-chat, .btn-greet, .btn-startchat'),
  ]
  const clicked = (el: HTMLElement): boolean => {
    if (el.className.includes('disabled') || el.getAttribute('aria-disabled') === 'true') return false
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }

  /**
   * 点完卡片右侧要重新渲染，按钮不是立刻就有；更麻烦的是渲染过程中会短暂出现一个
   * **带 `is-disabled` 的旧按钮**（实测同一岗位 1.6 秒后就是可点的正常按钮）。
   * 所以这里轮询 6 秒：只有一直是灰的才判"暂时点不了"，绝不锁死。
   */
  const findContinue = (): boolean => allButtons().some(
    (el) => String(el.textContent ?? '').trim().includes('继续沟通'),
  )
  const findButton = (): HTMLElement | undefined => allButtons().find(
    (el) => String(el.textContent ?? '').trim() === '立即沟通' && clicked(el),
  )
  let button = findButton()
  /**
   * 用**时间预算**而不是「次数 × 固定间隔」。
   *
   * 后台标签页里 Chrome 会把 `setTimeout` 节流到最少 1 秒，`sleep(400)` 实际是 1 秒；
   * 写死 8 次就变成 8 秒，正好撞上 background 的 8 秒超时，报「内容脚本没响应」。
   * 按 deadline 判断，无论被怎么节流都不会超过预算。
   */
  const deadline = Date.now() + 4_000
  while (!button && Date.now() < deadline) {
    await sleep(200)
    /** 面板换岗位是异步的：每轮都重新核对是不是还在目标岗位上 */
    const now = paneJobId()
    if (expectId && now && now !== expectId) {
      return { ok: false, reason: `页面上的岗位变成了 ${now}，和目标 ${expectId} 不一致，已放弃点击` }
    }
    /** 「继续沟通」一旦出现就是确定结论，不必再等 */
    if (findContinue()) {
      return { ok: false, reason: 'BOSS 上这个岗位显示「继续沟通」，说明此前已沟通过' }
    }
    button = findButton()
  }
  if (!button) {
    /** 「继续沟通」是明确信号：BOSS 认为此前已经打过招呼了 */
    if (findContinue()) {
      return { ok: false, reason: 'BOSS 上这个岗位显示「继续沟通」，说明此前已沟通过' }
    }
    const any = allButtons().length
    return {
      ok: false,
      reason: any > 0
        ? '「立即沟通」不可点：按钮是灰色的（面板还没渲染完，稍后重试）'
        : '「立即沟通」不可点：页面上没有这个按钮',
    }
  }

  button.scrollIntoView({ block: 'center' })
  await sleep(200)
  /** 同 openJobCard：点完 BOSS 常直接跳聊天页，先回响应再点，否则响应丢在导航里 */
  setTimeout(() => button.click(), 50)
  return { ok: true, reason: '已点击「立即沟通」，等页面自己发请求', value: here }
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
          case 'CONTENT_SEND_MESSAGE':
            return sendMessage(message.text, message.expectBrand)
          case 'CONTENT_CHECK_RESUME_BUTTON':
            return checkResumeButton()
          case 'CONTENT_SCROLL_CONVERSATIONS':
            return scrollConversations()
          case 'CONTENT_READ_JD':
            return readJobDetail()
          case 'CONTENT_SCAN_JOBS':
            return scanJobCards(message.scroll)
          case 'CONTENT_OPEN_JOB_CARD':
            return openJobCard(message.id)
          case 'CONTENT_READ_PANE_JD':
            return readPaneDetail()
          case 'CONTENT_CLICK_GREET':
            return clickGreet(message.expectId)
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
