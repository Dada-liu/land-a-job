import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  JOB_STATUSES,
  extractJdSignals,
  formatFitReasons,
  scoreFit,
  zId,
  zJobCreate,
  zJobPatch,
  zListQuery,
  zMoney,
  zUrl,
  type FitResume,
  type JdSignals,
  type JobDto,
} from '@land/core'
import { createJob, deleteJob, getJob, listJobs, updateJob } from '../db/repositories/job.js'
import { getCompany } from '../db/repositories/company.js'
import { getResume, listResumes } from '../db/repositories/resume.js'
import type { Db } from '../db/index.js'
import { FILES_DIR } from '../config.js'
import {
  MIN_TEXT_LENGTH,
  collectJd,
  escapeHtml,
  normalizeWhitespace,
  safeCanonicalJdUrl,
  sanitizeText,
  saveJdSnapshot,
  type JdStructured,
} from '../jd/index.js'
import { AppError } from '../errors.js'
import { ok, paginated } from '../reply.js'
import type { RouteDeps } from './index.js'

const listQuery = zListQuery.extend({
  companyId: zId.optional(),
  status: z.enum(JOB_STATUSES).optional(),
  minFit: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(['fit', 'priority', 'updated']).optional(),
  jdUrl: z.string().trim().max(2048).optional(),
  withApplication: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

const boolQuery = z.object({
  cascade: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

/**
 * 把库里的简历正文转成打分输入。
 *
 * 期望城市不在 personalInfo 里时，退而从 contacts 里找「城市 / 期望城市 / 地点」——
 * 用户在简历里通常把它写进联系方式，而不是单独开一个字段。
 */
function toFitResume(data: unknown): FitResume {
  const resume = (data ?? {}) as FitResume & {
    contacts?: { platform?: string | null; value?: string | null }[]
  }
  const fromContacts = (resume.contacts ?? []).find((contact) => /城市|地点|base/i.test(contact.platform ?? ''))?.value
  const city = resume.personalInfo?.city ?? fromContacts ?? null
  return { ...resume, personalInfo: { ...resume.personalInfo, city } }
}

interface JdWriteInput {
  text: string
  html: string
  structured: JdStructured
  signals: JdSignals
  /** 采集来源，落库后 Web 刷新也能看到「这份 JD 是怎么来的」 */
  source: string
  /** 只补空链接，不覆盖用户原来登记的链接 */
  url?: string | null
}

/**
 * 抓取与粘贴两条入口共用的落库逻辑。
 *
 * 人工已经填过的字段一律不覆盖：机器推断只补空位。
 * 抽出的关键词、城市、薪资同时写回，fit 打分与详情页不用再从正文各算一遍。
 */
async function writeJd(db: Db, id: string, input: JdWriteInput): Promise<{ job: JobDto; snapshot: string }> {
  const job = getJob(db, id)
  const snapshot = await saveJdSnapshot(FILES_DIR, id, input.html)
  const updated = updateJob(db, id, {
    jdText: input.text,
    jdSnapshot: snapshot,
    jdSource: input.source,
    ...(input.url && !job.jdUrl ? { jdUrl: input.url } : {}),
    keywords: input.signals.tech.slice(0, 40),
    ...(job.title.trim() ? {} : { title: input.structured.title ?? job.title }),
    ...(job.city?.trim() ? {} : { city: input.structured.city ?? input.signals.cities[0] ?? null }),
    ...(job.salaryMin == null && job.salaryMax == null && input.signals.salary
      ? { salaryMin: input.signals.salary.min, salaryMax: input.signals.salary.max }
      : {}),
  })
  return { job: updated, snapshot }
}

export function registerJobRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/jobs', async (request) => {
    const query = listQuery.parse(request.query)
    const page = listJobs(db, query)
    return paginated(page.items, query.limit, page.nextCursor)
  })

  app.get('/api/jobs/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    return ok(getJob(db, id))
  })

  app.post('/api/jobs', async (request, reply) => {
    const input = zJobCreate.parse(request.body)
    const job = createJob(db, input)
    ws.invalidate(['jobs', 'companies', 'stats'])
    return reply.code(201).send(ok(job))
  })

  app.patch('/api/jobs/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const patch = zJobPatch.parse(request.body)
    const job = updateJob(db, id, patch)
    ws.invalidate(['jobs', `job:${id}`, 'companies'])
    return ok(job)
  })

  /**
   * 抓取 JD 正文（P4-1，重构后走分层采集管线）。
   *
   * 除了关键词，把抽到的城市/薪资也一并补进岗位的空字段——以前这些 signals
   * 只回给前端看一眼就丢了，fit 打分却仍要重新从正文里猜一遍。
   * 人工已经填过的字段一律不覆盖：录入优先级高于机器推断。
   */
  app.post('/api/jobs/:id/fetch-jd', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const { url } = z.object({ url: zUrl.optional() }).parse(request.body ?? {})
    const job = getJob(db, id)
    const target = url ?? job.jdUrl
    if (!target) {
      throw new AppError('JD_URL_MISSING', '这个岗位没有 JD 链接；先补链接，或直接粘贴正文', 400)
    }

    const company = getCompany(db, job.companyId)
    const collection = await collectJd(target, {
      officialHosts: [company.website, company.applyEntry].filter((value): value is string => Boolean(value)),
      expectedTitle: job.title,
    })
    const { result, signals } = collection
    const { job: updated, snapshot } = await writeJd(db, id, {
      text: result.text,
      html: result.html,
      structured: result.structured,
      signals,
      source: result.provider,
      url: target,
    })
    ws.invalidate(['jobs', `job:${id}`])
    return ok({
      job: updated,
      signals,
      snapshot,
      source: collection.source,
      canonicalUrl: collection.canonicalUrl,
      warnings: collection.warnings,
      structured: result.structured,
      provider: result.provider,
    })
  })

  /**
   * 粘贴 JD 正文（采集失败时的降级入口，也是 Agent 的落库入口）。
   *
   * 与抓取共用清洗、信号抽取、快照与字段回写：粘贴不是「凑合存一段文本」，
   * 它产出的岗位数据在下游与自动抓取完全等价。
   */
  app.post('/api/jobs/:id/import-jd', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const { text, url, capturedBy } = z
      .object({
        text: z.string().max(200_000),
        url: zUrl.optional(),
        /** Agent 用自带浏览器取回正文时标 browser，用户手工粘贴标 paste */
        capturedBy: z.enum(['paste', 'browser']).optional().default('paste'),
      })
      .parse(request.body ?? {})

    const cleaned = sanitizeText(normalizeWhitespace(text))
    if (cleaned.length < MIN_TEXT_LENGTH) {
      throw new AppError(
        'JD_TOO_SHORT',
        `粘贴的正文只有 ${cleaned.length} 字，至少要 ${MIN_TEXT_LENGTH} 字；请复制完整的职位描述再试。`,
        422,
      )
    }

    const job = getJob(db, id)
    const signals = extractJdSignals(cleaned, job.title)
    const viaBrowser = capturedBy === 'browser'
    const provider = viaBrowser ? 'browser' : 'paste'
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(job.title)}</title></head>` +
      `<body><h1>${escapeHtml(job.title)}</h1><p>${viaBrowser ? 'Agent 浏览器读取的 JD 正文' : '人工粘贴的 JD 正文'}</p>` +
      `<pre>${escapeHtml(cleaned)}</pre></body></html>`
    const { job: updated, snapshot } = await writeJd(db, id, {
      text: cleaned,
      html,
      structured: {},
      signals,
      source: provider,
      url: url ?? null,
    })
    ws.invalidate(['jobs', `job:${id}`])
    return ok({
      job: updated,
      signals,
      snapshot,
      source: {
        kind: viaBrowser ? 'browser' : 'manual',
        host: '',
        adapter: null,
        trusted: true,
        label: viaBrowser ? 'Agent 浏览器' : '人工粘贴',
      },
      canonicalUrl: url ? safeCanonicalJdUrl(url) : null,
      warnings: [],
      structured: {},
      provider,
    })
  })

  /**
   * 重算 fit（P4-2）。
   *
   * 纯规则、可复算；`fit_source` 标记为 rule，Agent 之后要覆盖得显式传 override。
   */
  app.post('/api/jobs/:id/score', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const input = z
      .object({
        resumeId: zId.optional(),
        expectedSalary: zMoney.optional(),
        mustHave: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      })
      .parse(request.body ?? {})

    const job = getJob(db, id)
    const resumeId = input.resumeId ?? listResumes(db, { limit: 1 }).items[0]?.id
    const resume = resumeId ? getResume(db, resumeId) : null

    const result = scoreFit(job, toFitResume(resume?.data), {
      expectedSalary: input.expectedSalary ?? null,
      mustHave: input.mustHave,
    })

    const updated = updateJob(db, id, {
      fitScore: result.score,
      fitReasons: formatFitReasons(result.factors),
      fitSource: 'rule',
      keywords: (job.keywords ?? []).length > 0 ? job.keywords : result.signals.tech.slice(0, 40),
    })
    ws.invalidate(['jobs', `job:${id}`])
    return ok({ job: updated, fit: result, resumeId: resumeId ?? null })
  })

  app.delete('/api/jobs/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    boolQuery.parse(request.query)
    deleteJob(db, id)
    ws.invalidate(['jobs', 'companies', 'stats'])
    return ok({ id, deleted: true })
  })
}
