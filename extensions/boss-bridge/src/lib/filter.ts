import type { StagedJob, StageState } from './types.js'

/** 缓存岗位页（staging.html）的筛选模型：纯函数，方便单测与 URL 复用 */
export type ActivityFilter = 'all' | 'online' | 'desc' | 'unknown'
export type SortKey = 'recent' | 'company' | 'state'

export interface StagedFilter {
  /** 关键词：公司 / 岗位 / 城市 / 薪资 / 备注 */
  q: string
  state: StageState | 'all'
  activity: ActivityFilter
  /** 只看有 JD 正文的（说明详情页已经被读到） */
  hasJd: boolean
  /** 只看已写入 land-a-job 的 */
  synced: boolean
  /** 只看已生成招呼语草稿的 */
  drafted: boolean
  sort: SortKey
}

export const DEFAULT_FILTER: StagedFilter = {
  q: '',
  state: 'all',
  activity: 'all',
  hasJd: false,
  synced: false,
  drafted: false,
  sort: 'recent',
}

/** 界面文案：内部 state 名一律翻成用户话术 */
export const STATE_LABELS: Record<StageState, string> = {
  discovered: '已发现',
  needs_detail: '待确认活跃度',
  ready: '可打招呼',
  filtered_out: 'HR 不活跃',
  greeted: '已打招呼',
  replied: '对方已回复',
  tailored: '已定制简历',
  uploaded: '简历已上传',
  sent: '已发出简历',
  archived: '已归档',
}

/** 列表里的状态筛选顺序：按流程走，不按字母排 */
export const STATE_ORDER: StageState[] = [
  'ready',
  'needs_detail',
  'filtered_out',
  'greeted',
  'replied',
  'tailored',
  'uploaded',
  'sent',
  'archived',
  'discovered',
]

/**
 * 最后一次有意义的动作时间：排序用。
 * 刻意不含 `bossActive.capturedAt`——列表每滚一次都会刷新它，
 * 带上会把「最近动作」变成「最近被列表刷到」，排序会一直抖。
 */
export function touchedAt(job: StagedJob): number {
  return Math.max(
    job.sentAt ?? 0,
    job.uploadedAt ?? 0,
    job.repliedAt ?? 0,
    job.greetedAt ?? 0,
    job.capturedAt ?? 0,
  )
}

function hitActivity(job: StagedJob, filter: ActivityFilter): boolean {
  if (filter === 'all') return true
  const active = job.bossActive
  if (filter === 'online') return active?.online === true
  if (filter === 'desc') return Boolean(active?.desc)
  return active?.online === undefined && !active?.desc
}

function hitQuery(job: StagedJob, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const haystack = [job.brandName, job.jobName, job.city, job.salaryDesc, job.notes, job.key]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export function matchesFilter(job: StagedJob, filter: StagedFilter): boolean {
  if (filter.state !== 'all' && job.state !== filter.state) return false
  if (!hitActivity(job, filter.activity)) return false
  if (filter.hasJd && !job.jdText) return false
  if (filter.synced && !job.landSync) return false
  if (filter.drafted && !job.greetDraft) return false
  return hitQuery(job, filter.q)
}

export function applyFilter(jobs: readonly StagedJob[], filter: StagedFilter): StagedJob[] {
  const picked = jobs.filter((job) => matchesFilter(job, filter))
  const sorted = [...picked]
  if (filter.sort === 'recent') sorted.sort((a, b) => touchedAt(b) - touchedAt(a))
  else if (filter.sort === 'company') sorted.sort((a, b) => a.brandName.localeCompare(b.brandName, 'zh-Hans-CN'))
  else {
    sorted.sort((a, b) => {
      const diff = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
      return diff !== 0 ? diff : touchedAt(b) - touchedAt(a)
    })
  }
  return sorted
}

/** 顶部筛选条要显示各状态数量，全部走同一个统计口径 */
export function countByState(jobs: readonly StagedJob[]): Record<string, number> {
  const counts: Record<string, number> = { all: jobs.length }
  for (const job of jobs) counts[job.state] = (counts[job.state] ?? 0) + 1
  return counts
}
