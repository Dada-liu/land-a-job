import { z } from 'zod'
import { checkSkill, stampProvenance, zProvenance, type Provenance } from '@land/core'
import { LandError } from '../errors.js'

/**
 * 所有工具共用的两个小工具：provenance 附加与响应瘦身。
 */

/** 写接口统一追加 provenance 字段，不要在 42 个工具里各写一遍 */
export function withProvenance<T extends z.ZodRawShape>(shape: T) {
  return {
    ...shape,
    provenance: zProvenance.describe(
      'AI 产出必填：{ skill: SKILL_REGISTRY 里登记的 skill 名, skillVersion: "1.0.0", model? }。人工在 Web 上修改不需要',
    ),
  }
}

export type ProvenanceField = { provenance: Provenance }

/**
 * 「已投及以后」的状态才补投递时间。
 *
 * 与 core 的 zApplicationCreate.refine 是同一份口径：lead / queued 还没投出去，
 * 一旦带上 appliedAt，漏斗的 maxStage() 会把它算成「到过 applied」，本周已投数凭空多一批。
 * 批量入待投（resume-tailor-batch）尤其依赖这条，所以抽成纯函数并单测。
 */
const POST_APPLIED_STATUSES = new Set(['applied', 'screening', 'assessment', 'interview', 'offer'])

export function appliedAtForCreate(status: string | undefined, supplied?: string): string | undefined {
  if (supplied) return supplied
  return POST_APPLIED_STATUSES.has(status ?? 'applied') ? new Date().toISOString() : undefined
}

/**
 * MCP 侧先校验一次：错误信息里能直接给出升级命令，也省一次无用的网络往返。
 * 服务端仍会再校验一遍——两层都要有，MCP 不是可信边界。
 */
export function stamp(provenance: Provenance): Provenance {
  const check = checkSkill(provenance.skill, provenance.skillVersion)
  if (!check.ok) {
    throw new LandError({
      code: check.code ?? 'SKILL_INVALID',
      message: check.message ?? 'provenance 不合法',
      status: 400,
    })
  }
  return stampProvenance(provenance)
}

/** 列表瘦身：只留 Agent 决策需要的字段，正文一律留给 get_* */
export function pick<T extends Record<string, unknown>>(row: T, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) if (row[key] !== undefined) result[key] = row[key]
  return result
}

export function pickAll<T extends Record<string, unknown>>(rows: T[], keys: readonly string[]): Record<string, unknown>[] {
  return rows.map((row) => pick(row, keys))
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/**
 * 深合并简历正文。
 *
 * 数组一律整体替换而不是按下标合并：定制简历的核心动作就是「重排项目顺序」，
 * 按下标合并会把重排吃掉，Agent 会以为改成功了。
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(patch)) return patch as unknown as T
  if (typeof patch !== 'object') return patch as T
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    result[key] = deepMerge((base as Record<string, unknown>)[key], value)
  }
  return result as T
}

/**
 * fit 的一句话解释。
 *
 * 只回分数不回理由，Agent 就会自己发明理由——那是幻觉最常见的来源之一。
 */
export function fitFactorSummary(job: Record<string, unknown>): string | null {
  const score = job.fitScore
  if (typeof score !== 'number') return null
  const reasons = Array.isArray(job.fitReasons) ? (job.fitReasons as string[]) : []
  const source = typeof job.fitSource === 'string' ? job.fitSource : 'rule'
  const head = `fit ${score}（来源 ${source}）`
  return reasons.length > 0 ? `${head}：${reasons.join('；')}` : `${head}：暂无因子说明，可调用 score_job 重算`
}
