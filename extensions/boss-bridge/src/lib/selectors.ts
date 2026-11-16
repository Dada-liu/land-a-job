/**
 * 选择器注册表（提案 §10：DOM 选择器是长期维护成本）。
 *
 * 带 `verified: true` 的条目来自 2026-11-12 的实测（`npm run probe:p3`）：
 * - 附件上传走**隐藏弹窗** `.upload-resume__old`，里面 `a.btn-file > input[ka=user-resume-upload-file]`；
 *   文件注入后由页面自己调 `zpupload/resume/uploadFile.json` → `attachment/save.json`；
 * - 聊天页会话项是 `.friend-content`（不是 `.geek-item`），会话名在 `.name-text`；
 * - 输入区是 `div.chat-input[contenteditable="true"]`，发送按钮 `.chat-op button.btn-send`（空内容时带 `disabled`）；
 * - 「发简历」按钮 `.chat-controls .toolbar-btn`，**对方没回复时带 `unable`**，
 *   `aria-label` 会写「正在请求中，等待对方回复」——这种情况必须停下，不能点。
 *
 * 未验证的条目一律 `verified: false`，内容脚本只探测不做动作。
 */
export interface SelectorEntry {
  key: string
  label: string
  selectors: string[]
  required: boolean
  /** 是否已在真实页面验证过；false 时内容脚本只做探测，不做动作 */
  verified?: boolean
  /** 属于哪个页面，便于自检时按当前 URL 只查相关的几条 */
  page?: 'recommend' | 'chat' | 'job'
}

/** P3 用到的两个页面；导航只走这两个常量，别在别处写字符串 */
export const PAGE_URLS = {
  attachments: 'https://www.zhipin.com/web/geek/recommend',
  chat: 'https://www.zhipin.com/web/geek/chat',
} as const

export const SELECTOR_REGISTRY: SelectorEntry[] = [
  {
    key: 'greetButton',
    label: '立即沟通按钮',
    selectors: ['.btn-greet', '[data-selector="greet"]', 'a.btn-startchat'],
    required: true,
  },
  {
    key: 'greetInput',
    label: '招呼语输入框',
    selectors: ['#chat-input', '.chat-input textarea', '[contenteditable="true"][data-chat-input]'],
    required: true,
  },
  {
    key: 'attachmentManager',
    label: '附件管理入口',
    selectors: ['[data-selector="resume-attachment"]', '.attachment-manager'],
    required: false,
    verified: false,
    page: 'recommend',
  },
  {
    key: 'attachmentPage',
    label: '附件管理页（/web/geek/recommend）',
    selectors: ['#wrap', '.page-recommend', '.recommend-wrap'],
    required: true,
    verified: false,
    page: 'recommend',
  },
  {
    key: 'attachmentEntry',
    label: '「附件简历」上传弹窗里的文件输入',
    selectors: [
      '.upload-resume__old input[ka="user-resume-upload-file"][accept*="pdf"]',
      '.dialog-container input[ka="user-resume-upload-file"][accept*="pdf"]',
    ],
    required: true,
    verified: true,
    page: 'recommend',
  },
  {
    key: 'attachmentFileInput',
    label: '附件上传入口（弹窗容器，注入前先确认存在）',
    selectors: ['.upload-resume__old', '.dialog-container .upload-resume__old'],
    required: true,
    verified: true,
    page: 'recommend',
  },
  {
    key: 'attachmentUploaded',
    label: '附件列表（上传成功回执）',
    selectors: ['.resume-attachment .annex-list li', '.annex-list .annex-item'],
    required: true,
    verified: true,
    page: 'recommend',
  },
  {
    key: 'chatPage',
    label: '消息页（/web/geek/chat）',
    selectors: ['.chat-content', '.chat-container', '.chat-wrap'],
    required: true,
    verified: true,
    page: 'chat',
  },
  {
    key: 'conversationItem',
    label: '会话列表项（名字在 .name-text）',
    selectors: ['.friend-content', '.user-list-content .friend-content-warp'],
    required: true,
    verified: true,
    page: 'chat',
  },
  {
    key: 'chatAttachButton',
    label: '「发简历」按钮（对方未回复时带 unable）',
    selectors: ['.chat-controls .toolbar-btn', '.chat-controls [aria-label="发简历"]'],
    required: true,
    verified: true,
    page: 'chat',
  },
  {
    key: 'chatInput',
    label: '聊天输入区（contenteditable）',
    selectors: ['.chat-input[contenteditable="true"]', '.chat-im.chat-editor .chat-input'],
    required: false,
    verified: true,
    page: 'chat',
  },
  {
    key: 'chatSendButton',
    label: '发送按钮（扩展不代点，只用于确认可点）',
    selectors: ['.chat-op button.btn-send', '.chat-op .btn-sure-v2'],
    required: true,
    verified: true,
    page: 'chat',
  },
  {
    key: 'jdBody',
    label: '职位描述区域',
    selectors: ['.job-sec-text', '.job-detail-section', '[data-selector="job-description"]'],
    required: false,
    verified: false,
    page: 'job',
  },
]

export interface SelectorCheck {
  ok: boolean
  missing: string[]
  found: string[]
}

export function checkSelectors(
  root: { querySelector: (selector: string) => unknown },
  registry: SelectorEntry[] = SELECTOR_REGISTRY,
): SelectorCheck {
  const missing: string[] = []
  const found: string[] = []
  for (const entry of registry) {
    const hit = entry.selectors.some((selector) => {
      try { return Boolean(root.querySelector(selector)) } catch { return false }
    })
    if (hit) found.push(entry.key)
    else if (entry.required) missing.push(entry.key)
  }
  return { ok: missing.length === 0, missing, found }
}
