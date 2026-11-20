import { defineBackground } from 'wxt/utils/define-background'
import {
  ALARM_NAME,
  ALARM_PERIOD_MINUTES,
  AUTO_ALARM_NAME,
  AUTO_TICK_MINUTES,
  DEFAULT_SETTINGS,
  REPLY_LOOKBACK_MS,
  STORAGE_KEYS,
} from '../src/lib/constants.js'
import { detailGate } from '../src/lib/activity.js'
import { canSend, canUpload, sanitizeFileName } from '../src/lib/attachment.js'
import { LandBridge } from '../src/lib/bridge.js'
import type { ContentRequest, ContentResponse, RuntimeRequest, RuntimeResponse, RuntimeStatus } from '../src/lib/messages.js'
import { MESSAGE_SCHEMA_VERSION } from '../src/lib/messages.js'
import { detectSent } from '../src/lib/outgoing.js'
import { parseResponse, type CapturedResponse, type ConversationItem } from '../src/lib/parsers.js'
import { runPipeline, type ActionResult } from '../src/lib/pipeline.js'
import { RateLimiter, type PersistedRateLimit } from '../src/lib/rate-limit.js'
import {
  afterAction,
  afterFailure,
  decideAuto,
  defaultAutoSettings,
  emptyAutoState,
  afterSkip,
  localDay,
  startAutoState,
  stopAutoState,
  toAutoSnapshot,
  type AutoDecision,
  type AutoSettings,
  type AutoState,
  type AutoContext,
} from '../src/lib/orchestrator.js'
import { bestMatchingJob } from '../src/lib/match.js'
import { detectGreetSent, isDefaultGreeting, isPeerMessage, toSnapshot } from '../src/lib/reply.js'
import { bytesToBase64, tailorAndExport } from '../src/lib/resume.js'
import { PAGE_URLS } from '../src/lib/selectors.js'
import { syncOnReply, pushApplied, syncRepliedJob } from '../src/lib/sync.js'
import {
  applyDetail,
  applyGreet,
  applyJdFromDom,
  chromeKV,
  conversationKey as snapshotKey,
  createJobFromConversation,
  dedupeStaging,
  healStaging,
  mergeJobList,
  reverseJobKey,
  StagingStore,
} from '../src/lib/storage.js'
import { CATEGORY_LABELS } from '../src/lib/job-category.js'
import type { BridgeSettings, StagedJob, StagingData } from '../src/lib/types.js'

const kv = chromeKV()
const store = new StagingStore(kv)
const CHAT_URL = 'https://www.zhipin.com/web/geek/chat'

/**
 * 一个列表页 + 每个岗位详情页都是**不同标签页**（BOSS 岗位卡片默认新标签打开），
 * 只附着一个 tabId 会漏掉全部详情响应——实测症状就是「暂存一堆、通过闸门 0 条」。
 * 所以这里按标签页集合管理，并对新开的 zhipin 标签自动追加附着。
 */
const attachedTabs = new Set<number>()
/**
 * 待读响应：`responseReceived` 只记下 URL，**等 `loadingFinished` 再取响应体**。
 *
 * 这是 2026-11-13 实测踩到的最大坑：在 responseReceived 里立刻调
 * `Network.getResponseBody`，Chrome 会回 `-32000 No data found for resource with given identifier`
 * ——响应体还没下载完。结果 100 条的会话列表、岗位详情等大响应**全部读不到**，
 * 只有少数小响应侥幸成功；症状是「暂存岗位一堆，但会话只有 104 条、JD 全空、回复永远检测不到」。
 */
const pendingResponses = new Map<string, string>()
const PENDING_LIMIT = 400
const pendingKey = (tabId: number, requestId: string): string => `${tabId}:${requestId}`
let bodyReadFailures = 0
let lastError = ''
let logs: string[] = []
let limiter = new RateLimiter()

/**
 * 定制好的 PDF 字节只放内存：`chrome.storage.local` 存二进制会把配额吃光，
 * 而它只在「定制完成 → 上传附件」这几分钟里有意义。service worker 休眠后
 * 缓存丢失是可接受的——重新定制一次比存一份大文件更便宜。
 */
const pdfCache = new Map<string, { bytes: Uint8Array; fileName: string }>()

/** popup 日志是给用户看的，别把内部 state 名直接抛出去 */
/** 已经越过回复阶段的暂存状态（补判旧回复时用） */
const AFTER_REPLY_STATES: ReadonlySet<StagedJob['state']> = new Set([
  'replied', 'tailored', 'uploaded', 'sent', 'archived',
])

const STATE_LABEL: Record<string, string> = {
  discovered: '已发现',
  needs_detail: '待确认活跃度',
  ready: '可打招呼',
  filtered_out: 'HR 不活跃，已跳过',
  greeted: '已打招呼',
  replied: '对方已回复',
  tailored: '已定制简历',
  uploaded: '简历已上传',
  sent: '已发送',
  archived: '已归档',
}

function log(message: string): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`
  logs = [...logs.slice(-99), line]
  console.log('[boss-bridge]', message)
}

/**
 * 待机原因也要进日志。
 *
 * 之前只在真正执行动作时 log，idle/wait 只写进 state.waitReason——用户看到的是
 * "开了自动但什么都没发生"，事后连原因都查不到（state 会被下一次动作覆盖）。
 * 同一句原因只记一次，免得每分钟刷屏。
 */
let lastAutoNote = ''
function noteAutoIdle(reason: string): void {
  if (reason === lastAutoNote) return
  lastAutoNote = reason
  log(`自动化待机：${reason}`)
}

/** 复用已开的页面标签，没有就后台新建一个；返回 tabId 供内容脚本通信 */
async function ensureTab(url: string): Promise<number | null> {
  const pattern = `${url}*`
  const existing = (await chrome.tabs.query({ url: pattern })).find((tab) => tab.id !== undefined)
  if (existing?.id !== undefined) return existing.id
  try {
    const created = await chrome.tabs.create({ url, active: false })
    // 内容脚本注入要等页面起来，否则 sendMessage 会直接抛「Receiving end does not exist」
    await new Promise((resolve) => setTimeout(resolve, 2500))
    return created.id ?? null
  } catch (error) {
    log(`打开页面失败：${(error as Error).message}`)
    return null
  }
}

/** 内容脚本没注入（页面在扩展安装前就开着）时给出可执行的提示，而不是抛栈 */
async function sendToTab<T extends ContentResponse>(tabId: number, message: ContentRequest): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T
  } catch (error) {
    return {
      ok: false,
      reason: `内容脚本没响应（${(error as Error).message.slice(0, 80)}）；刷新一下该页面再试`,
    } as T
  }
}

async function getSettings(): Promise<BridgeSettings> {
  const saved = await kv.get<BridgeSettings>(STORAGE_KEYS.settings)
  /** 老版本存的设置没有新字段，读的时候补默认值，别让 undefined 漏到筛选逻辑里 */
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) }
}

/* ---------------- 全自动：决策在 orchestrator.ts，这里只负责执行与落盘 ---------------- */

const AUTO_GREET_CONFIRM_WAIT_MS = 2_500
/** 点过「立即沟通」但还没等到回执的记录，10 分钟内不再点第二次 */
const AUTO_GREET_RETRY_MS = 10 * 60 * 1000

async function getAutoSettings(): Promise<AutoSettings> {
  const saved = await kv.get<Partial<AutoSettings>>(STORAGE_KEYS.auto)
  return { ...defaultAutoSettings(), ...(saved ?? {}) }
}

async function saveAutoSettings(patch: Partial<AutoSettings>): Promise<AutoSettings> {
  const next = { ...(await getAutoSettings()), ...patch }
  await kv.set(STORAGE_KEYS.auto, next)
  return next
}

async function getAutoState(): Promise<AutoState> {
  const saved = await kv.get<AutoState>(STORAGE_KEYS.autoRun)
  return { ...emptyAutoState(localDay(Date.now())), ...(saved ?? {}) }
}

async function saveAutoState(state: AutoState): Promise<void> {
  await kv.set(STORAGE_KEYS.autoRun, state)
}

/**
 * 自动化只在**用户自己已经打开的 BOSS 页面**上操作。
 * 刻意不调 `tabs.create`：新开标签 + 停留 1 秒 + 关闭，这一串在服务端看就是脚本。
 *
 * 认两种页面：搜索/列表页（能翻页、能点卡片），和独立详情页（点卡片之后会落到这里）。
 * 后者是必须的——点卡片是整页导航，跳过去之后原来的「列表页」这个前提就不成立了。
 */
interface ZhipinTab {
  tabId: number
  kind: 'list' | 'detail'
  /** 详情页地址栏里的岗位 ID */
  jobId?: string
}

async function findZhipinTab(isActionable?: (jobId: string) => boolean): Promise<ZhipinTab | null> {
  const tabs = await chrome.tabs.query({
    url: ['https://www.zhipin.com/web/geek/jobs*', 'https://www.zhipin.com/job_detail/*'],
  })
  const usable = tabs.filter((t) => t.id !== undefined)
  if (usable.length === 0) return null

  const detailOf = (t: chrome.tabs.Tab) => /\/job_detail\/([^/?#]+)\.html/.exec(t.url ?? '')?.[1]
  const list = usable.find((t) => (t.url ?? '').includes('/web/geek/jobs'))
  /**
   * 用户停在某个岗位详情页，且这个岗位正好有待办 → 就在这一页动手。
   * 那是"我正在看这家"的明确信号，而且详情页一次只能操作一个岗位，范围最小。
   * 详情页的岗位没有待办时才回到列表页，否则会被一个旧标签页卡死。
   */
  const actionableDetail = usable.find((t) => {
    const id = detailOf(t)
    return Boolean(id && isActionable?.(id))
  })

  const chosen = actionableDetail ?? list ?? usable[0]
  if (chosen?.id === undefined) return null
  await attachTab(chosen.id)

  const jobId = detailOf(chosen)
  return {
    tabId: chosen.id,
    kind: jobId ? 'detail' : 'list',
    jobId,
  }
}

interface AutoOutcome {
  ok: boolean
  message: string
  /** 环境没准备好（扩展刚重载、页面没刷新），不该计入失败次数 */
  retryable?: boolean
  /** 这条岗位本身做不了（没有「立即沟通」等），跳过但不算失败 */
  skip?: boolean
}

/** 读一条候选的详情：点卡片（或就地读详情页）→ 读 DOM 的 JD → 按旁听到的活跃度判定 */
async function autoOpenDetail(key: string, tab: ZhipinTab): Promise<AutoOutcome> {
  if (tab.kind === 'detail') {
    if (tab.jobId !== key) {
      return { ok: false, message: `当前详情页是 ${tab.jobId ?? '未知岗位'}，不是目标岗位，未读取` }
    }
  } else {
    const opened = await sendToTab<ContentResponse>(tab.tabId, { type: 'CONTENT_OPEN_JOB_CARD', id: key })
    if (!opened.ok) return { ok: false, message: opened.reason }
  }

  /** 详情页正文在整页上，分栏页在右侧面板里，指令不同 */
  const readType: ContentRequest['type'] = tab.kind === 'detail' ? 'CONTENT_READ_JD' : 'CONTENT_READ_PANE_JD'

  /**
   * 换卡片后右侧面板要重新渲染，JD 不是立刻就有。
   * 单次读取实测经常读空（记成失败但旁听其实已经补上了），所以这里轮询等它出现。
   */
  let dom: ContentResponse = { ok: false, reason: '还没读' }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    dom = await sendToTab<ContentResponse>(tab.tabId, { type: readType } as ContentRequest)
    if (dom.ok && dom.value) break
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  if (!dom.ok || !dom.value) return { ok: false, message: dom.reason }

  let payload: { jdText: string; id?: string; brandName?: string; jobName?: string; salaryDesc?: string; city?: string }
  try {
    payload = JSON.parse(dom.value)
  } catch {
    return { ok: false, message: '详情面板的 JD 解析失败' }
  }
  /** 面板上如果还是上一个岗位，读到的 JD 就是别人的——宁可失败也不写错 */
  if (payload.id && payload.id !== key) {
    return { ok: false, message: `面板显示的不是这个岗位（当前 ${payload.id}）` }
  }

  const data = await store.load()
  const job = data.jobs[key]
  if (!job) return { ok: false, message: '暂存记录不存在' }

  applyJdFromDom(data, key, payload)
  if (job.bossActive.source === 'detail') {
    const decision = detailGate(job.bossActive, job.bossFreezeStatus, job.bossPreFreezeStatus, { now: Date.now() })
    job.state = decision.state
    job.notes = decision.reason
  }
  await store.save(data)
  return {
    ok: true,
    message: `${job.brandName}：已读详情（JD ${payload.jdText.length} 字，${
      job.state === 'needs_detail' ? '活跃度待详情响应' : job.state === 'ready' ? '可打招呼' : '已跳过'
    }）`,
  }
}

/**
 * 点「立即沟通」。
 *
 * 只点按钮：默认招呼语是页面自己在 `friend/add.json` 里发出的，扩展不构造、不调用写接口。
 * 点完不等状态机立即改写——`greeted` 一律由旁听回执写入，避免"点了但没发出去"被记成已触达。
 */
async function autoGreet(key: string, tab: ZhipinTab): Promise<AutoOutcome> {
  if (tab.kind === 'detail') {
    /** 就地点：详情页本身已经有按钮，不必再回列表点卡片 */
    if (tab.jobId !== key) {
      return { ok: false, message: `当前详情页是 ${tab.jobId ?? '未知岗位'}，不是目标岗位，已放弃点击` }
    }
  } else {
    const opened = await sendToTab<ContentResponse>(tab.tabId, { type: 'CONTENT_OPEN_JOB_CARD', id: key })
    if (!opened.ok) return { ok: false, message: opened.reason }
    await new Promise((resolve) => setTimeout(resolve, 1_200))
  }

  /** expectId 让内容脚本在点之前再核对一次岗位，点错公司不可逆 */
  const clicked = await sendToTab<ContentResponse>(tab.tabId, { type: 'CONTENT_CLICK_GREET', expectId: key })
  if (!clicked.ok) {
    /**
     * 页面上没有「立即沟通」：多半这条是同一个岗位的重复记录，或这家的招呼早就打过了。
     * 记下来当天不再挑它——否则每条这样的岗位都会计一次失败，5 条就把全自动停掉。
     */
    if (clicked.reason.includes('不可点')) {
      const snap = await store.load()
      const target = snap.jobs[key]
      if (target) {
        target.greetSkippedAt = Date.now()
        target.greetSkipReason = clicked.reason
        await store.save(snap)
        return {
          ok: false,
          skip: true,
          message: `${target.brandName}：「立即沟通」不可点（多半早就沟通过了），今天先跳过这条`,
        }
      }
    }
    return { ok: false, message: clicked.reason }
  }

  /** 先记下"点过"，万一回执没来，也不会在同一分钟里重复点第二次 */
  const before = await store.load()
  const target = before.jobs[key]
  if (target) {
    target.greetClickedAt = Date.now()
    await store.save(before)
  }

  await new Promise((resolve) => setTimeout(resolve, AUTO_GREET_CONFIRM_WAIT_MS))

  const data = await store.load()
  const job = data.jobs[key]
  if (job?.state === 'greeted') return { ok: true, message: `${job.brandName}：已打招呼（回执已确认）` }
  return { ok: true, message: `${job?.brandName ?? key}：已点「立即沟通」，等回执确认` }
}

async function executeAuto(decision: AutoDecision, tab: ZhipinTab): Promise<AutoOutcome> {
  const check = limiter.canAct()
  if (!check.ok && check.waitMs === 0) return { ok: false, message: check.reason }
  if (check.waitMs > 0) await new Promise((resolve) => setTimeout(resolve, check.waitMs))

  switch (decision.kind) {
    case 'scroll': {
      const res = await sendToTab<ContentResponse>(tab.tabId, { type: 'CONTENT_SCAN_JOBS', scroll: true })
      limiter.noteRequest()
      return res.ok ? { ok: true, message: res.reason } : { ok: false, message: res.reason }
    }
    case 'openDetail':
    case 'readJd':
      limiter.noteRequest()
      return autoOpenDetail(decision.jobKey, tab)
    case 'greet':
      limiter.noteRequest()
      return autoGreet(decision.jobKey, tab)
    case 'sendGreeting':
      return { ok: false, message: '自动发定制招呼语尚未接入（P3）' }
    case 'sendResume':
      return { ok: false, message: '自动发简历尚未接入（P4）' }
    default:
      return { ok: false, message: '未知动作' }
  }
}

/** 一次 tick 只做一个动作：service worker 可能随时休眠，长循环会被打断 */
async function tickAuto(): Promise<void> {
  const settings = await getAutoSettings()
  if (!settings.enabled) return

  const state = await getAutoState()
  const data = await store.load()
  const jobs = Object.values(data.jobs)
  const byAge = (a: StagedJob, b: StagedJob) => a.capturedAt - b.capturedAt
  /** 打招呼优先新抓的：8 天前的岗位多半已经招满，打了也是白发 */
  const byNewest = (a: StagedJob, b: StagedJob) => b.capturedAt - a.capturedAt
  const now = Date.now()

  /** 刚点过沟通、回执还没到的先排除，避免重复点；新的排前面 */
  const readyKeys = jobs
    .filter((j) => j.state === 'ready'
      && !(j.greetClickedAt && now - j.greetClickedAt < AUTO_GREET_RETRY_MS)
      /** 今天已经确认"页面上没有立即沟通"的不再挑（次日会自动恢复重试） */
      && !(j.greetSkippedAt && localDay(j.greetSkippedAt) === localDay(now)))
    .sort(byNewest)
    .map((j) => j.key)
  const readySet = new Set(readyKeys)

  const tab = await findZhipinTab((id) => readySet.has(id))
  if (tab === null) {
    const reason = '没有打开的 BOSS 岗位页（自动化只在你自己的页面上运行）'
    noteAutoIdle(reason)
    await saveAutoState({ ...state, waitReason: reason, lastTickAt: now })
    return
  }

  /**
   * 先探活：扩展重载后，已打开的页面上还是旧的 content script，
   * 直接发动作会得到「Receiving end does not exist」。这属于环境没就绪，
   * 不该计入失败次数（否则三次就把自己停了）。
   */
  const alive = await sendToTab<ContentResponse>(tab.tabId, { type: 'CONTENT_SELF_CHECK' })
  if (!alive.ok && /Receiving end does not exist|Could not establish connection/.test(alive.reason)) {
    const reason = 'BOSS 页面还没接管新代码，刷新一下该页面会自动继续'
    noteAutoIdle(reason)
    await saveAutoState({ ...state, waitReason: reason, lastTickAt: now })
    return
  }

  /**
   * 暂存区里可能有上百条记录，而列表页当前只渲染几十张卡片。
   * 先问页面有哪些卡片，只从「真的点得到」的记录里挑。
   * 详情页没有卡片，可操作的只有地址栏里那一个岗位。
   */
  const visibleIds = async (): Promise<Set<string>> => {
    if (tab.kind === 'detail') return new Set(tab.jobId ? [tab.jobId] : [])
    const res = await sendToTab<ContentResponse>(tab.tabId, { type: 'CONTENT_SCAN_JOBS', scroll: false })
    if (!res.ok || !res.value) return new Set()
    try {
      return new Set((JSON.parse(res.value) as { id?: string }[]).map((c) => c.id).filter(Boolean) as string[])
    } catch {
      return new Set()
    }
  }

  const ids = await visibleIds()
  /** 还没判活跃度的：必须先读，读完才知道能不能打招呼 */
  const detailTargets = jobs
    .filter((j) => j.state === 'needs_detail')
    .sort(byAge)
    .map((j) => j.key)
  /**
   * 已判过、只缺 JD 的：补 JD 只为定制简历服务，单独排队排在打招呼之后。
   * 之前和 detailTargets 混在一起，113 条存量让每一轮都在读详情，打招呼一次都轮不到。
   */
  const jdTargets = jobs
    .filter((j) => (j.state === 'ready' || j.state === 'greeted') && !j.jdText?.trim())
    .sort(byNewest)
    .map((j) => j.key)

  const reachable = (keys: string[]) => keys.filter((key) => ids.has(key))
  /** 只有「要读详情」时才需要翻页找人；翻页本身由 scroll 决策负责 */

  /** 详情页没法翻页，把 scan 关掉，免得决策一直在"翻一屏"上空转 */
  const effective = tab.kind === 'detail' ? { ...settings, scan: false } : settings

  const ctx: AutoContext = {
    now,
    settings: effective,
    state,
    tripped: limiter.snapshot.tripped,
    detailTargets: reachable(detailTargets),
    jdTargets: reachable(jdTargets),
    /**
     * 只从「屏幕上真的点得到」的岗位里挑。
     * 库里 ready 有一百多条，列表只渲染十几张卡片；不筛就会挑到屏幕外的 key，
     * 点空 → 失败 → 连续 5 次又把自己停下，表现就是「开了打招呼但一条没打」。
     */
    ready: reachable(readyKeys),
    pendingGreeting: jobs
      .filter((j) => j.state === 'greeted' && j.greetDraft && !j.greetSentAt)
      .sort(byNewest)
      .map((j) => j.key),
    pendingResume: [],
  }

  const decision = decideAuto(ctx)
  if (decision.kind === 'idle' || decision.kind === 'wait') {
    /**
     * 只有在决策本身说不出原因时（兜底的"没有待处理项"）才补一句"卡片不在本页"。
     * 之前无条件覆盖，把"预算已满"这类明确原因也盖成"没有待办卡片"，
     * 排查时会一路查错方向。
     */
    const vague = decision.kind === 'idle' && decision.reason.includes('当前没有待处理项')
    const reason = vague && detailTargets.length > 0 && ctx.detailTargets.length === 0
      ? `列表页上没有待办的岗位卡片（${detailTargets.length} 条候选不在当前搜索结果里，换个关键词或往下滚）`
      : decision.reason
    await saveAutoState({
      ...state,
      phase: decision.kind === 'idle' ? 'idle' : state.phase,
      waitReason: reason,
      lastTickAt: now,
    })
    noteAutoIdle(reason)
    return
  }

  const outcome = await executeAuto(decision, tab)
  const next = outcome.ok
    ? { ...afterAction(state, decision, Date.now(), effective), waitReason: outcome.message, lastTickAt: now }
    : outcome.skip
      ? { ...afterSkip(state, Date.now(), outcome.message), lastTickAt: now }
      : { ...afterFailure(state, Date.now(), outcome.message), lastTickAt: now }
  await saveAutoState(next)
  /** 动过手就把待机提示清掉，下次真正停下时能重新记一条 */
  lastAutoNote = ''
  log(`自动化${outcome.ok ? '' : outcome.skip ? '跳过' : '失败'}：${outcome.message}`)
  await persistLimiter()
}

async function getLimiter(): Promise<RateLimiter> {
  const saved = await kv.get<PersistedRateLimit>(STORAGE_KEYS.rateLimit)
  limiter = new RateLimiter(saved ?? null)
  return limiter
}

async function persistLimiter(): Promise<void> {
  await kv.set(STORAGE_KEYS.rateLimit, limiter.serialize())
}

async function attachTab(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return
  const debuggee: chrome.debugger.Debuggee = { tabId }
  await chrome.debugger.attach(debuggee, '1.3')
  await chrome.debugger.sendCommand(debuggee, 'Network.enable')
  attachedTabs.add(tabId)
  log(`已开始监听标签页 ${tabId}（只读取页面自己的请求，不发任何请求）`)
}

async function detachTab(tabId: number): Promise<void> {
  if (!attachedTabs.delete(tabId)) return
  try {
    await chrome.debugger.detach({ tabId })
  } catch { /* 标签页可能已关闭 */ }
}

/** 附着当前所有 zhipin 标签（列表页与详情页往往是两个标签） */
async function attachZhipinTabs(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: 'https://www.zhipin.com/*' })
  let attached = 0
  let lastMessage = ''
  for (const tab of tabs) {
    if (tab.id === undefined) continue
    try {
      await attachTab(tab.id)
      attached += 1
    } catch (error) {
      lastMessage = (error as Error).message
    }
  }
  if (attached === 0 && lastMessage) throw new Error(lastMessage)
  return attached
}

async function detach(): Promise<void> {
  for (const tabId of [...attachedTabs]) {
    try {
      await chrome.debugger.detach({ tabId })
    } catch { /* 标签页可能已关闭 */ }
  }
  attachedTabs.clear()
  log('已停止监听')
}

async function startCapture(): Promise<RuntimeResponse> {
  try {
    const count = await attachZhipinTabs()
    if (count === 0) return { ok: false, error: '没有打开的 zhipin.com 标签页，请先登录并打开岗位列表' }
    lastError = ''
    return { ok: true }
  } catch (error) {
    const message = (error as Error).message
    lastError = message
    return { ok: false, error: `${message}；若该标签页已打开 DevTools，请关掉后重试，或改用 Agent 人工通道` }
  }
}

/** 顶层业务响应码与风控文案：一旦命中立即熔断，整轮停机。 */
async function handleRisk(code: number, message: string): Promise<void> {
  // 平台硬限额优先：它给出的是确定数字，比正则猜文案更可靠，停机原因也更好懂
  const tripped = limiter.noteRiskSignal(code, message)
  await persistLimiter()
  if (tripped) {
    log(`已自动暂停：${limiter.snapshot.tripReason ?? message ?? `响应码 ${code}`}（不会自动重试）`)
    await detach()
  }
}

async function handleFriendList(conversations: ConversationItem[]): Promise<void> {
  const data = await store.load()
  healStaging(data)
  dedupeStaging(data)
  lastFriendListAt = Date.now()
  const previous = { ...data.conversations }
  const bridge = new LandBridge(await getSettings())
  const now = Date.now()
  let replies = 0
  let synced = 0
  let manual = 0
  let applied = 0
  let unmatched = 0
  let reversed = 0
  let newConvs = 0
  let greetSents = 0

  for (const conv of conversations) {
    const key = snapshotKey(conv.uid, conv.jobId)
    if (!data.conversations[key]) newConvs += 1
    let staged = findStagedForConversation(data, conv)
    const snapshot = toSnapshot(conv)
    if (snapshot) data.conversations[key] = snapshot

    const peerMsg = Boolean(snapshot) && isPeerMessage(conv)
    const seenBefore = previous[key]?.msgId === conv.msgId

    if (!staged && peerMsg) {
      /**
       * 关键：`findStagedForConversation` 故意排除 sent/archived，所以一条已经推进完的记录
       * 会「看起来没匹配」。反向补建前必须再查一次**所有状态**，否则每轮巡检都会给同一个会话
       * 再建一条重复记录（实测独创时代被建了第二条）。
       */
      const alreadyKnown = bestMatchingJob(Object.values(data.jobs), conv)
      const recent = conv.lastTS >= now - REPLY_LOOKBACK_MS
      if (!alreadyKnown && recent && !isDefaultGreeting(conv.lastMsg)) {
        const keyForReverse = reverseJobKey(conv)
        const isNewRecord = !data.jobs[keyForReverse]
        const created = createJobFromConversation(data, conv, now)
        if (created) {
          staged = created
          if (isNewRecord) {
            reversed += 1
            log(`${conv.brandName ?? key}：对方已回复但岗位列表没这条，已从会话反向补建（缺 JD，点开岗位详情页后会自动落库）`)
          }
        }
      } else {
        unmatched += 1
      }
    }

    /**
     * 补判：会话快照里早就存着一条「对方回复」，但当时因为判据 bug 没推进。
     * 若还停在回复之前的阶段，就当作第一次读到重新判一次；推进之后 AFTER_REPLY 会挡住，不会重复落库。
     */
    const backfill = peerMsg && seenBefore && staged && !AFTER_REPLY_STATES.has(staged.state)
    const prevForDecision = backfill ? undefined : previous[key]

    // P2：判定回复 → 推进状态 → 延迟落库，全部收敛在 syncOnReply，便于单测回放
    const outcome = await syncOnReply(conv, prevForDecision, staged, bridge, { log })
    if (outcome.manual) {
      manual += 1
      log(`${staged?.brandName ?? key}：用户已接手会话，自动化停止`)
    }
    if (outcome.synced && outcome.record) {
      replies += 1
      synced += 1
      log(`${staged?.brandName ?? key}：已写入 land-a-job（待投递）jobId=${outcome.record.jobId} / applicationId=${outcome.record.applicationId}（投递时间留空，等发完简历再补）`)
    } else if (staged?.state === 'replied' && !staged.landSync && !outcome.reason.includes('缺 JD')) {
      replies += 1
      log(`${staged.brandName}：${outcome.reason}`)
    }

    // 之前确认过「简历已发出」但当时缺 JD 没落库：这一步补上 applicationId 后立刻推进
    if (staged?.pendingApplied && staged.landSync?.applicationId) {
      const pending = staged.pendingApplied
      delete staged.pendingApplied
      const result = await pushApplied(staged, pending, bridge, { log })
      if (result.pushed) applied += 1
    }

    /**
     * 定制招呼语发出：打过招呼之后自己又发了一条非默认模板的消息。
     * 插件不点发送，只能靠会话列表被动读到——所以它依赖「检查新回复」或 60 分钟巡检。
     */
    const greetSentTarget = findStagedForGreetSent(data, conv)
    const greetSent = detectGreetSent(conv, greetSentTarget)
    if (greetSent.sent && greetSentTarget && greetSent.at) {
      greetSentTarget.greetSentAt = greetSent.at
      greetSentTarget.notes = `${greetSentTarget.notes ? `${greetSentTarget.notes}；` : ''}已发出定制招呼语${
        greetSent.matchedDraft ? '' : '（文案与草稿不同）'}`
      greetSents += 1
      log(`${greetSentTarget.brandName}：已确认发出定制招呼语（${greetSent.matchedDraft ? '与草稿一致' : '文案有改动'}）`)
    }

    // P3c：读到「附件简历已发送给对方」的系统回执（或兜底：自己发的消息）→ 推进 applied + 写时间线
    const sentTarget = findStagedForSent(data, conv)
    const sentDecision = detectSent(conv, sentTarget)
    if (sentDecision.sent && sentTarget) {
      if (!sentTarget.landSync?.applicationId) {
        /** 缺 JD 导致还没落库：把发送证据记下来，等 openDetailTab 补齐 JD 后自动补推 */
        sentTarget.pendingApplied = {
          at: sentDecision.at ?? now,
          msgId: sentDecision.msgId,
          evidence: sentDecision.evidence,
        }
        log(`${sentTarget.brandName}：已确认简历发出，等 JD 补齐写入 land-a-job 后自动推进为已投递`)
      } else {
        const result = await pushApplied(sentTarget, sentDecision, bridge, { log })
        if (result.pushed) applied += 1
      }
    }
  }

  await store.save(data)
  /** 回复已确认但缺 JD：只从用户已打开的详情页读 DOM，不新建任何标签 */
  await ensureJdForReplies(Object.values(data.jobs), bridge)
  /** 会话列表是分页的：把「读到多少条 / 累计多少条」写进日志，用户能直接核对 BOSS 页面上的总数 */
  log(`读到会话列表：本批 ${conversations.length} 条、新会话 ${newConvs} 条、累计 ${Object.keys(data.conversations).length} 条`)
  if (replies || manual || synced || applied || unmatched || reversed || greetSents) {
    log(`检查回复：新回复 ${replies} 条、定制版招呼语 ${greetSents} 条、写入 land-a-job ${synced} 条、推进投递 ${applied} 条、反向补建 ${reversed} 条、跳过（太旧/无公司名/对不上岗位）${unmatched} 条、你已接手 ${manual} 条`)
  }
}

/**
 * 会话列表的加密 ID 与岗位列表不是同一套（实测 104 条只对上 4 条），
 * 所以匹配统一走 match.ts 的加权打分，绝不能用「ID 不等就 false」短路。
 */
function findStagedForConversation(data: StagingData, conv: ConversationItem): StagedJob | undefined {
  return bestMatchingJob(Object.values(data.jobs), conv, (job) =>
    !job.manual && job.state !== 'sent' && job.state !== 'archived')
}

/** P3c 的目标：已落库、还在发简历阶段的记录（推进 applied 用） */
function findStagedForSent(data: StagingData, conv: ConversationItem): StagedJob | undefined {
  /** 不要求已有 landSync：先认下「简历已发出」这条证据，缺 JD 时由 pendingApplied 等落库后补推 */
  return bestMatchingJob(Object.values(data.jobs), conv, (job) =>
    (job.state === 'replied' || job.state === 'tailored' || job.state === 'uploaded')
    && !job.manual)
}

/**
 * 「定制招呼语发出」的落点：必须是**已经记过打招呼**的那条。
 * 同一岗位常有多条重复记录（securityId 会变），只在 greetedAt 存在的记录上写，
 * 免得把时间写到另一条 ready 副本上、UI 里还是空。
 */
function findStagedForGreetSent(data: StagingData, conv: ConversationItem): StagedJob | undefined {
  return bestMatchingJob(Object.values(data.jobs), conv, (job) =>
    job.greetedAt !== undefined && job.greetSentAt === undefined && !job.manual)
}

async function handleCaptured(url: string, body: unknown): Promise<void> {
  let captured: CapturedResponse | null
  try {
    captured = parseResponse(url, body)
  } catch (error) {
    log(`解析响应失败：${(error as Error).message}`)
    return
  }
  if (!captured) return

  switch (captured.kind) {
    case 'risk':
      await handleRisk(captured.code, captured.message)
      return
    case 'joblist': {
      const data = await store.load()
      const settings = await getSettings()
      const { added, updated, skipped } = mergeJobList(data, captured.jobs, Date.now(), undefined, settings.captureCategories)
      await store.save(data)
      limiter.noteRequest(captured.jobs.length)
      await persistLimiter()
      if (added || updated) log(`发现岗位：新增 ${added}、更新 ${updated}（只存在扩展里，不写入 land-a-job）`)
      if (skipped) {
        const kept = settings.captureCategories.length
          ? settings.captureCategories.map((id) => CATEGORY_LABELS[id]).join('/')
          : '全部类型'
        log(`按类型筛选跳过 ${skipped} 条（当前只收 ${kept}，在设置页可改）`)
      }
      return
    }
    case 'detail': {
      const data = await store.load()
      const key = applyDetail(data, captured.detail, (job) =>
        detailGate(job.bossActive, job.bossFreezeStatus, job.bossPreFreezeStatus),
      )
      await store.save(data)
      if (key) {
        const job = data.jobs[key]
        log(`读到岗位详情：${job?.brandName ?? ''} · ${job?.jobName ?? key} → ${STATE_LABEL[job?.state ?? ''] ?? job?.state}`)
      }
      return
    }
    case 'friendlist':
      await handleFriendList(captured.conversations)
      return
    case 'bossdata':
      if ((captured.freeze ?? 0) !== 0 || (captured.preFreeze ?? 0) !== 0) {
        log('发现招聘者账号状态异常，相关岗位会被跳过')
      }
      return
    case 'greet': {
      /**
       * 页面自己的默认招呼语响应＝用户点了「立即沟通」。这是**唯一**能证明「打过招呼」的证据，
       * 必须回写：缓存岗位的打招呼时间、以及「打完招呼才定制招呼语」这条顺序都靠它。
       */
      const data = await store.load()
      const hit = applyGreet(data, captured)
      if (!hit) {
        const id = captured.securityId ?? captured.encryptJobId ?? '无岗位标识'
        log(`观测到页面发的默认招呼语（${id}），但暂存区里没有对应岗位——先去岗位列表刷一次再打招呼`)
        return
      }
      await store.save(data)
      if (hit.recorded) {
        const job = data.jobs[hit.key]
        log(`${job?.brandName ?? hit.key}：已记录打招呼（点「筛选并生成招呼语」为它生成定制版）`)
      }
      return
    }
    default:
      return
  }
}

/** 会话页多久没产出过 friend-list 响应就刷新一次；不刷新就永远看不到新回复 */
const CHAT_REFRESH_AFTER_MS = 45 * 60 * 1000
/** 最后一次读到 friend-list 的时间；巡检据此决定要不要重新拉列表 */
let lastFriendListAt = 0

/**
 * 会话列表分页懒加载：只滚动到列表底部，让页面自己去请求后续页。
 * 扩展不点击任何会话、不输入文字、不调用接口；响应仍由 debugger 被动旁听。
 */
async function scrollChatList(tabId: number): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await sendToTab<ContentResponse>(tabId, { type: 'CONTENT_SCROLL_CONVERSATIONS' })
    if (result.ok) {
      log(`会话列表：${result.reason}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  log('会话列表滚动没成功（内容脚本未注入？刷新消息页后再点一次「检查新回复」）')
}

/** 巡检：确保有一个会话页标签并附着，页面自身发出的 friend-list 会被被动读到。 */
async function watchReplies(force = false): Promise<void> {
  const health = await new LandBridge(await getSettings()).health()
  if (!health.ok) {
    log(`会话健康探测失败：${health.message}，本轮跳过`)
    return
  }
  if (limiter.snapshot.tripped) {
    log('已触发频率保护，本轮跳过（需在 popup 点「解除保护」）')
    return
  }
  let tab = (await chrome.tabs.query({ url: CHAT_URL })).find((t) => t.id !== undefined)
  if (!tab?.id) {
    tab = await chrome.tabs.create({ url: CHAT_URL, active: false })
  }
  if (!tab.id) return
  if (!attachedTabs.has(tab.id)) {
    try { await attachTab(tab.id) } catch (error) { log(`监听会话页失败：${(error as Error).message}`) }
  }
  /**
   * 关键：会话页是 SPA，标签一直挂着就不会重新请求 `getGeekFriendList`，
   * 只在长连接里收消息——而扩展只旁听 HTTP 响应，于是「公司回了但扩展一直不知道」。
   * 所以隔一段时间让页面自己重新加载一次（纯导航，不调写接口）；
   * 标签正被你使用时跳过，免得打断输入。
   */
  const stale = force || Date.now() - lastFriendListAt > CHAT_REFRESH_AFTER_MS
  if (stale && tab.active && !force) {
    log('会话页正在前台使用，本轮不刷新；切到后台后会自动刷新')
  } else if (stale) {
    try {
      await chrome.tabs.reload(tab.id)
      log('已刷新会话页，让页面重新拉取消息列表（只读）')
      // 等页面重新起来，内容脚本才收得到消息
      await new Promise((resolve) => setTimeout(resolve, 1800))
    } catch (error) {
      log(`刷新会话页失败：${(error as Error).message}`)
    }
  }
  /**
   * 页面上有 120 个会话、扩展只读到 104 个，差的那 16 个在后续分页里。
   * 前台正在使用时不打扰，其余情况（含用户点「检查新回复」）滚到底把分页加载出来。
   */
  if (!tab.active || force) await scrollChatList(tab.id)
  log('开始检查回复（只读页面自己的请求）')
}

/** 自动复核一条候选的最长等待：详情响应通常 2~5 秒到，留足慢网余量 */
const DETAIL_WAIT_MS = 20_000

/**
 * 打开候选详情页，等被动旁听把 `activeTimeDesc` / JD 正文写进暂存区，再关掉自己开的标签。
 * 纯页面导航：不调用任何 `/wapi/*` 写接口，也不点页面上的任何按钮。
 *
 * 带 bridge 时顺手补一件事：已经判定「对方回复」但缺 JD 的记录，读到详情后立刻重试延迟落库，
 * 免得它永远停在 replied、要等下一次会话页刷新才被想起来。
 */
async function openDetailTab(job: StagedJob, bridge?: LandBridge): Promise<ActionResult> {
  let tabId: number | undefined
  try {
    const tab = await chrome.tabs.create({ url: detailUrlFor(job), active: false })
    tabId = tab.id
    if (tabId === undefined) return { ok: false, message: '新建详情标签页失败' }
    await attachTab(tabId)
    const deadline = Date.now() + DETAIL_WAIT_MS

    /** JD 到位后统一做一次「补落库 + 补推 applied」，两条路径共用 */
    const finishWithJd = async (data: StagingData): Promise<ActionResult> => {
      const current = data.jobs[job.key]
      if (bridge && current?.state === 'replied' && !current.landSync && current.jdText?.trim()) {
        try {
          const record = await syncRepliedJob(current, bridge, { log })
          current.landSync = record
          log(`${current.brandName}：JD 补齐后已写入 land-a-job（待投递）jobId=${record.jobId}`)
          if (current.pendingApplied) {
            const pending = current.pendingApplied
            delete current.pendingApplied
            const pushed = await pushApplied(current, pending, bridge, { log })
            if (!pushed.pushed) log(`${current.brandName}：补推 applied 失败（${pushed.reason}），下轮重试`)
          }
        } catch (error) {
          log(`${current.brandName}：JD 补齐后落库失败（${(error as Error).message}），下轮重试`)
        }
      }
      /** DOM 路径读到的 JD 必须落盘，即使这次不满足落库条件（比如还没判回复） */
      await store.save(data)
      return { ok: true }
    }

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 700))
      const data = await store.load()
      const current = data.jobs[job.key]
      // 旧版详情页：被动读到 detail.json 已经写好 JD
      if (current?.bossActive.source === 'detail' || current?.jdText) return finishWithJd(data)

      /** 新版详情页：SSR，JD 在 DOM 里；内容脚本没注入时下一轮重试，正好等页面加载 */
      const dom = await sendToTab<ContentResponse>(tabId, { type: 'CONTENT_READ_JD' })
      if (!dom.ok || !dom.value) continue
      try {
        const fresh = await store.load()
        if (applyJdFromDom(fresh, job.key, JSON.parse(dom.value))) {
          log(`${fresh.jobs[job.key]?.brandName ?? job.brandName}：已从详情页读取 JD 正文`)
          return finishWithJd(fresh)
        }
      } catch (error) {
        log(`解析详情页 JD 失败：${(error as Error).message}`)
      }
    }
    return { ok: false, message: `${DETAIL_WAIT_MS / 1000} 秒内没读到 JD（可能要登录，或详情页结构改版）` }
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  } finally {
    if (tabId !== undefined) {
      await detachTab(tabId)
      try { await chrome.tabs.remove(tabId) } catch { /* 已关闭 */ }
    }
  }
}

/**
 * 新版详情页 URL：路径用 `encryptJobId`，`securityId` 走查询参数。
 * 历史存档里的 `job.url` 是旧格式（`/job_detail/<长securityId>.html`），这里统一重建，
 * 免得补读 JD 时打开一个没有岗位内容的页面。
 */
function detailUrlFor(job: StagedJob): string {
  if (!job.encryptJobId) return job.url
  const securityId = job.key.startsWith('chat:') ? '' : `?securityId=${encodeURIComponent(job.key)}`
  return `https://www.zhipin.com/job_detail/${job.encryptJobId}.html${securityId}`
}

/**
 * 补 JD 时**只从用户已经打开的详情页标签读 DOM，绝不主动新建标签页**。
 *
 * 反爬视角：`chrome.tabs.create()` 是一次真实导航，会带出一串 HTML/JS/wapi 请求，
 * 短时间批量开、停留 1~3 秒就关，这种「无鼠标、后台、短停留」的序列才是服务端能看见的异常；
 * 读 DOM 本身不产生任何请求。所以这里严格复用用户自己点开的页面，零额外导航。
 */
async function ensureJdForReplies(jobs: StagedJob[], bridge: LandBridge): Promise<void> {
  const targets = jobs.filter((job) => job.state === 'replied' && !job.landSync
    && !job.jdText?.trim() && Boolean(job.encryptJobId))
  if (!targets.length) return

  let tabs: chrome.tabs.Tab[] = []
  try {
    tabs = await chrome.tabs.query({ url: 'https://www.zhipin.com/job_detail/*' })
  } catch { return }

  for (const job of targets.slice(0, 5)) {
    const tab = tabs.find((t) => t.id !== undefined && t.url?.includes(`/job_detail/${job.encryptJobId}`))
    if (!tab?.id) continue
    const dom = await sendToTab<ContentResponse>(tab.id, { type: 'CONTENT_READ_JD' })
    if (!dom.ok || !dom.value) continue
    try {
      const data = await store.load()
      if (!applyJdFromDom(data, job.key, JSON.parse(dom.value))) continue
      const current = data.jobs[job.key]
      if (current?.state === 'replied' && !current.landSync && current.jdText?.trim()) {
        try {
          const record = await syncRepliedJob(current, bridge, { log })
          current.landSync = record
          log(`${current.brandName}：JD 已补齐，写入 land-a-job jobId=${record.jobId}`)
          if (current.pendingApplied) {
            const pending = current.pendingApplied
            delete current.pendingApplied
            await pushApplied(current, pending, bridge, { log })
          }
        } catch (error) {
          log(`${current.brandName}：补 JD 后落库失败（${(error as Error).message}），下轮重试`)
        }
      }
      await store.save(data)
    } catch (error) {
      log(`${job.brandName}：读取已打开详情页失败（${(error as Error).message}）`)
    }
  }
}

export default defineBackground(() => {
  // 监听必须注册在 main 里：WXT 生成类型时只解析入口，不该真的执行 chrome API。
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId
    if (!tabId || !attachedTabs.has(tabId)) return
    const event = (params ?? {}) as {
      requestId?: string
      response?: { url?: string }
    }
    const requestId = event.requestId
    if (!requestId) return

    if (method === 'Network.responseReceived') {
      const url = event.response?.url ?? ''
      if (!url.includes('zhipin.com/wapi/')) return
      if (pendingResponses.size >= PENDING_LIMIT) {
        const oldest = pendingResponses.keys().next().value
        if (oldest) pendingResponses.delete(oldest)
      }
      pendingResponses.set(pendingKey(tabId, requestId), url)
      return
    }

    if (method !== 'Network.loadingFinished' && method !== 'Network.loadingFailed') return
    const key = pendingKey(tabId, requestId)
    const url = pendingResponses.get(key)
    pendingResponses.delete(key)
    if (!url || method !== 'Network.loadingFinished') return

    void (async () => {
      const debuggee: chrome.debugger.Debuggee = { tabId }
      const readBody = async () => chrome.debugger.sendCommand(
        debuggee, 'Network.getResponseBody', { requestId },
      ) as { body?: string; base64Encoded?: boolean }
      try {
        let result: { body?: string; base64Encoded?: boolean }
        try {
          result = await readBody()
        } catch {
          // 极少数情况下 loadingFinished 与体可读之间还有一点延迟，重试一次
          await new Promise((resolve) => setTimeout(resolve, 120))
          result = await readBody()
        }
        if (!result?.body) return
        const raw = result.base64Encoded
          ? new TextDecoder().decode(Uint8Array.from(atob(result.body), (c) => c.charCodeAt(0)))
          : result.body
        await handleCaptured(url, JSON.parse(raw))
      } catch (error) {
        // 少数 204 / 预检没有响应体，属正常；每 20 次聚合报一次，别把有用日志淹了
        bodyReadFailures += 1
        if (bodyReadFailures % 20 === 0) {
          log(`读取响应体失败（累计 ${bodyReadFailures} 次）：${(error as Error).message}`)
        }
      }
    })()
  })

  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === undefined) return
    if (!attachedTabs.delete(source.tabId)) return
    log(attachedTabs.size === 0
      ? '监听已断开（页面关闭，或该页面打开了 DevTools）'
      : `页面 ${source.tabId} 的监听断开，其余页面继续监听`)
  })

  /** 岗位卡片点开详情通常新开标签页：新标签一出现就附着，否则详情响应全部漏读 */
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (attachedTabs.size === 0 || attachedTabs.has(tabId)) return
    const url = change.url ?? tab.url ?? ''
    if (!url.startsWith('https://www.zhipin.com/')) return
    void attachTab(tabId).catch((error) => log(`监听新标签失败：${(error as Error).message.slice(0, 80)}`))
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    attachedTabs.delete(tabId)
  })

  void (async () => {
    await getLimiter()
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES })
    log('扩展已启动（默认只出草稿，不会发送）')
  })()

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void watchReplies()
    if (alarm.name === AUTO_ALARM_NAME) void tickAuto()
  })

  /** service worker 被回收后 alarm 可能丢了，启动时按开关恢复一次 */
  void (async () => {
    const auto = await getAutoSettings()
    if (auto.enabled) {
      await chrome.alarms.create(AUTO_ALARM_NAME, { periodInMinutes: AUTO_TICK_MINUTES })
    }
  })()

  chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
    void (async (): Promise<RuntimeResponse> => {
      switch (message.type) {
        case 'GET_STATUS': {
          const data = await store.load()
          const healed = healStaging(data)
          /** 存量迁移：旧主键是 securityId，同岗位会有多条，读状态时顺手归并一次 */
          const deduped = dedupeStaging(data)
          if (healed || deduped.merged || deduped.renamed || deduped.filled) {
            await store.save(data)
            if (healed) log(`${healed} 条历史「待确认活跃度」记录已按 HR 在线证据自动放行`)
            if (deduped.merged || deduped.renamed) {
              log(`暂存区去重：合并 ${deduped.merged} 条重复记录、${deduped.renamed} 条主键改为岗位 ID`)
            }
            if (deduped.filled) log(`${deduped.filled} 条记录补回了 securityId 字段（详情页靠它对齐）`)
          }
          const jobs = Object.values(data.jobs)
          const settings = await getSettings()
          const status: RuntimeStatus = {
            capturing: attachedTabs.size > 0,
            attachedTabId: [...attachedTabs][0] ?? null,
            attachedTabCount: attachedTabs.size,
            jobs: jobs.length,
            ready: jobs.filter((j) => j.state === 'ready').length,
            /** 已在 BOSS 页面手动打过招呼：定制招呼语的输入只有这一类 */
            greeted: jobs.filter((j) => j.state === 'greeted').length,
            /** 0 条 ready 时最常见的解释：详情页还没被旁听到（没点开 / 在别的标签页） */
            needsDetail: jobs.filter((j) => j.state === 'needs_detail').length,
            filteredOut: jobs.filter((j) => j.state === 'filtered_out').length,
            replied: jobs.filter((j) => j.state === 'replied').length,
            synced: jobs.filter((j) => j.landSync).length,
            tailored: jobs.filter((j) => j.state === 'tailored').length,
            uploaded: jobs.filter((j) => j.state === 'uploaded').length,
            sent: jobs.filter((j) => j.state === 'sent').length,
            conversations: Object.keys(data.conversations).length,
            dryRun: settings.dryRun,
            rateLimitTripped: limiter.snapshot.tripped,
            lastError: lastError || undefined,
            auto: toAutoSnapshot(await getAutoState(), await getAutoSettings(), Date.now()),
          }
          return { ok: true, status }
        }
        case 'GET_STAGED': {
          const data = await store.load()
          const healed = healStaging(data)
          const deduped = dedupeStaging(data)
          if (healed || deduped.merged || deduped.renamed || deduped.filled) await store.save(data)
          return { ok: true, staged: Object.values(data.jobs) }
        }
        case 'GET_CONVERSATIONS': {
          const data = await store.load()
          return { ok: true, conversations: Object.values(data.conversations) }
        }
        case 'GET_SETTINGS':
          return { ok: true, settings: await getSettings() }
        case 'SET_SETTINGS':
          await kv.set(STORAGE_KEYS.settings, message.settings)
          log('配置已更新')
          return { ok: true }
        case 'START_CAPTURE':
          return startCapture()
        case 'STOP_CAPTURE':
          await detach()
          return { ok: true }
        case 'RUN_PIPELINE': {
          const settings = await getSettings()
          const result = await runPipeline({
            load: () => store.load(),
            save: (data) => store.save(data),
            limiter,
            settings,
            log,
            /** 「允许自动打开候选详情页」勾选后才生效；每次只开一条、走限速器 */
            openDetail: openDetailTab,
          })
          await persistLimiter()
          return { ok: true, result }
        }
        case 'CLEAR_DRAFTS': {
          const data = await store.load()
          let cleared = 0
          for (const job of Object.values(data.jobs)) {
            if (!job.greetDraft) continue
            delete job.greetDraft
            cleared += 1
          }
          await store.save(data)
          log(`已清掉 ${cleared} 条招呼语草稿，下次「筛选并生成招呼语」按当前模板重写`)
          return { ok: true }
        }
        case 'CHECK_REPLIES': {
          await watchReplies(true)
          return { ok: true }
        }
        case 'RUN_DELIVERY': {
          const settings = await getSettings()
          const keys = new Set(message.keys)
          const result = await runPipeline({
            load: () => store.load(),
            save: (data) => store.save(data),
            limiter,
            settings: { ...settings, dryRun: false },
            log,
            confirmBatch: async (items) => items.filter((item) => keys.has(item.key)),
            // P1 骨架不实现真实点击（P3 接入 content script）；显式返回失败，绝不误发
            sendGreeting: async () => ({ ok: false, message: '发送动作将在 P3 接入，本轮未发送' }),
          })
          await persistLimiter()
          return { ok: true, result }
        }
        case 'RUN_TAILOR': {
          const settings = await getSettings()
          const bridge = new LandBridge(settings)
          const data = await store.load()
          const keys = message.keys.length ? message.keys : Object.keys(data.jobs)
          const results: { key: string; ok: boolean; detail: string }[] = []

          for (const key of keys) {
            const job = data.jobs[key]
            if (!job) { results.push({ key, ok: false, detail: '暂存记录不存在' }); continue }
            if (job.manual) { results.push({ key, ok: false, detail: '用户已接手，跳过' }); continue }
            const gate = canUpload(job)
            if (!gate.ok) { results.push({ key, ok: false, detail: gate.reason }); continue }
            try {
              const tailored = await tailorAndExport(job, bridge)
              job.resumeVariantId = tailored.resumeId
              job.resumeExport = {
                fileName: sanitizeFileName(tailored.fileName),
                bytes: tailored.bytes.length,
                exportedAt: Date.now(),
              }
              job.state = 'tailored'
              job.notes = `${job.notes ?? ''}；已定制 ${tailored.resumeTitle}（${tailored.resumeId}），PDF ${Math.round(tailored.bytes.length / 1024)}KB`.trim()
              // 字节留在内存里等上传步骤用；storage 不存二进制
              pdfCache.set(key, { bytes: tailored.bytes, fileName: job.resumeExport.fileName })
              results.push({
                key,
                ok: true,
                detail: `${tailored.resumeTitle} → ${job.resumeExport.fileName}（${Math.round(tailored.bytes.length / 1024)}KB）`,
              })
              log(`${job.brandName}：定制完成 ${tailored.resumeTitle}，PDF ${Math.round(tailored.bytes.length / 1024)}KB`)
            } catch (error) {
              const message = (error as Error).message
              job.notes = `${job.notes ?? ''}；定制失败：${message}`.trim()
              results.push({ key, ok: false, detail: message })
              log(`${job.brandName}：定制失败 ${message}`)
            }
          }

          await store.save(data)
          return { ok: true, result: { results, okCount: results.filter((r) => r.ok).length } }
        }
        case 'RUN_UPLOAD': {
          const data = await store.load()
          const keys = message.keys.length ? message.keys : Object.keys(data.jobs)
          const results: { key: string; ok: boolean; detail: string }[] = []

          for (const key of keys) {
            const job = data.jobs[key]
            if (!job) { results.push({ key, ok: false, detail: '暂存记录不存在' }); continue }
            const cached = pdfCache.get(key)
            const gate = canUpload(job, cached?.bytes.length)
            if (!gate.ok) { results.push({ key, ok: false, detail: gate.reason }); continue }
            if (!cached) {
              results.push({ key, ok: false, detail: 'PDF 字节已不在内存（扩展重启过），请重新点一次「定制简历」' })
              continue
            }

            const tabId = await ensureTab(PAGE_URLS.attachments)
            if (tabId === null) { results.push({ key, ok: false, detail: '打不开附件管理页' }); continue }

            const response = await sendToTab<ContentResponse>(tabId, {
              type: 'CONTENT_UPLOAD_PDF',
              fileName: cached.fileName,
              base64: bytesToBase64(cached.bytes),
            })
            if (response.ok) {
              job.uploadedAt = Date.now()
              job.attachmentName = cached.fileName
              job.state = 'uploaded'
              job.notes = `${job.notes ?? ''}；已上传附件 ${cached.fileName}`.trim()
              log(`${job.brandName}：附件已上传（${response.reason}）`)
            } else {
              job.notes = `${job.notes ?? ''}；上传失败：${response.reason}`.trim()
              log(`${job.brandName}：上传失败 ${response.reason}`)
            }
            results.push({ key, ok: response.ok, detail: response.reason })
          }

          await store.save(data)
          return { ok: true, result: { results, okCount: results.filter((r) => r.ok).length } }
        }
        case 'RUN_OPEN_CHAT': {
          const data = await store.load()
          const keys = message.keys.length ? message.keys : Object.keys(data.jobs)
          const results: { key: string; ok: boolean; detail: string }[] = []

          for (const key of keys) {
            const job = data.jobs[key]
            if (!job) { results.push({ key, ok: false, detail: '暂存记录不存在' }); continue }
            const gate = canSend(job)
            if (!gate.ok) { results.push({ key, ok: false, detail: gate.reason }); continue }

            const tabId = await ensureTab(PAGE_URLS.chat)
            if (tabId === null) { results.push({ key, ok: false, detail: '打不开消息页' }); continue }

            const opened = await sendToTab<ContentResponse>(tabId, {
              type: 'CONTENT_OPEN_CONVERSATION',
              brandName: job.brandName,
            })
            if (!opened.ok) {
              results.push({ key, ok: false, detail: opened.reason })
              log(`${job.brandName}：打开会话失败 ${opened.reason}`)
              continue
            }

            const button = await sendToTab<ContentResponse>(tabId, { type: 'CONTENT_CHECK_RESUME_BUTTON' })
            const detail = button.ok
              ? `${opened.reason}；「发简历」可点，请你在页面上选中刚上传的附件并发送`
              : `${opened.reason}；「发简历」当前不可点：${button.reason}`
            results.push({ key, ok: true, detail })
            job.notes = `${job.notes ?? ''}；${detail}`.trim()
            log(`${job.brandName}：${detail}`)
          }

          await store.save(data)
          return { ok: true, result: { results } }
        }
        case 'START_AUTO': {
          const settings = await saveAutoSettings({ enabled: true })
          const state = startAutoState(await getAutoState(), Date.now())
          await saveAutoState(state)
          await chrome.alarms.create(AUTO_ALARM_NAME, { periodInMinutes: AUTO_TICK_MINUTES })
          log('已开启全自动：每分钟推进一个动作，随时可以暂停')
          void tickAuto()
          return { ok: true, result: toAutoSnapshot(state, settings, Date.now()) }
        }
        case 'STOP_AUTO': {
          const settings = await saveAutoSettings({ enabled: false })
          const state = stopAutoState(await getAutoState(), '你手动停止了全自动')
          await saveAutoState(state)
          await chrome.alarms.clear(AUTO_ALARM_NAME)
          log('已停止全自动')
          return { ok: true, result: toAutoSnapshot(state, settings, Date.now()) }
        }
        case 'GET_AUTO':
          return {
            ok: true,
            result: toAutoSnapshot(await getAutoState(), await getAutoSettings(), Date.now()),
          }
        case 'SET_AUTO_SETTINGS': {
          const before = await getAutoSettings()
          const settings = await saveAutoSettings(message.auto)
          /** 开关变更记一行：事后排查"到底开的是哪一项"全靠它 */
          const labels: Record<string, string> = {
            scan: '自动翻页', scanDetail: '自动读详情', greet: '自动打招呼',
            sendGreeting: '自动发定制语', sendResume: '自动发简历',
          }
          const changed = Object.keys(labels)
            .filter((k) => (before as unknown as Record<string, boolean>)[k] !== (settings as unknown as Record<string, boolean>)[k])
            .map((k) => `${labels[k]}→${(settings as unknown as Record<string, boolean>)[k] ? '开' : '关'}`)
          if (changed.length) log(`自动化开关变更：${changed.join('、')}`)
          if (settings.enabled) {
            await chrome.alarms.create(AUTO_ALARM_NAME, { periodInMinutes: AUTO_TICK_MINUTES })
          } else {
            await chrome.alarms.clear(AUTO_ALARM_NAME)
          }
          return {
            ok: true,
            result: toAutoSnapshot(await getAutoState(), settings, Date.now()),
          }
        }
        case 'RESET_LIMITER':
          limiter.reset()
          await persistLimiter()
          log('已解除保护')
          return { ok: true }
        case 'TEST_BRIDGE': {
          const health = await new LandBridge(await getSettings()).health()
          return health.ok
            ? { ok: true, result: { message: '本地服务可达，令牌有效' } }
            : { ok: false, error: health.message }
        }
        case 'GET_LOGS':
          return { ok: true, logs }
        default:
          return { ok: false, error: '未知消息类型' }
      }
    })()
      .then((response) => sendResponse({ schemaVersion: MESSAGE_SCHEMA_VERSION, ...response }))
      .catch((error: Error) => sendResponse({
        ok: false,
        schemaVersion: MESSAGE_SCHEMA_VERSION,
        error: error.message,
      }))
    return true
  })
})
