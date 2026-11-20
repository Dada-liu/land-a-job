import type { StagedJob, StageState } from './types.js'

/** 缓存岗位页（staging.html）的筛选模型：纯函数，方便单测与 URL 复用 */
export type ActivityFilter = 'all' | 'online' | 'desc' | 'unknown'
export type SortKey = 'recent' | 'company' | 'state'

/** 薪资档位：只给常用几档做下拉，其余区间用顶部搜索框（薪资文本也参与关键词匹配） */
export type SalaryBucket = 'all' | '10-20' | '20-30' | '30-40' | '40-50'

export const SALARY_BUCKETS: readonly { value: SalaryBucket; label: string; min?: number; max?: number }[] = [
  { value: 'all', label: '薪资不限' },
  { value: '10-20', label: '10-20K', min: 10, max: 20 },
  { value: '20-30', label: '20-30K', min: 20, max: 30 },
  { value: '30-40', label: '30-40K', min: 30, max: 40 },
  { value: '40-50', label: '40-50K', min: 40, max: 50 },
]

export interface StagedFilter {
  /** 关键词：公司 / 岗位 / 城市 / 薪资 / 备注 */
  q: string
  state: StageState | 'all'
  activity: ActivityFilter
  salary: SalaryBucket
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
  salary: 'all',
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

/**
 * 从 `15-25K`、`15-25K·13薪` 这类文本里取月薪区间（单位 K）。
 * 只认两侧都是数字 + K 的写法：`面议`、`300-500元/天` 取不到区间，任何档位都不命中，
 * 这类岗位仍可用搜索框按原文搜到。
 */
export function parseSalaryRange(desc?: string): { min: number; max: number } | null {
  if (!desc) return null
  const m = desc.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*K/i)
  if (!m) return null
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return a <= b ? { min: a, max: b } : { min: b, max: a }
}

/** 档位与岗位区间**有交集**即命中：15-25K 在 10-20K 和 20-30K 下都能看到（跨档岗位本就两边都算） */
function hitSalary(job: StagedJob, bucket: SalaryBucket): boolean {
  if (bucket === 'all') return true
  const target = SALARY_BUCKETS.find((b) => b.value === bucket)
  if (!target || target.min === undefined || target.max === undefined) return true
  const range = parseSalaryRange(job.salaryDesc)
  if (!range) return false
  return range.min < target.max && range.max > target.min
}

export function matchesFilter(job: StagedJob, filter: StagedFilter): boolean {
  if (filter.state !== 'all' && job.state !== filter.state) return false
  if (!hitActivity(job, filter.activity)) return false
  if (!hitSalary(job, filter.salary)) return false
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
