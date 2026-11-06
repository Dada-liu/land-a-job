import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  INTERVIEW_FORMATS,
  INTERVIEW_KINDS,
  INTERVIEW_RESULTS,
  PREP_STATUSES,
  QUESTION_CATEGORIES,
} from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'
import { pickAll, qs, stamp } from './shared.js'

interface InterviewRow extends Record<string, unknown> {
  id: string
  applicationId: string
  round: number
  result: string
}

interface ApplicationRow {
  id: string
  jobId: string
  resumeId: string | null
  status: string
}

interface QuestionRow {
  id: string
  question: string
  category: string
  linkedItem: string | null
}

const INTERVIEW_KEYS = ['id', 'applicationId', 'round', 'kind', 'scheduledAt', 'format', 'prepStatus', 'result'] as const

export function registerInterviewTools(server: McpServer): void {
  server.registerTool(
    'schedule_interview',
    {
      title: '安排面试',
      description: '登记一场面试。首次安排会把投递状态推进到 interview（状态机允许时）。',
      inputSchema: {
        applicationId: z.string().min(1),
        round: z.number().int().min(1).max(20).optional().describe('第几轮，默认 1'),
        kind: z.enum(INTERVIEW_KINDS).optional(),
        scheduledAt: z.string().optional().describe('ISO 时间'),
        durationMin: z.number().int().min(5).max(600).optional(),
        format: z.enum(INTERVIEW_FORMATS).optional(),
        interviewer: z.string().optional(),
        location: z.string().optional().describe('线下面试地址或会议链接'),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const interview = await client.post<InterviewRow>('/interviews', input)
        return ok({ interview }, { nextActions: ['get_interview_context 取材料后出题'] })
      }),
  )

  server.registerTool(
    'list_interviews',
    {
      title: '面试列表',
      description: '按投递或时间范围查面试。upcoming=true 只看未来的。',
      inputSchema: {
        applicationId: z.string().optional(),
        upcoming: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const rows = await client.get<InterviewRow[]>(`/interviews${qs(input)}`)
        return ok({ count: rows.length, interviews: pickAll(rows, INTERVIEW_KEYS) })
      }),
  )

  server.registerTool(
    'update_interview',
    {
      title: '更新面试',
      description: '改期、改准备状态、填反馈与自评、标记结果。准备完成时把 prepStatus 设为 done。',
      inputSchema: {
        id: z.string().min(1),
        scheduledAt: z.string().nullable().optional(),
        durationMin: z.number().int().min(5).max(600).nullable().optional(),
        format: z.enum(INTERVIEW_FORMATS).nullable().optional(),
        interviewer: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        prepStatus: z.enum(PREP_STATUSES).optional(),
        feedback: z.string().nullable().optional(),
        selfRating: z.number().int().min(1).max(5).nullable().optional(),
        result: z.enum(INTERVIEW_RESULTS).optional(),
        notes: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, ...patch }) =>
      guard(async () => {
        const interview = await client.patch<InterviewRow>(`/interviews/${id}`, patch)
        return ok({ interview, changed: Object.keys(patch) })
      }),
  )

  server.registerTool(
    'get_interview_context',
    {
      title: '取面试准备材料',
      description:
        '一次性取够出题所需的材料：JD 全文、简历正文、已有面试与历史题。应用不生成题目——出题由你完成，然后用 save_question 落库。',
      inputSchema: { applicationId: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ applicationId }) =>
      guard(async () => {
        const application = await client.get<ApplicationRow>(`/applications/${applicationId}`)
        const [job, resume, interviews, questions] = await Promise.all([
          client.get<Record<string, unknown>>(`/jobs/${application.jobId}`),
          application.resumeId
            ? client.get<Record<string, unknown>>(`/resumes/${application.resumeId}`)
            : Promise.resolve(null),
          client.get<InterviewRow[]>(`/interviews${qs({ applicationId, limit: 50 })}`),
          client.get<QuestionRow[]>(`/questions${qs({ jobId: application.jobId, limit: 200 })}`),
        ])

        return ok(
          {
            application,
            job: {
              id: job.id,
              title: job.title,
              jdText: job.jdText,
              keywords: job.keywords,
              fitScore: job.fitScore,
              fitReasons: job.fitReasons,
            },
            resume: resume ? { id: resume.id, title: resume.title, data: resume.data } : null,
            interviews,
            existingQuestions: questions.map((item) => ({
              id: item.id,
              question: item.question,
              category: item.category,
              linkedItem: item.linkedItem,
            })),
            rules: [
              '每道题必须标注对应 JD 要求或简历条目（linkedItem）',
              '不要重复 existingQuestions 里已有的题',
              '评分三维各 1–5 分并给出锚点（哪句话扣分）',
            ],
          },
          { nextActions: ['逐题 save_question；答完后 score_answer；结束时 update_interview 把 prepStatus 设为 done'] },
        )
      }),
  )

  server.registerTool(
    'save_question',
    {
      title: '保存面试题',
      description:
        '把生成的题落库（origin=generated）。必须带 provenance（job-prep），并且一题一证据：linkedItem 要指向具体 JD 要求或简历条目。',
      inputSchema: {
        jobId: z.string().optional(),
        interviewId: z.string().optional(),
        category: z.enum(QUESTION_CATEGORIES).optional(),
        question: z.string().min(1).max(2000),
        intent: z.string().max(2000).optional().describe('这道题想考什么'),
        linkedItem: z.string().max(200).optional().describe('对应的 JD 要求或简历条目'),
        origin: z.enum(['generated', 'manual', 'imported']).optional(),
        provenance: z
          .object({
            skill: z.string(),
            skillVersion: z.string(),
            model: z.string().optional(),
          })
          .describe('必须为 job-prep'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ provenance, ...input }) =>
      guard(async () => {
        const question = await client.post<QuestionRow>('/questions', {
          ...input,
          origin: input.origin ?? 'generated',
          provenance: stamp(provenance),
        })
        return ok({ id: question.id })
      }),
  )

  server.registerTool(
    'score_answer',
    {
      title: '评分与改进',
      description:
        '给一道题记答案与评分（三维各 1–5：内容/结构/表达），并写下具体改进点。分数必须带锚点，不能只给数字。',
      inputSchema: {
        id: z.string().min(1),
        myAnswer: z.string().max(20_000).optional(),
        score: z
          .object({
            content: z.number().min(1).max(5).optional(),
            structure: z.number().min(1).max(5).optional(),
            delivery: z.number().min(1).max(5).optional(),
          })
          .optional(),
        improvement: z.string().max(4000).optional().describe('具体到「哪一句该怎么说」'),
        provenance: z.object({ skill: z.string(), skillVersion: z.string(), model: z.string().optional() }),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, provenance, ...patch }) =>
      guard(async () => {
        const question = await client.patch<QuestionRow>(`/questions/${id}`, {
          ...patch,
          provenance: stamp(provenance),
        })
        return ok({ id: question.id })
      }),
  )
}
