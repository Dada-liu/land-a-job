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

/**
 * 暂存区主键：`encryptJobId` 优先。
 *
 * 早期用的是 `securityId`，踩过的坑是：**同一个岗位在不同列表页会返回不同的 securityId**
 * （实测 332 与 380 字符两种都见过），于是每换一个入口就多出一条记录，
 * 缓存岗位里同一个岗位显示两三行、打招呼时间写到其中一条上、另一条还是「可打招呼」。
 * `encryptJobId` 在所有入口都稳定，所以主键换成它；`securityId` 降级成普通字段，
 * 详情页响应只带 securityId，命中时按字段反查。
 */
function jobKey(item: JobListItem): string {
  return item.encryptJobId || item.securityId || `${item.brandName}::${item.jobName}`
}

/** 进度排序：去重时留最靠后的那条 */
const STATE_RANK: Record<StageState, number> = {
  discovered: 0,
  filtered_out: 1,
  needs_detail: 2,
  ready: 3,
  greeted: 4,
  replied: 5,
  tailored: 6,
  uploaded: 7,
  sent: 8,
  archived: 9,
}

/**
 * 按 ID 反查已有记录。
 *
 * 主键换代后必须兼容存量：旧记录的 key 是 securityId，直接 `data.jobs[新主键]` 查不到，
 * 一合并就会多出一条。所以先查规范主键，再按 `encryptJobId` / `securityId` 字段扫一遍，
 * 命中旧键就把它搬到规范键上（下面的 mergeJobList 负责删旧键）。
 */
function locateExisting(
  data: StagingData,
  item: JobListItem,
): { key: string; job: StagedJob } | undefined {
  const canonical = jobKey(item)
  const direct = data.jobs[canonical]
  if (direct) return { key: canonical, job: direct }
  for (const [key, job] of Object.entries(data.jobs)) {
    if (job.origin === 'conversation') continue
    if (item.encryptJobId && job.encryptJobId === item.encryptJobId) return { key, job }
    if (item.securityId && (job.securityId === item.securityId || key === item.securityId)) {
      return { key, job }
    }
  }
  return undefined
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
    const found = locateExisting(data, item)
    const existing = found?.job
    /** 存量记录还挂在旧主键（securityId）上：搬到规范主键，别留两条 */
    if (found && found.key !== key) delete data.jobs[found.key]
    const decision = listGate(item)
    const detailDecided = existing?.bossActive.source === 'detail'
    /** 详情判过、或已经走到下游：结论连同 notes 一起保留，别用列表粗筛覆盖 */
    const keepDecision = Boolean(existing && (detailDecided || LOCKED_STATES.has(existing.state)))
    const state: StageState = keepDecision && existing ? existing.state : decision.state
    const staged: StagedJob = {
      ...existing,
      key,
      securityId: item.securityId ?? existing?.securityId,
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
/** 详情响应只带 securityId：先按主键试（老数据），再按字段扫（新主键是 encryptJobId） */
function findKeyBySecurityId(data: StagingData, securityId?: string): string | undefined {
  if (!securityId) return undefined
  if (data.jobs[securityId]) return securityId
  return Object.keys(data.jobs).find((k) => data.jobs[k]?.securityId === securityId)
}

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
  const key = findKeyBySecurityId(data, detail.securityId)
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
    ?? (greet.securityId ? jobs.find((item) => item.securityId === greet.securityId) : undefined)
    ?? (greet.encryptJobId
      ? jobs.find((item) => item.key === greet.encryptJobId || item.encryptJobId === greet.encryptJobId)
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

function earliest(a?: number, b?: number): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return Math.min(a, b)
}

/** 归并两条同岗位记录：状态取更靠后的，时间取更早的（更早＝真实发生），字段谁有就用谁 */
function mergeJobRecords(winner: StagedJob, other: StagedJob): StagedJob {
  const notes = [winner.notes, other.notes].filter(Boolean).join('；')
  const detailed = winner.bossActive.source === 'detail'
    ? winner.bossActive
    : other.bossActive.source === 'detail'
      ? other.bossActive
      : winner.bossActive
  const longerJd = (other.jdText?.length ?? 0) > (winner.jdText?.length ?? 0) ? other.jdText : winner.jdText
  return {
    ...other,
    ...winner,
    securityId: winner.securityId ?? other.securityId,
    url: winner.url || other.url,
    jobName: winner.jobName || other.jobName,
    brandName: winner.brandName || other.brandName,
    salaryDesc: winner.salaryDesc ?? other.salaryDesc,
    city: winner.city ?? other.city,
    encryptJobId: winner.encryptJobId ?? other.encryptJobId,
    encryptBossId: winner.encryptBossId ?? other.encryptBossId,
    lid: winner.lid ?? other.lid,
    jdText: longerJd,
    bossActive: detailed,
    bossFreezeStatus: winner.bossFreezeStatus ?? other.bossFreezeStatus,
    bossPreFreezeStatus: winner.bossPreFreezeStatus ?? other.bossPreFreezeStatus,
    greetDraft: winner.greetDraft ?? other.greetDraft,
    conversationId: winner.conversationId ?? other.conversationId,
    replyMsgId: winner.replyMsgId ?? other.replyMsgId,
    landSync: winner.landSync ?? other.landSync,
    resumeVariantId: winner.resumeVariantId ?? other.resumeVariantId,
    resumeExport: winner.resumeExport ?? other.resumeExport,
    uploadedAt: earliest(winner.uploadedAt, other.uploadedAt),
    attachmentName: winner.attachmentName ?? other.attachmentName,
    sentAt: earliest(winner.sentAt, other.sentAt),
    sentMsgId: winner.sentMsgId ?? other.sentMsgId,
    pendingApplied: winner.pendingApplied ?? other.pendingApplied,
    state: STATE_RANK[winner.state] >= STATE_RANK[other.state] ? winner.state : other.state,
    capturedAt: earliest(winner.capturedAt, other.capturedAt) ?? winner.capturedAt,
    greetedAt: earliest(winner.greetedAt, other.greetedAt),
    greetSentAt: earliest(winner.greetSentAt, other.greetSentAt),
    repliedAt: earliest(winner.repliedAt, other.repliedAt),
    manual: winner.manual || other.manual,
    notes: notes || undefined,
  }
}

/**
 * 存量迁移 + 去重（幂等，可在每次读状态时跑）。
 *
 * 1. 同一个 `encryptJobId` 的多条记录合成一条：状态留最靠后的、时间留最早的、字段谁有取谁。
 * 2. 顺手把主键改成规范键（`encryptJobId`），旧数据的主键是 securityId，不搬的话
 *    下一次列表刷新还会按新主键再建一条。
 *
 * 反向补建的记录（`origin === 'conversation'`，主键 `chat:uid:jobId`）保留自己的主键：
 * `createJobFromConversation` 靠它判幂等，换了主键会被重复创建。
 */
export function dedupeStaging(data: StagingData, now = Date.now()): { merged: number; renamed: number } {
  const groups = new Map<string, string[]>()
  for (const [key, job] of Object.entries(data.jobs)) {
    const id = job.encryptJobId
      ? `enc:${job.encryptJobId}`
      : job.securityId
        ? `sec:${job.securityId}`
        : `key:${key}`
    const list = groups.get(id)
    if (list) list.push(key)
    else groups.set(id, [key])
  }

  let merged = 0
  let renamed = 0
  for (const keys of groups.values()) {
    if (keys.length === 0) continue
    const ordered = keys
      .map((key) => data.jobs[key])
      .filter((job): job is StagedJob => Boolean(job))
      .sort((a, b) => STATE_RANK[b.state] - STATE_RANK[a.state] || a.capturedAt - b.capturedAt)
    const winner = ordered[0]
    if (!winner) continue

    for (const loser of ordered.slice(1)) {
      if (loser.key === winner.key) continue
      Object.assign(winner, mergeJobRecords(winner, loser))
      delete data.jobs[loser.key]
      merged += 1
    }

    const canonical = winner.encryptJobId || winner.securityId || winner.key
    if (winner.origin !== 'conversation' && canonical !== winner.key && !data.jobs[canonical]) {
      delete data.jobs[winner.key]
      winner.key = canonical
      data.jobs[canonical] = winner
      renamed += 1
    }
  }

  if (merged || renamed) data.lastUpdated = now
  return { merged, renamed }
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
