import { STAGING_LIMITS, STORAGE_KEYS } from './constants.js'
import { canonicalJdUrl, sanitizeUntrustedText, type ConversationItem, type DetailCaptured, type JobListItem } from './parsers.js'
import { listGate } from './activity.js'
import { normalizeBrand } from './match.js'
import type { ConversationSnapshot, StagedJob, StagingData, StageState } from './types.js'

export interface KVStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

/** WXT/MV3 下用 chrome.storage.local；单测里换成内存实现。 */
export function chromeKV(): KVStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const result = await chrome.storage.local.get(key)
      return result[key] as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      await chrome.storage.local.set({ [key]: value })
    },
  }
}

export function memoryKV(seed: Record<string, unknown> = {}): KVStore {
  const data: Record<string, unknown> = { ...seed }
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data[key] as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      data[key] = value
    },
  }
}

export function emptyStaging(now = Date.now(), day = new Date(now).toISOString().slice(0, 10)): StagingData {
  return {
    jobs: {},
    conversations: {},
    runDay: day,
    dailyCount: 0,
    dailyDay: day,
    requestBudgetUsed: 0,
    lastUpdated: now,
  }
}

function jobKey(item: JobListItem): string {
  return item.securityId || item.encryptJobId || `${item.brandName}::${item.jobName}`
}

/**
 * 列表刷新绝不能回退的状态：这些都是「已经发生过 / 已经判过的事实」。
 * `ready` 也在内——它可能来自「列表 bossOnline=true」这一条证据，
 * 不加进来就会在下次滚动列表时被打回 needs_detail，闸门计数来回跳。
 */
const LOCKED_STATES: ReadonlySet<StageState> = new Set([
  'ready', 'greeted', 'replied', 'tailored', 'uploaded', 'sent', 'archived',
])

/** 已经发生过「打招呼或之后」的事实：详情响应只能补字段，不能重判活跃度把状态打回去 */
const AFTER_GREET_STATES: ReadonlySet<StageState> = new Set([
  'greeted', 'replied', 'tailored', 'uploaded', 'sent', 'archived',
])

/**
 * 纯函数：把列表项合并进暂存区，返回新增/更新数量。
 *
 * 两个约束（都是踩过的坑）：
 * 1. `...existing` 打底——列表项只覆盖「列表才有的粗字段」。早期版本整对象重建，
 *    滚动一次列表就把 `landSync` / `resumeVariantId` / `manual` 全抹了。
 * 2. 详情已经判过（`source === 'detail'`）就保留活跃度结论。列表只有 `bossOnline`
 *    一个粗信号，用它覆盖详情会把 `activeTimeDesc` 清空、把 `ready` 打回 `needs_detail`。
 */
export function mergeJobList(
  data: StagingData,
  items: JobListItem[],
  now = Date.now(),
  day = new Date(now).toISOString().slice(0, 10),
): { added: number; updated: number } {
  let added = 0
  let updated = 0
  const isNewRound = data.runDay !== day
  for (const item of items) {
    if (!item.securityId && !item.encryptJobId && !item.jobName) continue
    const key = jobKey(item)
    if (!key) continue
    const existing = data.jobs[key]
    const decision = listGate(item)
    const detailDecided = existing?.bossActive.source === 'detail'
    /** 详情判过、或已经走到下游：结论连同 notes 一起保留，别用列表粗筛覆盖 */
    const keepDecision = Boolean(existing && (detailDecided || LOCKED_STATES.has(existing.state)))
    const state: StageState = keepDecision && existing ? existing.state : decision.state
    const staged: StagedJob = {
      ...existing,
      key,
      origin: existing?.origin ?? 'joblist',
      /**
       * 新版详情页实测 URL：路径用 `encryptJobId`，长的 `securityId` 放查询参数。
       * 旧版写成 `/job_detail/<长securityId>.html` 打开后没有 JD 接口、页面也拿不到正确岗位。
       */
      url: canonicalJdUrl(
        item.encryptJobId
          ? `https://www.zhipin.com/job_detail/${item.encryptJobId}.html${item.securityId ? `?securityId=${encodeURIComponent(item.securityId)}` : ''}`
          : `https://www.zhipin.com/web/geek/jobs#${encodeURIComponent(key)}`,
      ),
      jobName: item.jobName || existing?.jobName || '',
      brandName: item.brandName || existing?.brandName || '',
      salaryDesc: item.salaryDesc ?? existing?.salaryDesc,
      city: item.city ?? existing?.city,
      encryptJobId: item.encryptJobId ?? existing?.encryptJobId,
      encryptBossId: item.encryptBossId ?? existing?.encryptBossId,
      lid: item.lid ?? existing?.lid,
      bossActive: detailDecided && existing
        ? existing.bossActive
        : { online: item.bossOnline, capturedAt: now, source: 'list' },
      state,
      isNew: !existing || isNewRound,
      capturedAt: existing?.capturedAt ?? now,
      notes: keepDecision ? existing?.notes : decision.reason,
    }
    if (existing) updated += 1
    else added += 1
    data.jobs[key] = staged
  }
  data.runDay = day
  data.lastUpdated = now
  return { added, updated }
}

/**
 * 历史记录自愈：旧版 `listGate` 把 `bossOnline=true` 也压成 `needs_detail`，
 * 用户不手动点「筛选」就永远停在「待确认活跃度」。这里把「列表明确在线、且没被详情复核推翻」
 * 的记录直接放行；纯函数，调用方负责 save。
 */
export function healStaging(data: StagingData): number {
  let healed = 0
  for (const job of Object.values(data.jobs)) {
    if (job.state !== 'needs_detail') continue
    if (job.bossActive?.source !== 'list' || job.bossActive.online !== true) continue
    job.state = 'ready'
    job.notes = '列表显示 HR 在线，已自动放行（历史待确认记录自愈）'
    healed += 1
  }
  return healed
}

/** 从会话列表反向补建的记录用独立键空间，幂等且不撞 joblist 的 securityId */
export function reverseJobKey(conv: Pick<ConversationItem, 'uid' | 'jobId'>): string {
  return `chat:${conv.uid}:${conv.jobId ?? 0}`
}

/**
 * 「公司回了，但列表页没抓到这个岗位」时从会话反建一条最小暂存记录。
 * 故意不带 JD、不带岗位名：`syncRepliedJob` 会因缺 JD 拒绝落库，避免往岗位库灌脏数据；
 * 之后用户点开该岗位详情页，`applyDetail` 会按公司名把 JD 补进来，下一轮巡检自动重试。
 */
export function createJobFromConversation(
  data: StagingData,
  conv: ConversationItem,
  now = Date.now(),
): StagedJob | null {
  const key = reverseJobKey(conv)
  const existing = data.jobs[key]
  if (existing) return existing
  if (!conv.brandName?.trim()) return null

  const job: StagedJob = {
    key,
    origin: 'conversation',
    /**
     * 必须是**每条唯一**的 JD 链接。早期写成 `/web/geek/chat#chat:...`，
     * `canonicalJdUrl` 会把不带岗位号的 hash 去掉，所有反向记录规范化成同一个 URL，
     * 服务端 `findJobByUrl` 于是把 4 家不同公司判成同一个岗位、共用一条投递（实测踩过）。
     */
    url: conv.encryptJobId
      ? `https://www.zhipin.com/job_detail/${conv.encryptJobId}.html`
      : `https://www.zhipin.com/web/geek/chat?uid=${conv.uid}&jobId=${conv.jobId ?? 0}`,
    jobName: '',
    brandName: conv.brandName,
    encryptBossId: conv.encryptBossId,
    encryptJobId: conv.encryptJobId,
    bossActive: { capturedAt: now, source: 'list' },
    state: 'replied',
    isNew: true,
    capturedAt: now,
    repliedAt: conv.lastTS || now,
    replyMsgId: conv.msgId,
    conversationId: conversationKey(conv.uid, conv.jobId),
    notes: '从会话列表反向补建：对方已回复，但岗位列表没抓到这条。缺 JD 与岗位名，点开该岗位详情页后会自动补齐再落库。',
  }
  data.jobs[key] = job
  data.lastUpdated = now
  return job
}

export interface DomJdPayload {
  jdText: string
  brandName?: string
  jobName?: string
  salaryDesc?: string
  city?: string
}

/**
 * 新版 BOSS 详情页是 SSR：JD 直接渲染在 `.job-sec-text` 里，不再请求
 * `/wapi/zpgeek/job/detail.json`（2026-11-13 抓包确认）。所以 JD 从内容脚本读 DOM 得到。
 * 只补字段、不重判活跃度，更绝不改变已经推进过的 state。
 */
export function applyJdFromDom(data: StagingData, key: string, payload: DomJdPayload, now = Date.now()): boolean {
  const job = data.jobs[key]
  const text = sanitizeUntrustedText(String(payload.jdText ?? ''))
  if (!job || text.length < 20) return false
  job.jdText = text
  /** 列表页给的字段更准（DOM 里的岗位名会被截断、公司名可能带后缀），只补空、不覆盖 */
  if (payload.brandName && !job.brandName) job.brandName = payload.brandName
  if (payload.jobName && !job.jobName) job.jobName = payload.jobName
  if (payload.salaryDesc && !job.salaryDesc) job.salaryDesc = payload.salaryDesc
  if (payload.city && !job.city) job.city = payload.city
  job.notes = `${job.notes ?? ''}；已从详情页读取 JD（${text.length} 字）`.trim()
  data.lastUpdated = now
  return true
}

/** 纯函数：详情响应到达时复核活跃度并补 JD 正文（JD 仍只在暂存区）。 */
export function applyDetail(
  data: StagingData,
  detail: DetailCaptured,
  decide: (job: StagedJob) => { state: 'needs_detail' | 'ready' | 'filtered_out'; reason: string },
  now = Date.now(),
): string | null {
  /** 反向补建的记录没有 securityId 主键，只能按公司名把它和刚读到的详情接上 */
  const reverseKey = Object.keys(data.jobs).find((k) => {
    const job = data.jobs[k]
    return job?.origin === 'conversation' && !job.jdText && !job.jobName
      && normalizeBrand(job.brandName) === normalizeBrand(detail.brandName)
  })
  const key = (detail.securityId && data.jobs[detail.securityId] ? detail.securityId : undefined)
    ?? Object.keys(data.jobs).find((k) =>
      data.jobs[k]?.jobName === detail.jobName && data.jobs[k]?.brandName === detail.brandName)
    ?? reverseKey
  if (!key) return null
  const job = data.jobs[key]
  if (!job) return null
  /** 详情只在打招呼之前用来复核活跃度；已经推进过的记录不能被打回 ready/filtered_out */
  if (AFTER_GREET_STATES.has(job.state)) {
    if (detail.securityId && job.origin === 'conversation') {
      job.url = canonicalJdUrl(`https://www.zhipin.com/job_detail/${detail.securityId}.html`)
    }
    if (!detail.jdTruncated) job.jdText = detail.jdText
    job.jobName = detail.jobName || job.jobName
    job.brandName = detail.brandName || job.brandName
    job.city = detail.city || job.city
    job.salaryDesc = detail.salaryDesc || job.salaryDesc
    job.notes = `${job.notes ?? ''}；已读到岗位详情，JD 正文已补齐，下一轮巡检会重试落库`.trim()
    data.lastUpdated = now
    return key
  }

  job.bossActive = detail.bossActive
  job.brandName = detail.brandName || job.brandName
  job.jobName = detail.jobName || job.jobName
  job.salaryDesc = detail.salaryDesc || job.salaryDesc
  job.city = detail.city || job.city
  if (!detail.jdTruncated) job.jdText = detail.jdText

  const decision = decide(job)
  job.state = decision.state
  job.notes = decision.reason
  if (detail.jdTruncated) job.notes = `${decision.reason}；JD 正文被截断或需登录，未采用`
  data.lastUpdated = now
  return key
}

/**
 * 页面自己发的默认招呼语（`friend/add.json` 响应）回写到暂存区。
 *
 * 为什么必须回写：扩展**从不代发**招呼语，用户是在 BOSS 页面上点的「立即沟通」，
 * 而「打过招呼」是后续一切的前提——只有打过招呼，定制招呼语才有地方可发。
 * 早期这里只打一行日志，于是缓存岗位里永远没有打招呼时间、也分不清「该不该跟进」。
 *
 * 只补「打招呼」这一个事实：不动 JD、不动 land-a-job，也不把已推进的状态打回去。
 * 对齐顺序 securityId（＝主键）→ encryptJobId → encryptBossId，任一条命中即可。
 */
export interface GreetEvidence {
  securityId?: string
  encryptJobId?: string
  encryptBossId?: string
}

export function applyGreet(
  data: StagingData,
  greet: GreetEvidence,
  now = Date.now(),
): { key: string; recorded: boolean } | null {
  const jobs = Object.values(data.jobs)
  const job = (greet.securityId ? data.jobs[greet.securityId] : undefined)
    ?? (greet.encryptJobId
      ? jobs.find((item) => item.encryptJobId && item.encryptJobId === greet.encryptJobId)
      : undefined)
    ?? (greet.encryptBossId
      ? jobs.find((item) => item.encryptBossId && item.encryptBossId === greet.encryptBossId)
      : undefined)
  if (!job) return null

  /** 只认第一次：同一条会话可能被重复旁听到，时间要稳在「真正打招呼那一刻」 */
  const recorded = job.greetedAt === undefined
  if (recorded) job.greetedAt = now
  /** 已经回复/发过简历的记录只补时间，状态绝不回退 */
  if (!AFTER_GREET_STATES.has(job.state)) {
    job.state = 'greeted'
    job.notes = `${job.notes ? `${job.notes}；` : ''}已在 BOSS 页面手动打招呼`.trim()
  }
  data.lastUpdated = now
  return { key: job.key, recorded }
}

/** TTL / 上限清理；sent 后 7 天归档。 */
export function pruneStaging(data: StagingData, now = Date.now()): number {
  let removed = 0
  for (const [key, job] of Object.entries(data.jobs)) {
    const age = now - job.capturedAt
    const sentAge = job.state === 'sent' ? now - (job.repliedAt ?? job.capturedAt) : 0
    if (age > STAGING_LIMITS.ttlMs || (job.state === 'sent' && sentAge > STAGING_LIMITS.sentTtlMs)) {
      delete data.jobs[key]
      removed += 1
    }
  }
  const keys = Object.keys(data.jobs).sort(
    (a, b) => (data.jobs[b]?.capturedAt ?? 0) - (data.jobs[a]?.capturedAt ?? 0),
  )
  for (const key of keys.slice(STAGING_LIMITS.maxItems)) {
    delete data.jobs[key]
    removed += 1
  }
  return removed
}

export function conversationKey(uid: number, jobId?: number): string {
  return `${uid}:${jobId ?? 0}`
}

export function snapshotFrom(
  snap: ConversationSnapshot,
): ConversationSnapshot {
  return { ...snap }
}

export class StagingStore {
  constructor(
    private readonly kv: KVStore,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<StagingData> {
    const saved = await this.kv.get<StagingData>(STORAGE_KEYS.staging)
    return saved ?? emptyStaging(this.now())
  }

  async save(data: StagingData): Promise<void> {
    data.lastUpdated = this.now()
    await this.kv.set(STORAGE_KEYS.staging, data)
  }
}
