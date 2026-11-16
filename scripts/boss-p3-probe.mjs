/**
 * BOSS 侧 P3 探针：实测「附件管理上传」与「聊天页发简历」到底怎么做。
 *
 * 为什么必须实测：附件上传依赖真实的 `input[type=file]` 结构与上传回执，
 * 发送依赖会话定位与按钮文案。这些选择器猜错不是「不生效」，而是**点到别的东西**。
 * 所以先只读地看一眼，再写动作代码。
 *
 * 用法（与 P0 探针同一套 CDP，不注入任何请求）：
 *
 *   1. 用独立 profile 起一个带调试端口的 Chrome 并登录 zhipin.com：
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *        --remote-debugging-port=9222 \
 *        --user-data-dir="$HOME/.land-a-job/boss-probe-profile"
 *
 *   2. 采集附件管理页（默认停留 120 秒，期间请你**手动上传一个 PDF**）：
 *      npm run probe:p3 -- --page attachments
 *
 *   3. 采集消息页（期间请你**手动给某个会话发一次简历附件**）：
 *      npm run probe:p3 -- --page chat
 *
 *   4. 只想看结构不想手动操作：
 *      npm run probe:p3 -- --page both --seconds 0
 *
 * 产物：data/boss-p3-probe/<runId>/{report.md,dom-*.json,api-*.json}
 * 全程只读：不点击、不上传、不发消息、不调用任何写接口。
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const HELP = `
用法：node scripts/boss-p3-probe.mjs [选项]

  --page <attachments|chat|both>  采集哪个页面，默认 both
  --seconds <n>                   每个页面停留秒数，默认 120；0 表示只看一眼就结束
  --cdp <url>                     CDP 地址，默认 http://127.0.0.1:9222
  --out <dir>                     输出根目录，默认 data/boss-p3-probe
  --help                          显示本帮助

采集期间请你手动完成一次「上传 PDF」或「发一次简历附件」，
脚本只被动记录请求与响应，绝不代替你操作。
`

function parseArgs(argv) {
  const opts = { page: 'both', seconds: 120, cdp: 'http://127.0.0.1:9222', out: 'data/boss-p3-probe' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { console.log(HELP); process.exit(0) }
    if (arg === '--page') opts.page = argv[++index] ?? opts.page
    else if (arg === '--seconds') opts.seconds = Number(argv[++index] ?? opts.seconds)
    else if (arg === '--cdp') opts.cdp = argv[++index] ?? opts.cdp
    else if (arg === '--out') opts.out = argv[++index] ?? opts.out
  }
  if (!['attachments', 'chat', 'both'].includes(opts.page)) {
    console.error(`--page 只能是 attachments / chat / both，收到 ${opts.page}`)
    process.exit(2)
  }
  return opts
}

const PAGES = {
  attachments: 'https://www.zhipin.com/web/geek/recommend',
  chat: 'https://www.zhipin.com/web/geek/chat',
}

/** 关心的接口：上传、简历附件、聊天发送。其余只统计路径 */
const INTERESTING = /\/wapi\/(?:zpupload|zpgeek\/resume|zpchat|zpgeek\/chat|zpgeek\/recommend)/i

const opts = parseArgs(process.argv.slice(2))
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const runDir = path.join(opts.out, runId)
mkdirSync(runDir, { recursive: true })

/** 在页面里跑的只读脚本：只统计，不点击 */
const DOM_PROBE = `(() => {
  const visible = (el) => el && el.offsetParent !== null
  const info = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: String(el.className || '').slice(0, 100),
    text: String(el.textContent || '').trim().slice(0, 40),
    html: el.outerHTML.replace(/\\s+/g, ' ').slice(0, 220),
  })
  const byText = (re, limit = 8) => Array.from(document.querySelectorAll('button,a,span,div,li'))
    .filter((el) => visible(el) && re.test(String(el.textContent || '').trim()) && String(el.textContent || '').trim().length <= 12)
    .slice(0, limit)
    .map(info)
  const classBag = (re) => Array.from(document.querySelectorAll('[class]'))
    .filter((el) => re.test(String(el.className || '')))
      .slice(0, 12)
      .map((el) => ({ cls: String(el.className).slice(0, 100), children: el.children.length }))

  /** 祖先链：判断「这个 input 属于哪个区块」只能靠它，光看 class 猜不出来 */
  const ancestors = (el, limit = 6) => {
    const chain = []
    let node = el.parentElement
    while (node && chain.length < limit) {
      chain.push({
        tag: node.tagName.toLowerCase(),
        cls: String(node.className || '').slice(0, 90),
        id: node.id || undefined,
        ka: node.getAttribute('ka') || undefined,
      })
      node = node.parentElement
    }
    return chain
  }

  /** 结构树：只取关心的根节点，深度 5，够看清层次又不至于几 MB */
  const snap = (el, depth = 0) => {
    if (!el || depth > 5) return null
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 80),
      id: el.id || undefined,
      ka: el.getAttribute('ka') || undefined,
      text: String(el.childElementCount === 0 ? el.textContent || '' : '').trim().slice(0, 40),
      kids: Array.from(el.children).slice(0, 8).map((child) => snap(child, depth + 1)).filter(Boolean),
    }
  }
  const roots = ['#wrap', '.resume-attachment', '.attachment-resume', '.chat-content', '.chat-wrap', '.friend-content', '.chat-op', '.chat-input', '.toolbar', 'textarea', '[contenteditable]']
  const trees = {}
  for (const selector of roots) {
    const el = document.querySelector(selector)
    if (el) trees[selector] = snap(el)
  }

  /** 所有可编辑/输入控件：聊天输入是 textarea 还是 contenteditable 只能实测 */
  const fields = Array.from(document.querySelectorAll('textarea, input[type=text], [contenteditable], [contenteditable="plaintext-only"]'))
    .slice(0, 10)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 80),
      editable: el.getAttribute('contenteditable'),
      placeholder: el.getAttribute('placeholder'),
      ancestors: ancestors(el, 3),
    }))

  /** 聊天工具条：发送/附件按钮通常在这里，按 title/class 全量列出来 */
  const toolbar = Array.from(document.querySelectorAll('.chat-op button, .chat-op a, .chat-op i, .toolbar button, .toolbar a, .toolbar i, .chat-input button, .chat-input a'))
    .slice(0, 20)
    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), ka: el.getAttribute('ka'), title: el.getAttribute('title'), text: String(el.textContent || '').trim().slice(0, 20) }))

  return {
    url: location.href,
    title: document.title,
    trees,
    fields,
    toolbar,
    fileInputs: Array.from(document.querySelectorAll('input[type=file]')).map((el) => ({
      accept: el.getAttribute('accept'),
      multiple: el.multiple,
      hidden: el.offsetParent === null,
      ka: el.getAttribute('ka'),
      cls: String(el.className || ''),
      ancestors: ancestors(el),
    })),
    buttons: {
      resume: byText(/简历|附件/),
      upload: byText(/上传|添加附件/),
      send: byText(/^发送|发送简历|发简历/),
      confirm: byText(/^确定$|^确认$|^完成$/),
    },
    containers: {
      attachment: classBag(/attach|resume|upload/i),
      conversation: classBag(/geek-item|friend|conversation|chat-item/i),
      chat: classBag(/chat|message|dialog/i),
    },
    contentEditable: Array.from(document.querySelectorAll('[contenteditable]')).slice(0, 5)
      .map((el) => ({ cls: String(el.className || '').slice(0, 80), mode: el.getAttribute('contenteditable') })),
    counts: {
      fileInput: document.querySelectorAll('input[type=file]').length,
      friendContent: document.querySelectorAll('.friend-content').length,
      chatInput: document.querySelectorAll('textarea, [contenteditable]').length,
    },
  }
})()`

const REDACT_KEYS = /(token|cookie|secret|phone|mobile|email|wechat|encrypt|securityId|userId|uid|bossId|geekId|name|avatar|url|link)/i
const DROP_TEXT_KEYS = /^(lastMsg|showText|content|text|description|postDescription|greeting)$/i

function redact(value, depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (DROP_TEXT_KEYS.test(key)) out[key] = `<omitted ${typeof item === 'string' ? item.length : 0}>`
    else if (REDACT_KEYS.test(key) && typeof item !== 'object') out[key] = '<redacted>'
    else out[key] = redact(item, depth + 1)
  }
  return out
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Set()
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
        return
      }
      for (const listener of this.listeners) listener(msg)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} 超时`))
      }, 20000)
    })
  }

  onMessage(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })
  return new Cdp(ws)
}

async function listTargets() {
  const response = await fetch(`${opts.cdp}/json/list`)
  if (!response.ok) throw new Error(`CDP ${opts.cdp} 不可达：HTTP ${response.status}`)
  return response.json()
}

function writeReport(summary) {
  const lines = [
    '# BOSS P3 探针报告',
    '',
    `- 运行：${runId}`,
    `- 页面：${summary.pages.map((p) => p.page).join(', ')}`,
    `- 状态：${summary.status}`,
    '',
    '## 每页关键结论',
    '',
  ]
  for (const page of summary.pages) {
    const dom = page.dom
    if (!dom) {
      lines.push(`### ${page.page}`, '', '（没有拿到 DOM 快照）', '')
      continue
    }
    lines.push(
      `### ${page.page}`,
      '',
      `- URL：${dom.url}`,
      `- \`input[type=file]\`：**${dom.fileInputs.length}** 个`,
      `- 「简历/附件」候选元素：${dom.buttons.resume.length} 个`,
      `- 「上传」候选元素：${dom.buttons.upload.length} 个`,
      `- 「发送」候选元素：${dom.buttons.send.length} 个`,
      `- 会话条目（.friend-content）：${dom.counts?.friendContent ?? '?'}`,
      `- 输入控件（textarea / contenteditable）：${dom.counts?.chatInput ?? '?'}`,
      '',
      '### file input 归属（写选择器看这一段）',
      '',
    )
    for (const [index, input] of dom.fileInputs.entries()) {
      const chain = (input.ancestors ?? []).map((node) => `${node.tag}${node.cls ? `.${node.cls.split(' ')[0]}` : ''}`).join(' ← ')
      lines.push(`- #${index} ka=\`${input.ka ?? '无'}\` accept=${String(input.accept ?? '').includes('pdf') ? '含 pdf' : '不含 pdf'}`)
      lines.push(`  - 祖先链：${chain || '（无）'}`)
    }
    lines.push('', '### 输入控件', '')
    if (!dom.fields?.length) lines.push('- （未发现 textarea / contenteditable）')
    for (const field of dom.fields ?? []) {
      const chain = (field.ancestors ?? []).map((node) => `${node.tag}${node.cls ? `.${node.cls.split(' ')[0]}` : ''}`).join(' ← ')
      lines.push(`- \`${field.tag}${field.cls ? `.${field.cls.split(' ')[0]}` : ''}\` editable=${field.editable ?? '否'} placeholder=${field.placeholder ?? '无'}`)
      lines.push(`  - 祖先链：${chain || '（无）'}`)
    }
    lines.push('', '### 工具条按钮', '')
    if (!dom.toolbar?.length) lines.push('- （未发现 .chat-op / .toolbar 内的按钮）')
    for (const item of dom.toolbar ?? []) {
      lines.push(`- \`${item.tag}${item.cls ? `.${item.cls.split(' ')[0]}` : ''}\` ka=${item.ka ?? '无'} title=${item.title ?? '无'} 「${item.text}」`)
    }
    lines.push('', '### 结构树根节点', '')
    for (const [selector, tree] of Object.entries(dom.trees ?? {})) {
      const depth = (node) => 1 + Math.max(0, ...(node.kids ?? []).map(depth))
      lines.push(`- \`${selector}\`：深度 ${depth(tree)}，子节点 ${tree.kids?.length ?? 0}`)
    }
    lines.push('', '候选元素（用于填写 selectors.ts）：', '')
    for (const [group, items] of Object.entries(dom.buttons)) {
      if (!items.length) continue
      lines.push(`- ${group}:`)
      for (const item of items.slice(0, 5)) {
        lines.push(`  - \`${item.tag}.${item.cls.split(' ')[0] || '(无 class)'}\` 「${item.text}」`)
      }
    }
    lines.push('')
  }
  lines.push('## 观察到的接口', '')
  if (!summary.endpoints.length) lines.push('（未观察到）', '')
  for (const endpoint of summary.endpoints) lines.push(`- \`${endpoint.path}\` × ${endpoint.count}（status ${endpoint.statuses.join('/')}）`)
  lines.push('', '## 说明', '', '- 只读探针：不点击、不上传、不发消息、不调用写接口。', '- 字段已按规则脱敏；若仍出现个人信息，请删除对应 json 后重跑。')
  const file = path.join(runDir, 'report.md')
  writeFileSync(file, `${lines.join('\n')}\n`)
  writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return file
}

const summary = { runId, cdp: opts.cdp, status: '采集中', pages: [], endpoints: [] }

async function capture(page, cdp) {
  const endpointMap = new Map()
  const apiBodies = []

  cdp.onMessage((msg) => {
    if (msg.method !== 'Network.responseReceived') return
    const url = msg.params?.response?.url ?? ''
    if (!url.includes('/wapi/')) return
    let key
    try { key = new URL(url).pathname } catch { key = url }
    const entry = endpointMap.get(key) ?? { path: key, count: 0, statuses: new Set() }
    entry.count += 1
    entry.statuses.add(msg.params.response.status)
    endpointMap.set(key, entry)
    if (INTERESTING.test(key)) {
      void (async () => {
        try {
          const result = await cdp.send('Network.getResponseBody', { requestId: msg.params.requestId })
          const text = result.base64Encoded
            ? Buffer.from(result.body, 'base64').toString('utf8')
            : result.body
          const parsed = JSON.parse(text)
          apiBodies.push({ path: key, body: redact(parsed.body ?? parsed) })
        } catch {
          // 响应体可能已被回收，忽略
        }
      })()
    }
  })

  await cdp.send('Network.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: PAGES[page] })
  await new Promise((resolve) => setTimeout(resolve, 4000))

  const domResult = await cdp.send('Runtime.evaluate', { expression: DOM_PROBE, returnByValue: true })
  const dom = domResult.result?.value ?? null
  writeFileSync(path.join(runDir, `dom-${page}.json`), `${JSON.stringify(dom, null, 2)}\n`)

  console.log(`· ${page}：input[type=file]=${dom?.fileInputs?.length ?? 0}，简历候选=${dom?.buttons?.resume?.length ?? 0}，发送候选=${dom?.buttons?.send?.length ?? 0}`)
  if (opts.seconds > 0) {
    console.log(`  ${opts.seconds}s 内请手动完成一次${page === 'attachments' ? '「上传 PDF 到附件管理」' : '「给某个会话发简历附件」'}…`)
    await new Promise((resolve) => setTimeout(resolve, opts.seconds * 1000))
  }

  writeFileSync(path.join(runDir, `api-${page}.json`), `${JSON.stringify(apiBodies, null, 2)}\n`)
  summary.pages.push({ page, dom })
  for (const entry of endpointMap.values()) {
    summary.endpoints.push({ path: entry.path, count: entry.count, statuses: [...entry.statuses] })
  }
}

try {
  const targets = await listTargets()
  const target = targets.find((item) => item.type === 'page' && /zhipin\.com/.test(item.url ?? ''))
    ?? targets.find((item) => item.type === 'page')
  if (!target) throw new Error('没找到可附着的页面标签')

  console.log(`附着：${String(target.url).slice(0, 90)}`)
  const cdp = await connect(target)

  const pages = opts.page === 'both' ? ['attachments', 'chat'] : [opts.page]
  for (const page of pages) await capture(page, cdp)

  summary.status = '已结束'
  summary.endpoints.sort((a, b) => b.count - a.count)
  const report = writeReport(summary)
  console.log(`\n报告：${report}`)
  console.log(`原始快照：${readdirSync(runDir).map((f) => `  - ${f}`).join('\n')}`)
  process.exit(0)
} catch (error) {
  summary.status = `失败：${error.message}`
  const report = writeReport(summary)
  console.error(`\n采集失败：${error.message}`)
  console.error(`已写出部分结果：${report}`)
  console.error('常见原因：Chrome 没用 --remote-debugging-port=9222 启动，或没有登录 zhipin.com。')
  process.exit(1)
}
