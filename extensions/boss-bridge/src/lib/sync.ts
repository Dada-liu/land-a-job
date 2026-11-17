import { activeEvidence } from './activity.js'
import type { ConversationItem } from './parsers.js'
import { detectReply } from './reply.js'
import { conversationKey } from './storage.js'
import type { ConversationSnapshot, LandSyncRecord, StagedJob } from './types.js'

/** 只依赖这些方法，单测可以注入内存 mock，不需要真的起服务端。 */
export interface BridgeLike {
  health(): Promise<{ ok: boolean; message: string }>
  findCompanyByName(name: string): Promise<{ id: string } | null>
  createCompany(name: string, city?: string): Promise<string>
  findJobByUrl(url: string): Promise<{ id: string } | null>
  createJob(input: { companyId: string; title: string; jdUrl: string; city?: string }): Promise<string>
  importJd(jobId: string, text: string, url: string): Promise<void>
  scoreJob(jobId: string): Promise<number | null>
  findApplicationByJob(jobId: string): Promise<{ id: string; status?: string } | null>
  createApplication(input: { jobId: string; notes?: string }): Promise<string>
  appendNote(applicationId: string, note: string): Promise<void>
}

export class SyncError extends Error {
  constructor(readonly step: string, message: string) {
    super(message)
    this.name = 'SyncError'
  }
}

export interface SyncOptions {
  now?: () => number
  log?: (message: string) => void
}

function ts(value: number | undefined): string {
  return value ? new Date(value).toISOString() : '未知时间'
}

/** 投递登记时的备注：写清来源，但不暴露聊天正文。 */
export function buildSyncNotes(job: StagedJob): string {
  return [
    `BOSS直聘 · ${job.brandName} · ${job.jobName}`,
    `JD 链接：${job.url}`,
    `回复 msgId：${job.replyMsgId ?? '未知'}；会话：${job.conversationId ?? '未知'}`,
    `${activeEvidence(job.bossActive)}（采集于 ${ts(job.bossActive.capturedAt)}）`,
    `薪资描述：${job.salaryDesc ?? '未提供'}；城市：${job.city ?? '未提供'}`,
    `招呼语草稿：${job.greetDraft ?? '未生成'}`,
    'JD 正文来自被动旁听 detail.json（capturedBy=browser），此前只存扩展暂存区。',
    '当前状态 queued：定制简历发送成功后（P3）才推进到 applied。',
  ].join('\n').slice(0, 8000)
}

/** 时间线存证：只记证据，不记消息内容。 */
export function buildEvidenceNote(job: StagedJob, jobId: string): string {
  return [
    'BOSS 桥接 · 公司回复触发延迟落库',
    `回复 msgId=${job.replyMsgId ?? '未知'}；会话=${job.conversationId ?? '未知'}；岗位 jobId=${jobId}`,
    `${activeEvidence(job.bossActive)}`,
    '投递登记为 queued（未写 appliedAt）；附件简历发送成功后由 P3 推进 applied。',
  ].join(' · ').slice(0, 4000)
}

/**
 * P2：公司回复后把暂存的 JD 首次写进 land-a-job。
 *
 * 硬规则：
 * - 只有 `state='replied'` 且有完整 JD 才落库；打招呼阶段 0 落库；
 * - `createJob` 不传 jdText，正文统一走 import-jd；**先 import 再 score**（import 会重算 fit）；
 * - 投递只建 `queued`，不传 appliedAt、不写 applied（口径：投递＝到达过 applied，由 P3 推进）；
 * - 公司 / 岗位 / 投递都先查重，命中即复用，重复轮询不会建出第二条；
 * - 复用已有岗位时不覆盖人工填过的 JD，也不重复 import / score。
 */
export async function syncRepliedJob(
  job: StagedJob,
  bridge: BridgeLike,
  opts: SyncOptions = {},
): Promise<LandSyncRecord> {
  const now = opts.now ?? Date.now
  const log = opts.log ?? (() => {})

  if (job.landSync) {
    log(`${job.brandName}：已落库，跳过重复同步`)
    return job.landSync
  }
  if (job.state !== 'replied') {
    throw new SyncError('state', `暂存状态为 ${job.state}，只有 replied 才落库`)
  }
  const jdText = job.jdText?.trim()
  if (!jdText) throw new SyncError('jdText', 'JD 正文缺失或被截断，不落库')
  if (!job.brandName?.trim() || !job.jobName?.trim()) {
    throw new SyncError('fields', '公司名或岗位名为空，不落库')
  }
  if (!job.url) throw new SyncError('url', '规范化 JD 链接为空，不落库')

  const health = await bridge.health()
  if (!health.ok) throw new SyncError('health', health.message)

  const existingCompany = await bridge.findCompanyByName(job.brandName)
  const reusedCompany = Boolean(existingCompany)
  const companyId = existingCompany?.id ?? await bridge.createCompany(job.brandName, job.city)

  const existingJob = await bridge.findJobByUrl(job.url)
  const reusedJob = Boolean(existingJob)
  const jobId = existingJob?.id ?? await bridge.createJob({
    companyId,
    title: job.jobName,
    jdUrl: job.url,
    ...(job.city ? { city: job.city } : {}),
  })

  let fitScore: number | null = null
  if (!reusedJob) {
    // 顺序陷阱：import_jd 会重算 fit 冲掉覆盖，因此 score 必须排在 import 之后
    await bridge.importJd(jobId, jdText, job.url)
    fitScore = await bridge.scoreJob(jobId)
  } else {
    log(`${job.brandName}：复用已有岗位 ${jobId}，不覆盖人工 JD`)
  }

  const existingApplication = await bridge.findApplicationByJob(jobId)
  const reusedApplication = Boolean(existingApplication)
  const applicationId = existingApplication?.id ?? await bridge.createApplication({
    jobId,
    notes: buildSyncNotes(job),
  })
  if (!reusedApplication) await bridge.appendNote(applicationId, buildEvidenceNote(job, jobId))

  return {
    companyId,
    jobId,
    applicationId,
    replyMsgId: job.replyMsgId,
    syncedAt: now(),
    reused: { company: reusedCompany, job: reusedJob, application: reusedApplication },
    fitScore,
  }
}

export interface ReplySyncOutcome {
  synced: boolean
  manual: boolean
  reason: string
  record?: LandSyncRecord
}

/**
 * 回复判据 → 暂存状态推进 → 延迟落库的唯一入口。
 * 只有 `detectReply` 判定为真实回复才落库；失败保留 `replied` 状态供下轮重试，
 * 绝不因为落库失败把记录退回或误写成已投递。
 */
export async function syncOnReply(
  conv: ConversationItem,
  prev: ConversationSnapshot | undefined,
  staged: StagedJob | undefined,
  bridge: BridgeLike,
  opts: SyncOptions = {},
): Promise<ReplySyncOutcome> {
  const now = opts.now ?? Date.now

  // 上一轮已判定回复但落库失败：同一条 msgId 允许重试，不再走「重复轮询」判据
  if (staged?.state === 'replied' && !staged.landSync && staged.replyMsgId === conv.msgId) {
    /** 从会话反向补建的记录没有 JD：静静等详情响应补齐，别每轮巡检都刷一条失败日志 */
    if (!staged.jdText?.trim()) {
      return { synced: false, manual: false, reason: '反向补建的记录缺 JD，等读到岗位详情后再落库' }
    }
    try {
      const record = await syncRepliedJob(staged, bridge, opts)
      staged.landSync = record
      staged.notes = `${staged.notes ?? ''}；重试落库成功 jobId=${record.jobId}`.trim()
      return { synced: true, manual: false, reason: '重试延迟落库成功', record }
    } catch (error) {
      return { synced: false, manual: false, reason: `重试落库失败：${(error as Error).message}` }
    }
  }

  const decision = detectReply(conv, prev, staged)
  if (!decision.isReply) {
    if (decision.manual && staged) {
      staged.manual = true
      staged.notes = `${staged.notes ?? ''}；用户已接手会话，自动化停止`.trim()
    }
    return { synced: false, manual: decision.manual, reason: decision.reason }
  }
  if (!staged) return { synced: false, manual: false, reason: '未匹配到暂存记录' }

  staged.state = 'replied'
  /** 用消息本身的时间，而不是巡检发现它的时间：后面算回复时长、推 applied 的下限都靠它 */
  staged.repliedAt = conv.lastTS || now()
  staged.replyMsgId = conv.msgId
  staged.conversationId = conversationKey(conv.uid, conv.jobId)

  try {
    const record = await syncRepliedJob(staged, bridge, opts)
    staged.landSync = record
    staged.notes = `${staged.notes ?? ''}；已落库 jobId=${record.jobId} / applicationId=${record.applicationId}（queued）`.trim()
    return { synced: true, manual: false, reason: '公司回复已触发延迟落库', record }
  } catch (error) {
    const reason = `落库失败（${(error as Error).message}），保留 replied 供下轮重试`
    staged.notes = `${staged.notes ?? ''}；${reason}`.trim()
    return { synced: false, manual: false, reason }
  }
}

/** P3c 只依赖这一个方法，单测注入 mock 即可 */
export interface AppliedBridge {
  markApplied(applicationId: string, appliedAt: string, note?: string): Promise<void>
}

export interface AppliedOutcome {
  pushed: boolean
  reason: string
}

/** 推进 applied 时的备注：只写证据，不抄聊天正文 */
export function buildAppliedNote(job: StagedJob, at: number, msgId?: number, evidence?: string): string {
  const attachment = job.attachmentName
    ? `附件简历：${job.attachmentName}`
    : '未走扩展上传附件（可能是手动选的文件）'
  return [
    'BOSS 桥接 · 被动读到简历已发出的证据，推进为已投递',
    `证据类型 ${evidence === 'resume_receipt' ? '附件简历发送成功的系统回执' : '我发出的消息'}`,
    `消息时间 ${new Date(at).toISOString()}；msgId=${msgId ?? '未知'}；会话=${job.conversationId ?? '未知'}`,
    attachment,
    activeEvidence(job.bossActive),
    '时间取自 BOSS 会话列表的 lastMessageInfo，不是本地点「发送」的时间。',
  ].join(' · ').slice(0, 4000)
}

/**
 * P3c：把自己发出的消息推进成 `applied`。
 *
 * 先写服务端再改本地状态——服务端失败时保留 `replied/uploaded`，下一轮巡检会重试；
 * 状态机在服务端校验，重复推进是幂等的（from === to 直接返回 changed:false）。
 */
export async function pushApplied(
  job: StagedJob,
  decision: { at?: number; msgId?: number; evidence?: string },
  bridge: AppliedBridge,
  opts: SyncOptions = {},
): Promise<AppliedOutcome> {
  const now = opts.now ?? Date.now
  const log = opts.log ?? (() => {})
  const applicationId = job.landSync?.applicationId
  if (!applicationId) return { pushed: false, reason: '没有 applicationId，无法推进' }

  const at = decision.at ?? now()
  try {
    await bridge.markApplied(
      applicationId,
      new Date(at).toISOString(),
      buildAppliedNote(job, at, decision.msgId, decision.evidence),
    )
  } catch (error) {
    const reason = `推进 applied 失败：${(error as Error).message}`
    log(`${job.brandName}：${reason}，下轮重试`)
    return { pushed: false, reason }
  }

  job.state = 'sent'
  job.sentAt = at
  job.sentMsgId = decision.msgId
  job.notes = `${job.notes ?? ''}；已确认发出消息，推进 applied（appliedAt=${new Date(at).toISOString()}）`.trim()
  log(`${job.brandName}：已推进 applied（applicationId=${applicationId}）`)
  return { pushed: true, reason: '已推进 applied' }
}
