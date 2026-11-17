import type { BridgeSettings, ConversationSnapshot, StagedJob } from './types.js'

export type RuntimeRequest =
  | { type: 'GET_STATUS' }
  | { type: 'GET_STAGED' }
  /** 已旁听到的会话快照（缓存岗位页的「会话」视图） */
  | { type: 'GET_CONVERSATIONS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'SET_SETTINGS'; settings: BridgeSettings }
  | { type: 'START_CAPTURE' }
  | { type: 'STOP_CAPTURE' }
  | { type: 'RUN_PIPELINE' }
  /** 清掉已生成草稿，让下次流水线按当前模板重写（改完模板/关键词后必用） */
  | { type: 'CLEAR_DRAFTS' }
  /** 立刻重新拉一次会话列表（会话页是 SPA，不刷新就看不到新回复） */
  | { type: 'CHECK_REPLIES' }
  | { type: 'RUN_DELIVERY'; keys: string[] }
  /** P3：按 JD 定制简历并导出 PDF（还不上传、不发送） */
  | { type: 'RUN_TAILOR'; keys: string[] }
  /** P3：把已导出的 PDF 注入附件管理页（页面自己会上传） */
  | { type: 'RUN_UPLOAD'; keys: string[] }
  /** P3：打开回复的那个会话并检查「发简历」是否可点（不代点发送） */
  | { type: 'RUN_OPEN_CHAT'; keys: string[] }
  | { type: 'RESET_LIMITER' }
  | { type: 'TEST_BRIDGE' }
  | { type: 'GET_LOGS' }

/** background → 内容脚本；只做确定性 DOM 动作，绝不代点发送 */
export type ContentRequest =
  | { type: 'CONTENT_SELF_CHECK' }
  | { type: 'CONTENT_UPLOAD_PDF'; fileName: string; base64: string }
  | { type: 'CONTENT_OPEN_CONVERSATION'; brandName: string }
  | { type: 'CONTENT_CHECK_RESUME_BUTTON' }
  /** 只滚动会话列表，触发页面自己加载后续分页；不点击、不输入、不发请求 */
  | { type: 'CONTENT_SCROLL_CONVERSATIONS' }
  /** 新版详情页 JD 是 SSR 渲染的，从 DOM 读取正文（只读，不调接口） */
  | { type: 'CONTENT_READ_JD' }

export interface ContentResponse {
  ok: boolean
  reason: string
  /** 附加信息：附件名、命中的会话名、按钮状态等 */
  value?: string
}

export interface RuntimeStatus {
  capturing: boolean
  attachedTabId: number | null
  /** 已附着的标签数：列表页与详情页通常是两个标签，只附着 1 个就会漏读详情 */
  attachedTabCount: number
  jobs: number
  ready: number
  /** 还在等详情响应（没点开详情 / 详情页标签未附着） */
  needsDetail: number
  /** 已经判过、被活跃度闸门挡掉的条数 */
  filteredOut: number
  replied: number
  /** P2：已延迟落库（queued 投递）的条数 */
  synced: number
  /** P3：已产出定制版简历 + PDF 的条数 */
  tailored: number
  /** P3：PDF 已进 Boss 附件管理的条数 */
  uploaded: number
  /** P3c：读到我自己发出的消息、已推进 applied 的条数 */
  sent: number
  /** 已从会话列表响应里读到的会话总数（BOSS 会话列表分页，滚到底才会陆续读到） */
  conversations: number
  dryRun: boolean
  rateLimitTripped: boolean
  lastError?: string
}

/**
 * 跨上下文消息的版本号（参考 `boss-cli` 的 `{ ok, schema_version, data }`）。
 *
 * 扩展的三个上下文（popup / staging 页 / service worker）各自独立打包，重载扩展后
 * 已经打开着的 popup 仍是旧代码。字段改名时，旧 UI 读新 SW 的响应会**静默拿到 undefined**，
 * 表现成「计数一直是 0」这种难查的现象。带上版本号至少能在控制台一句话说清原因。
 */
export const MESSAGE_SCHEMA_VERSION = 1

export type RuntimeResponse =
  | {
    ok: true
    schemaVersion?: number
    status?: RuntimeStatus
    staged?: StagedJob[]
    conversations?: ConversationSnapshot[]
    settings?: BridgeSettings
    logs?: string[]
    result?: unknown
  }
  | { ok: false; schemaVersion?: number; error: string }

/** popup / options 与 background 之间的唯一消息入口，避免字符串散落。 */
export async function sendToBackground<T = unknown>(message: RuntimeRequest): Promise<T> {
  const response = await (chrome.runtime.sendMessage(message) as Promise<T>)
  const version = (response as { schemaVersion?: number } | null)?.schemaVersion
  if (version !== undefined && version !== MESSAGE_SCHEMA_VERSION) {
    // 不阻断：旧 popup 仍能用字段读到的部分工作，但要让原因可见，别让人以为扩展坏了
    console.warn(
      `[boss-bridge] 消息 schema 不一致：页面 ${MESSAGE_SCHEMA_VERSION} / 后台 ${version}。` +
      '请关闭并重新打开弹窗（扩展刚重载过）。',
    )
  }
  return response
}
