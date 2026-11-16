import type { ConversationItem } from './parsers.js'
import type { StagedJob } from './types.js'

/**
 * 会话 ↔ 暂存岗位的匹配（2026-11-13 实测修正）。
 *
 * 真实 friendlist 响应实测：会话里的 `encryptBossId` / `encryptJobId` 与 joblist **同源**
 * （独创时代两边完全一致），所以 ID 相等是**最强证据**。早期存档里 104 会话 / 120 岗位
 * 只对上 4 条，是因为其余会话对应的岗位压根没被列表页抓到，不是两套 ID 不通。
 *
 * 保留打分而不是简单比 ID，是为了处理 ID 缺失 / 公司名被截断成「北京软通动力云计...」：
 * - ID 相等 → 200，直接命中；
 * - 两边都有 ID 却不相等 → 只认公司名**完全相同**，避免把「博彦科技」的回复连到
 *   「博彦科技承德有限公司」的另一个岗位；
 * - 缺 ID 时才用公司名前缀 / 包含兜底，低于阈值不认。
 */

/** 去空白、去尾部的省略号（BOSS 会话列表把长公司名截成 xxx...） */
export function normalizeBrand(name: string | undefined): string {
  return String(name ?? '')
    .replace(/[\s\u00a0]/g, '')
    .replace(/[.…。·]+$/g, '')
    .toLowerCase()
}

/** 匹配得分：>= MATCH_THRESHOLD 才认为是同一个岗位 */
export const MATCH_THRESHOLD = 40

export function conversationMatchScore(job: StagedJob, conv: ConversationItem): number {
  /**
   * 2026-11-13 抓到真实 friendlist 响应后更正：会话里的 `encryptBossId` / `encryptJobId`
   * 与 joblist **是同一套 ID**（独创时代实测两边完全一致）。之前 104 条里只有 4 条交集，
   * 是因为那些会话对应的岗位根本没被列表页抓到，不是 ID 体系不同。
   */
  const idHit = Boolean(
    (job.encryptJobId && conv.encryptJobId && job.encryptJobId === conv.encryptJobId)
    || (job.encryptBossId && conv.encryptBossId && job.encryptBossId === conv.encryptBossId)
    || (conv.securityId && conv.securityId === job.key),
  )
  if (idHit) return 200

  const a = normalizeBrand(job.brandName)
  const b = normalizeBrand(conv.brandName)
  if (!a || !b) return 0
  if (a === b) return 60

  /** 两边都给了加密 ID 却不相等：多半是同公司另一个 HR / 另一个岗位，不能靠模糊公司名硬连 */
  const bothHaveIds = Boolean(job.encryptBossId && conv.encryptBossId)
    || Boolean(job.encryptJobId && conv.encryptJobId)
  if (bothHaveIds) return 0
  if (a.startsWith(b) || b.startsWith(a)) return 40
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return 20
  return 0
}

export function matchesConversation(job: StagedJob, conv: ConversationItem): boolean {
  return conversationMatchScore(job, conv) >= MATCH_THRESHOLD
}

/**
 * 从暂存区挑最像的一条。同一家公司常有多个岗位（如「北京软通动力云计...」出现两次），
 * 得分相同时优先没落过库的（更可能是这次要推进的那条），再比抓取时间。
 */
export function bestMatchingJob(
  jobs: Iterable<StagedJob>,
  conv: ConversationItem,
  eligible: (job: StagedJob) => boolean = () => true,
): StagedJob | undefined {
  const scored: { job: StagedJob; score: number }[] = []
  for (const job of jobs) {
    if (!eligible(job)) continue
    const score = conversationMatchScore(job, conv)
    if (score >= MATCH_THRESHOLD) scored.push({ job, score })
  }
  scored.sort((x, y) =>
    y.score - x.score
    || Number(Boolean(x.job.landSync)) - Number(Boolean(y.job.landSync))
    || y.job.capturedAt - x.job.capturedAt,
  )
  return scored[0]?.job
}
