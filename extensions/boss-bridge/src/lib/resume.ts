import type { BridgeLike } from './sync.js'
import type { PdfPayload, ResumeRow, StagedJob, TailorPlan, TailorPlanPayload } from './types.js'

/**
 * P3 的「定制简历 → PDF」编排。
 *
 * 边界：服务端只给**计划**与**校验**，改写发生在扩展里——而且是纯规则改写
 * （重排 + 摘一句已存在的事实），不调任何模型。这是 0-token 路径；
 * 想要文采就走 Agent（resume-tailor），这条路不抢它的活。
 */

export interface TailorBridgeLike extends BridgeLike {
  getJob(jobId: string): Promise<{ id: string; title: string }>
  tailorPlan(jobId: string, resumeId?: string): Promise<TailorPlanPayload>
  duplicateResume(resumeId: string, input: { jobId?: string; title?: string }): Promise<ResumeRow>
  validateTailor(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
  ): Promise<{ ok: boolean; violations: unknown[]; message: string }>
  patchResume(resumeId: string, data: Record<string, unknown>): Promise<ResumeRow>
  exportResumePdf(resumeId: string): Promise<PdfPayload>
}

export class TailorError extends Error {
  constructor(readonly step: string, message: string) {
    super(message)
    this.name = 'TailorError'
  }
}

export interface PlanApplied {
  data: Record<string, unknown>
  projectsReordered: boolean
  skillsReordered: boolean
  /** 补进自我介绍的词，全部来自 `plan.summaryHints`（简历里已有证据） */
  summaryAppended: string[]
  /** 计划里有、但正文里找不到对应条目而跳过的项，写进备注便于复核 */
  skipped: string[]
}

function skillName(item: unknown): string {
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const value = (item as { name?: unknown; keyword?: unknown }).name ?? (item as { keyword?: unknown }).keyword
    if (typeof value === 'string') return value
  }
  return ''
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 按计划重排，只做两件事：换顺序、往自我介绍里补「简历里已有」的词。
 * 绝不新增条目、绝不动公司 / 时间 / 学校——服务端的 validate 会再拦一次，但这里先守住。
 */
export function applyTailorPlan(data: Record<string, unknown>, plan: TailorPlan): PlanApplied {
  const next = clone(data)
  const skipped: string[] = []

  const orderOf = (list: string[]) => new Map(list.map((name, index) => [name, index]))
  const projectOrder = orderOf(plan.reorderProjects)
  const projects = Array.isArray(next.projects) ? (next.projects as Record<string, unknown>[]) : null
  let projectsReordered = false
  if (projects && projectOrder.size > 0) {
    const known = projects.filter((item) => projectOrder.has(String(item?.name ?? '')))
    const unknown = projects.filter((item) => !projectOrder.has(String(item?.name ?? '')))
    const sorted = [...known].sort(
      (a, b) => (projectOrder.get(String(a?.name)) ?? 0) - (projectOrder.get(String(b?.name)) ?? 0),
    )
    if ([...sorted, ...unknown].some((item, index) => item !== projects[index])) {
      next.projects = [...sorted, ...unknown]
      projectsReordered = true
    }
  } else if (plan.reorderProjects.length) {
    skipped.push(...plan.reorderProjects)
  }

  const skillOrder = orderOf(plan.reorderSkills)
  const skills = Array.isArray(next.skills) ? (next.skills as unknown[]) : null
  let skillsReordered = false
  if (skills && skillOrder.size > 0) {
    const sorted = [...skills].sort((a, b) => {
      const ai = skillOrder.get(skillName(a)) ?? Number.MAX_SAFE_INTEGER
      const bi = skillOrder.get(skillName(b)) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
    if (sorted.some((item, index) => item !== skills[index])) {
      next.skills = sorted
      skillsReordered = true
    }
  } else if (plan.reorderSkills.length) {
    skipped.push(...plan.reorderSkills)
  }

  const summaryKey = ['selfIntroduction', 'summary', 'introduction'].find(
    (key) => typeof next[key] === 'string',
  )
  const summaryAppended: string[] = []
  if (summaryKey && plan.summaryHints.length) {
    const current = String(next[summaryKey] ?? '')
    for (const hint of plan.summaryHints) {
      if (hint && !current.includes(hint)) summaryAppended.push(hint)
    }
    if (summaryAppended.length) {
      const head = current.trim().replace(/[；;。]$/, '')
      next[summaryKey] = `${head ? `${head}；` : ''}熟悉 ${summaryAppended.slice(0, 5).join('、')}。`
    }
  } else if (plan.summaryHints.length) {
    // 没有自我介绍字段时不硬塞：宁可少改，也不给 validate 制造新增文本的嫌疑
    skipped.push(...plan.summaryHints)
  }

  return { data: next, projectsReordered, skillsReordered, summaryAppended, skipped }
}

export interface TailorResult {
  resumeId: string
  baseResumeId: string
  resumeTitle: string
  fileName: string
  bytes: Uint8Array
  changed: PlanApplied
  plan: TailorPlan
  resumeSource: TailorPlanPayload['resumeSource']
}

export interface TailorOptions {
  /** 显式指定母版；不传则由服务端按「投递绑定 → 默认母版 → 列表第一份」决定 */
  masterResumeId?: string
  now?: () => number
}

/**
 * 回复之后的第 3、4 步：按 JD 定制 → 校验 → 落库 → 导出 PDF。
 *
 * 硬规则：
 * - 必须先有 P2 的 `landSync.jobId`（岗位还没落库就定制，variant 会挂到空气上）；
 * - `validate` 不通过就**不 PATCH**，把违规原样抛给上层（宁可没定制，不可编造）；
 * - 导出的字节必须以 `%PDF-` 开头，否则当成失败而不是把 HTML 传给上传。
 */
export async function tailorAndExport(
  job: StagedJob,
  bridge: TailorBridgeLike,
  opts: TailorOptions = {},
): Promise<TailorResult> {
  const jobId = job.landSync?.jobId
  if (!jobId) throw new TailorError('sync', '岗位还没落库（缺 landSync.jobId），不能定制')
  if (job.manual) throw new TailorError('manual', '用户已接手该会话，自动化停止')

  const planPayload = await bridge.tailorPlan(jobId, opts.masterResumeId)
  const variant = await bridge.duplicateResume(planPayload.resumeId, {
    jobId,
    title: `${job.jobName} · 定制版`,
  })

  const before = (variant.data ?? {}) as Record<string, unknown>
  const applied = applyTailorPlan(before, planPayload.plan)

  const check = await bridge.validateTailor(before, applied.data)
  if (!check.ok) {
    throw new TailorError(
      'validate',
      `定制稿未通过防编造校验：${check.message || `${check.violations.length} 项违规`}`,
    )
  }

  await bridge.patchResume(variant.id, applied.data)
  const pdf = await bridge.exportResumePdf(variant.id)
  if (!isPdf(pdf.bytes)) {
    throw new TailorError('export', `导出的内容不是 PDF（${pdf.bytes.length} 字节）`)
  }

  return {
    resumeId: variant.id,
    baseResumeId: planPayload.resumeId,
    resumeTitle: variant.title,
    fileName: pdf.fileName,
    bytes: pdf.bytes,
    changed: applied,
    plan: planPayload.plan,
    resumeSource: planPayload.resumeSource,
  }
}

/** `%PDF-` 魔数：服务端导出失败时可能回 HTML，别把它当附件传上去。 */
export function isPdf(bytes: Uint8Array | ArrayBuffer): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (view.length < 5) return false
  return view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46 && view[4] === 0x2d
}

/**
 * 扩展内部消息只能传可结构化克隆的数据，`Uint8Array` 跨 `chrome.runtime`
 * 会被序列化成对象。统一转 base64 传，内容脚本再还原成 `File`。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
