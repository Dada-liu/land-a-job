import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { CHANNELS, STATUSES } from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'
import { appliedAtForCreate, pickAll, qs } from './shared.js'

const APP_KEYS = ['id', 'jobId', 'jobTitle', 'companyName', 'status', 'statusAt', 'nextStatuses', 'daysInStatus', 'resumeId'] as const

interface ApplicationRow extends Record<string, unknown> {
  id: string
  status: string
  nextStatuses?: string[]
}

/** Agent 的写入一律标 agent/mcp：统计「AI 改的 vs 人改的」靠这两个字段 */
const AGENT_META = { actor: 'agent', source: 'mcp' } as const

export function registerApplicationTools(server: McpServer): void {
  server.registerTool(
    'create_application',
    {
      title: '登记投递',
      description:
        '登记一次投递。同一岗位已有活跃投递时返回 409 CONFLICT（带已有 id），此时应改那条而不是再建。默认状态 applied 并自动补投递时间；显式传 queued（进入待投）时不写 appliedAt，否则会被漏斗误算成已投。',
      inputSchema: {
        jobId: z.string().min(1),
        resumeId: z.string().optional().describe('本次投递用的简历；定制版请填 variant 的 id'),
        status: z.enum(STATUSES).optional().default('applied'),
        channel: z.enum(CHANNELS).optional().default('official'),
        appliedAt: z.string().optional().describe('ISO 时间；status 为 applied 之后必填'),
        contact: z.string().optional(),
        confidence: z.enum(['reported', 'screenshot', 'verified']).optional(),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const application = await client.post<ApplicationRow>('/applications', {
          ...input,
          appliedAt: appliedAtForCreate(input.status, input.appliedAt),
          ...AGENT_META,
        })
        return ok(
          { id: application.id, status: application.status },
          { nextActions: ['start_apply_session 打开官网表单', 'update_application_status 推进状态'] },
        )
      }),
  )

  server.registerTool(
    'list_applications',
    {
      title: '投递列表',
      description: '按状态/岗位/公司查投递，返回摘要（含 nextStatuses 与在状态里待了几天）。',
      inputSchema: {
        status: z.enum(STATUSES).optional(),
        jobId: z.string().optional(),
        companyId: z.string().optional(),
        active: z.boolean().optional().describe('只要活跃的（未进终态）'),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const rows = await client.get<ApplicationRow[]>(`/applications${qs(input)}`)
        return ok({ count: rows.length, applications: pickAll(rows, APP_KEYS) })
      }),
  )

  server.registerTool(
    'get_application',
    {
      title: '投递详情',
      description: '单条投递的完整信息，含允许的下一状态。推进状态前先看 nextStatuses，不要试错。',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      guard(async () => {
        const application = await client.get<ApplicationRow>(`/applications/${id}`)
        return ok({ application })
      }),
  )

  server.registerTool(
    'update_application_status',
    {
      title: '推进投递状态',
      description:
        '状态机校验：非法跃迁返回 INVALID_TRANSITION 并带 allowed 列表。终态复活必须 force=true 且给 reason（会留痕）。',
      inputSchema: {
        id: z.string().min(1),
        to: z.enum(STATUSES),
        note: z.string().max(2000).optional(),
        force: z.boolean().optional().describe('仅在人工确认「标错了」时用'),
        reason: z.string().max(500).optional(),
        appliedAt: z.string().optional().describe('首次推进到 applied 时可补投递时间'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, ...input }) =>
      guard(async () => {
        const result = await client.post<{ application: ApplicationRow; from: string; to: string }>(
          `/applications/${id}/status`,
          { ...input, ...AGENT_META },
        )
        return ok({
          id: result.application.id,
          from: result.from,
          to: result.to,
          nextStatuses: result.application.nextStatuses,
        })
      }),
  )

  server.registerTool(
    'add_application_note',
    {
      title: '追加备注',
      description: '往时间线追加一条备注（面试反馈、HR 沟通、邮件要点都写这里）。',
      inputSchema: {
        id: z.string().min(1),
        note: z.string().min(1).max(4000),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, note }) =>
      guard(async () => {
        const event = await client.post<Record<string, unknown>>(`/applications/${id}/notes`, {
          note,
          ...AGENT_META,
        })
        return ok({ event })
      }),
  )

  server.registerTool(
    'get_timeline',
    {
      title: '投递时间线',
      description: '完整事件流：状态变更、备注、存证。复盘「这条为什么挂了」时先读它。',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      guard(async () => {
        const events = await client.get<Record<string, unknown>[]>(`/applications/${id}/timeline`)
        return ok({ count: events.length, events })
      }),
  )
}
