import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { JOB_STATUSES } from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'
import { fitFactorSummary, pickAll, qs } from './shared.js'

const JOB_KEYS = ['id', 'title', 'companyName', 'city', 'fitScore', 'status', 'priority', 'salaryMin', 'salaryMax'] as const

interface JobRow extends Record<string, unknown> {
  id: string
  title: string
  companyId: string
  jdUrl?: string | null
  jdText?: string | null
  fitScore?: number | null
}

interface CompanyRow {
  id: string
  name: string
}

/** 抓取失败的 details 里带来源感知的降级提示，别把它丢在 Agent 看不见的地方 */
function jdFailureText(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error)
  const details = (error as { details?: { hint?: string } } | null)?.details
  if (details?.hint && !base.includes(details.hint)) return `${base} ${details.hint}`
  return base
}

/** 抓取与粘贴两条链路共用同一份返回摘要，避免 Agent 在两个工具间学两套字段 */
interface JdWritePayload {
  job: JobRow & { keywords?: string[] | null }
  signals: Record<string, unknown>
  source: { kind: string; label: string; trusted: boolean }
  warnings: string[]
}

async function jdSummary(id: string, payload: JdWritePayload, score: boolean) {
  let fitScore: number | null = null
  if (score) {
    const result = await client.post<{ fit: { score: number } }>(`/jobs/${id}/score`, {})
    fitScore = result.fit.score
  }
  return {
    job: {
      id: payload.job.id,
      title: payload.job.title,
      jdLength: payload.job.jdText?.length ?? 0,
      keywords: payload.job.keywords ?? [],
    },
    source: payload.source,
    signals: payload.signals,
    warnings: payload.warnings,
    fitScore,
  }
}

/** 公司不存在就建：Agent 手上通常只有公司名，要求它先查 id 是给用户增加步骤 */
async function resolveCompanyId(input: { companyId?: string; company?: string; city?: string }): Promise<string> {
  if (input.companyId) return input.companyId
  if (!input.company) throw new Error('需要 companyId 或 company 之一')
  const found = await client.get<CompanyRow[]>(`/companies${qs({ q: input.company, limit: 20 })}`)
  const hit = found.find((item) => item.name === input.company)
  if (hit) return hit.id
  const created = await client.post<CompanyRow>('/companies', {
    name: input.company,
    ...(input.city ? { city: input.city } : {}),
  })
  return created.id
}

export function registerJobTools(server: McpServer): void {
  server.registerTool(
    'add_job',
    {
      title: '新增岗位',
      description:
        '登记岗位。传 jdUrl 时可以顺便抓 JD 正文并打 fit 分（fetchJd=true，默认开）。company 只给名字即可，公司不存在会自动创建。同一个 JD 链接已登记过时不会重复建岗，会返回已有岗位。',
      inputSchema: {
        company: z.string().optional().describe('公司名（与 companyId 二选一）'),
        companyId: z.string().optional(),
        title: z.string().min(1).max(120),
        jdUrl: z.string().optional(),
        jdText: z.string().optional().describe('已粘贴的 JD 正文'),
        city: z.string().optional(),
        salaryMin: z.number().int().min(0).optional().describe('月薪下限，单位元'),
        salaryMax: z.number().int().min(0).optional(),
        level: z.string().optional(),
        channel: z.enum(['official', 'referral', 'platform', 'other']).optional(),
        priority: z.number().int().min(1).max(5).optional(),
        fetchJd: z.boolean().optional().describe('有 jdUrl 时是否抓正文并打分，默认 true'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        // 同一个 JD 链接只登记一次：Agent 常常被反复要求「把这家加进来」。
        // 归一化在服务端做（去 utm_/hash/尾斜杠），这里只负责先查再建。
        if (input.jdUrl) {
          const existing = await client.get<JobRow[]>(`/jobs${qs({ jdUrl: input.jdUrl, limit: 5 })}`)
          const hit = existing[0]
          if (hit) {
            return ok(
              {
                duplicate: true,
                job: { id: hit.id, title: hit.title, fitScore: hit.fitScore ?? null },
                warning: `这个 JD 链接已登记为岗位「${hit.title}」（${hit.id}），没有重复创建。要刷新正文请用 fetch_jd，要改字段请直接改这条岗位。`,
              },
              { nextActions: ['get_job 看已有岗位的 JD 与 fit', 'fetch_jd 重新抓取正文'] },
            )
          }
        }

        const companyId = await resolveCompanyId(input)
        const job = await client.post<JobRow>('/jobs', {
          companyId,
          title: input.title,
          ...(input.jdUrl ? { jdUrl: input.jdUrl } : {}),
          ...(input.jdText ? { jdText: input.jdText } : {}),
          ...(input.city ? { city: input.city } : {}),
          ...(input.salaryMin != null ? { salaryMin: input.salaryMin } : {}),
          ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
          ...(input.level ? { level: input.level } : {}),
          ...(input.channel ? { channel: input.channel } : {}),
          ...(input.priority != null ? { priority: input.priority } : {}),
        })

        let scored: Record<string, unknown> | null = null
        let warning: string | null = null
        const shouldFetch = (input.fetchJd ?? true) && Boolean(input.jdUrl) && !input.jdText
        if (shouldFetch) {
          try {
            await client.post(`/jobs/${job.id}/fetch-jd`, {})
            const result = await client.post<{ fit: { score: number; capped: boolean } }>(`/jobs/${job.id}/score`, {})
            scored = { score: result.fit.score, capped: result.fit.capped }
          } catch (error) {
            // 抓取失败不该让「加岗位」整体失败：岗位已经建好了，缺的只是 JD 正文
            warning = `JD 抓取或打分失败：${jdFailureText(error)}；拿到用户粘贴的正文后写回岗位，再调 score_job`
          }
        }

        return ok(
          { job: { id: job.id, title: job.title, fitScore: scored?.score ?? job.fitScore ?? null }, scored, warning },
          { nextActions: ['get_job 看 fit 因子', 'create_application 登记投递'] },
        )
      }),
  )

  server.registerTool(
    'fetch_jd',
    {
      title: '抓取 / 重抓 JD',
      description:
        '按岗位已存的 JD 链接（或传入 url）采集正文，回写关键词、城市、薪资等结构化信号，并默认重算 fit。官方 ATS 会走公开接口；平台站失败时错误里带「改用官网链接 / 粘贴正文」的具体指引。',
      inputSchema: {
        id: z.string().min(1),
        url: z.string().optional().describe('不传用岗位已存的 JD 链接'),
        score: z.boolean().optional().default(true).describe('抓完是否重算 fit，默认 true'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, url, score }) =>
      guard(async () => {
        const payload = await client.post<JdWritePayload>(`/jobs/${id}/fetch-jd`, url ? { url } : {})
        return ok(await jdSummary(id, payload, score), {
          nextActions: ['get_job 读 JD 全文', 'score_job 单独重算 fit'],
        })
      }),
  )

  server.registerTool(
    'import_jd',
    {
      title: '粘贴 JD 正文',
      description:
        '把用户粘贴或 Agent 用浏览器读回的完整 JD 正文写进已有岗位。自动抓取失败、平台登录墙时走这里：清洗、关键词抽取、城市薪资补全、快照与 fit 重算都与自动抓取一致，Web 端刷新即可看到。',
      inputSchema: {
        id: z.string().min(1),
        text: z.string().min(1).max(200_000).describe('完整 JD 原文，不要摘要、不要改写'),
        url: z.string().optional().describe('原始招聘页链接，岗位还没存链接时可顺手补上'),
        capturedBy: z
          .enum(['paste', 'browser'])
          .optional()
          .default('paste')
          .describe('正文来自人工粘贴还是 Agent 自带浏览器读取；浏览器兜底时传 browser'),
        score: z.boolean().optional().default(true).describe('写入后是否重算 fit，默认 true'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, text, url, capturedBy, score }) =>
      guard(async () => {
        const payload = await client.post<JdWritePayload>(`/jobs/${id}/import-jd`, {
          text,
          capturedBy,
          ...(url ? { url } : {}),
        })
        return ok(await jdSummary(id, payload, score), {
          nextActions: ['get_job 读 JD 全文', 'score_job 单独重算 fit'],
        })
      }),
  )

  server.registerTool(
    'list_jobs',
    {
      title: '岗位列表',
      description: '按 fit/状态/城市/公司查岗位，默认按 fit 降序。只返回摘要，正文用 get_job。',
      inputSchema: {
        q: z.string().optional(),
        status: z.enum(JOB_STATUSES).optional(),
        minFit: z.number().int().min(0).max(100).optional(),
        city: z.string().optional(),
        companyId: z.string().optional(),
        sort: z.enum(['fit', 'priority', 'updated']).optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const rows = await client.get<JobRow[]>(`/jobs${qs(input)}`)
        return ok({ count: rows.length, jobs: pickAll(rows, JOB_KEYS) })
      }),
  )

  server.registerTool(
    'get_job',
    {
      title: '岗位详情',
      description: '完整 JD 正文、关键词、fit 因子与关联投递。返回内容可能较长，只在需要细读某一份时调用。',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      guard(async () => {
        const job = await client.get<Record<string, unknown>>(`/jobs/${id}`)
        return ok({ job, fitHint: fitFactorSummary(job) })
      }),
  )

  server.registerTool(
    'score_job',
    {
      title: '重算 fit',
      description: '用规则重算匹配度（可复算、同输入同输出）。想用 AI 判断覆盖它请用 override_fit。',
      inputSchema: {
        id: z.string().min(1),
        resumeId: z.string().optional().describe('指定简历；不传用默认简历'),
        expectedSalary: z.number().int().min(0).optional(),
        mustHave: z.array(z.string().min(1).max(40)).optional().describe('硬性要求，不满足会封顶 40 分'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, ...input }) =>
      guard(async () => {
        const result = await client.post<{
          job: { fitScore: number; fitSource: string; fitReasons: string[] | null }
          fit: { score: number; capped: boolean; factors: { key: string; label: string; value: number }[] }
        }>(`/jobs/${id}/score`, input)
        return ok({
          score: result.fit.score,
          capped: result.fit.capped,
          reasons: result.job.fitReasons,
          factors: result.fit.factors,
        })
      }),
  )

  server.registerTool(
    'override_fit',
    {
      title: '人工/AI 覆写 fit',
      description:
        '覆盖规则分。必须给出理由，写入后 fit_source=agent 或 user，便于以后回看「当初为什么判断它值得投」。不允许只改分数不给理由。',
      inputSchema: {
        id: z.string().min(1),
        score: z.number().int().min(0).max(100),
        reasons: z.array(z.string().max(300)).min(1).describe('至少一条理由，写在 fit_reasons 里'),
        source: z.enum(['agent', 'user']).optional().default('agent'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, score, reasons, source }) =>
      guard(async () => {
        const job = await client.patch<JobRow>(`/jobs/${id}`, {
          fitScore: score,
          fitReasons: reasons,
          fitSource: source ?? 'agent',
        })
        return ok({ id: job.id, fitScore: job.fitScore, fitSource: source ?? 'agent' })
      }),
  )
}
