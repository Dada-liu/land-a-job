import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { buildTailorPlan, describeViolations, validateTailor, zId, type TailorResume } from '@land/core'
import type { Db } from '../db/index.js'
import { boundResumeForJob } from '../db/repositories/application.js'
import { getJob } from '../db/repositories/job.js'
import { defaultResumeId, getResume, listResumes } from '../db/repositories/resume.js'
import { AppError } from '../errors.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

/**
 * 定制简历（P4-2）。
 *
 * 只提供「计划」与「校验」，不提供「改写」——改写发生在 Agent 侧（D2）。
 * 这两个端点是 resume-tailor Skill 的取材料与守门环节，Web 也直接复用同一份结果。
 */
export type ResumeSource = 'explicit' | 'application' | 'master'

/**
 * 没传 resumeId 时挑哪份简历：先看这次投递绑的那版，再看默认母版，最后才是列表第一份。
 * 放在服务端而不是页面里，MCP / Skill 与 Web 的口径才一致；页面也不必先拉一遍全部投递。
 */
function resolveResume(db: Db, jobId: string, explicit?: string): { id: string | null; source: ResumeSource } {
  if (explicit) return { id: explicit, source: 'explicit' }
  const bound = boundResumeForJob(db, jobId)
  if (bound) return { id: bound, source: 'application' }
  const fallback = defaultResumeId(db) ?? listResumes(db, { limit: 1 }).items[0]?.id ?? null
  return { id: fallback, source: 'master' }
}

export function registerTailorRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/jobs/:id/tailor-plan', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const { resumeId } = z.object({ resumeId: zId.optional() }).parse(request.query ?? {})

    const job = getJob(db, id)
    const { id: targetResumeId, source } = resolveResume(db, id, resumeId)
    if (!targetResumeId) {
      throw new AppError('RESUME_MISSING', '还没有简历可定制；先建一份母版简历', 400)
    }
    const resume = getResume(db, targetResumeId)
    const plan = buildTailorPlan((resume.data ?? {}) as TailorResume, job)

    return ok({
      jobId: id,
      resumeId: targetResumeId,
      resumeTitle: resume.title,
      /** 这版简历是怎么选中的：页面据此写「本次投递用的简历」还是「基础简历」 */
      resumeSource: source,
      plan,
      /** 交给 Agent 的指令模板：页面「复制给 Agent」按钮直接用它 */
      instruction: [
        `用 resume-tailor 能力定制简历：基础简历 ${resume.title}（${targetResumeId}），目标岗位 ${job.title}（${id}）。`,
        `必须保持：${plan.constraints.join('；')}。`,
        `请优先突出：${plan.summaryHints.join('、') || '（无可突出项）'}。`,
        `需要补证据的缺口：${plan.gap.map((gap) => gap.keyword).join('、') || '无'}。`,
        '改完调用 patch_resume 落库，系统会校验是否新增条目或改动公司/时间。',
      ].join('\n'),
    })
  })

  /** 落库前的编造校验：MCP 的 patch_resume 与 Web 的导入都会先过这一关 */
  app.post('/api/tailor/validate', async (request) => {
    const body = z
      .object({
        before: z.record(z.string(), z.unknown()),
        after: z.record(z.string(), z.unknown()),
      })
      .parse(request.body)

    const violations = validateTailor(body.before as TailorResume, body.after as TailorResume)
    return ok({
      ok: violations.length === 0,
      violations,
      message: describeViolations(violations),
    })
  })
}
