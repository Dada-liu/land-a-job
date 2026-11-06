import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { client } from '../client.js'
import { guard, ok } from '../result.js'

interface ApplyField {
  key: string
  tag: string
  type: string | null
  name: string | null
  label: string
  required: boolean
  options?: string[] | null
}

interface ApplySession {
  id: string
  jobId: string
  resumeId: string | null
  url: string
  status: string
  fields: ApplyField[]
  manualFields: string[]
  blocker?: { blocked: boolean; kind?: string; reason?: string }
}

/**
 * 投递助手工具（P4 的会话式接口的 MCP 暴露）。
 *
 * 分工：**映射由 Agent 决定，执行与校验由应用负责**。
 * 应用不做「猜哪个字段该填什么」——那种启发式一旦错了，会静默把手机号填进邮箱；
 * Agent 看得到 label 与 resume 全文，本来就比规则更擅长这件事。
 */
export function registerApplyTools(server: McpServer): void {
  server.registerTool(
    'start_apply_session',
    {
      title: '打开投递会话',
      description:
        '打开目标页面并扫描表单字段，返回字段清单（key/label/required/options）与「需人工处理」的字段（文件上传等）。同时只能有一个会话；页面有验证码或登录墙时 status=blocked，必须停下来让用户人工处理。',
      inputSchema: {
        jobId: z.string().min(1),
        resumeId: z.string().optional(),
        url: z.string().optional().describe('默认用岗位 JD 链接或公司的投递入口'),
        headless: z.boolean().optional().describe('默认有头（方便用户登录）；无人值守时才设 true'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const session = await client.post<ApplySession>('/apply/sessions', input)
        return ok(
          {
            sessionId: session.id,
            status: session.status,
            url: session.url,
            fields: session.fields,
            manualFields: session.manualFields,
            blocker: session.blocker ?? null,
          },
          session.status === 'blocked'
            ? { nextActions: ['页面被拦截：停止自动化，请用户人工处理后重新 inspect'] }
            : { nextActions: ['plan_form_fill 提交字段映射计划（先校验再填）'] },
        )
      }),
  )

  server.registerTool(
    'plan_form_fill',
    {
      title: '校验字段映射计划',
      description:
        '只校验不执行：把「字段 key → 值」的计划丢进来，返回哪些能用、哪些被拒（key 不存在/选项不存在）、哪些必填还没覆盖。fill_form 之前必须先过这一步。',
      inputSchema: {
        sessionId: z.string().min(1),
        mapping: z.record(z.string(), z.string()).describe('字段 key → 要填的值'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ sessionId, mapping }) =>
      guard(async () => {
        const session = await client.get<ApplySession>(`/apply/sessions/${sessionId}`)
        const byKey = new Map(session.fields.map((field) => [field.key, field]))

        const accepted: { key: string; label: string; value: string }[] = []
        const rejected: { key: string; reason: string; options?: string[] }[] = []
        for (const [key, value] of Object.entries(mapping)) {
          const field = byKey.get(key)
          if (!field) {
            rejected.push({ key, reason: '该 key 不在当前表单里（表单可能已变化，重跑 inspect）' })
            continue
          }
          if (field.options && field.options.length > 0 && !field.options.includes(value)) {
            rejected.push({ key, reason: '选项不存在', options: field.options })
            continue
          }
          accepted.push({ key, label: field.label, value })
        }

        const covered = new Set(accepted.map((item) => item.key))
        const missingRequired = session.fields
          .filter((field) => field.required && !covered.has(field.key))
          .map((field) => ({ key: field.key, label: field.label }))

        return ok({
          accepted,
          rejected,
          missingRequired,
          manualFields: session.manualFields,
          ready: rejected.length === 0 && missingRequired.length === 0,
        })
      }),
  )

  server.registerTool(
    'fill_form',
    {
      title: '执行填充',
      description:
        '按「字段 key → 值」逐字段填充，返回逐项成败。单个字段失败不影响其余；select 选项不存在会回传可选值。文件上传类字段无法自动填，需用户手动选文件。',
      inputSchema: {
        sessionId: z.string().min(1),
        values: z.record(z.string(), z.string()).describe('字段 key → 值；建议先经 plan_form_fill 校验'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ sessionId, values }) =>
      guard(async () => {
        const session = await client.post<ApplySession & { fillResults?: { key: string; ok: boolean; reason?: string }[] }>(
          `/apply/sessions/${sessionId}/fill`,
          { values },
        )
        const failed = (session.fillResults ?? []).filter((item) => !item.ok)
        return ok(
          {
            status: session.status,
            results: session.fillResults ?? [],
            failedCount: failed.length,
            manualFields: session.manualFields,
            fields: session.fields,
          },
          failed.length === 0
            ? { nextActions: ['提交前向用户复述公司 + 岗位 + 关键字段，得到确认后调 submit_application'] }
            : { nextActions: ['修正失败字段后重试；选项类失败按回传的可选值调整'] },
        )
      }),
  )

  server.registerTool(
    'submit_application',
    {
      title: '提交投递',
      description:
        '提交是对外部世界的不可逆动作：必须先向用户复述「公司 + 岗位 + 将要提交的关键字段」并得到明确同意，才可传 confirm:true。成功会自动登记投递、存截图、写时间线。',
      inputSchema: {
        sessionId: z.string().min(1),
        confirm: z.boolean().describe('必须为 true；用户未明确同意时不要传'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    },
    async ({ sessionId, confirm }) =>
      guard(async () => {
        const result = await client.post<{
          finalUrl: string
          screenshotPath: string | null
          buttonText: string | null
          emptyRequired: string[]
          application: { id: string; status: string }
        }>(`/apply/sessions/${sessionId}/submit`, { confirm })
        return ok({
          applicationId: result.application.id,
          status: result.application.status,
          finalUrl: result.finalUrl,
          screenshot: result.screenshotPath,
          buttonText: result.buttonText,
          emptyRequired: result.emptyRequired,
        })
      }),
  )

  server.registerTool(
    'close_apply_session',
    {
      title: '结束投递会话',
      description: '关闭浏览器并释放会话。15 分钟无操作也会自动关闭。',
      inputSchema: { sessionId: z.string().min(1) },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ sessionId }) =>
      guard(async () => {
        const result = await client.delete<{ closed: boolean }>(`/apply/sessions/${sessionId}`)
        return ok(result)
      }),
  )
}
