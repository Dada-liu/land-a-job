import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { RESUME_TEMPLATES } from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'
import { deepMerge, pickAll, qs, stamp, withProvenance } from './shared.js'

const RESUME_KEYS = ['id', 'title', 'kind', 'templateId', 'jobId', 'baseResumeId', 'isDefault', 'updatedAt'] as const

interface ResumeRow extends Record<string, unknown> {
  id: string
  title: string
  kind: string
  data: Record<string, unknown>
}

interface TailorPlanPayload {
  plan: {
    summaryHints: string[]
    reorderProjects: string[]
    reorderSkills: string[]
    gap: { keyword: string; severity: string; suggestion: string }[]
    constraints: string[]
    mustNotInvent: boolean
    match: { jdTech: number; matched: number; ratio: number }
  }
  instruction: string
}

export function registerResumeTools(server: McpServer): void {
  server.registerTool(
    'list_resumes',
    {
      title: '简历列表',
      description: '母版与各岗位定制版。定制版的 baseResumeId 指向母版，用于算版本胜率。',
      inputSchema: {
        kind: z.enum(['master', 'variant']).optional(),
        jobId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const rows = await client.get<ResumeRow[]>(`/resumes${qs(input)}`)
        return ok({ count: rows.length, resumes: pickAll(rows, RESUME_KEYS) })
      }),
  )

  server.registerTool(
    'get_resume',
    {
      title: '简历全文',
      description: '取完整正文（含条目 id）。改简历前必须先读这份，否则会覆盖掉用户手写的内容。',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      guard(async () => {
        const resume = await client.get<ResumeRow>(`/resumes/${id}`)
        return ok({ resume, itemIds: collectItemIds(resume.data) })
      }),
  )

  server.registerTool(
    'create_resume',
    {
      title: '新建简历',
      description: '从零建一份简历。多数场景应改用 duplicate_resume 复制母版，避免丢格式。',
      inputSchema: withProvenance({
        title: z.string().min(1).max(120),
        templateId: z.enum(RESUME_TEMPLATES).optional(),
        data: z.record(z.string(), z.unknown()),
        isDefault: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ provenance, ...input }) =>
      guard(async () => {
        const resume = await client.post<ResumeRow>('/resumes', {
          ...input,
          provenance: stamp(provenance),
        })
        return ok({ id: resume.id, title: resume.title }, { nextActions: ['get_resume 确认内容', 'export_resume_pdf 出 PDF'] })
      }),
  )

  server.registerTool(
    'duplicate_resume',
    {
      title: '复制简历',
      description: '复制成定制版（kind=variant，血缘指向母版）。这是改简历前的标准第一步。',
      inputSchema: {
        id: z.string().min(1),
        title: z.string().optional(),
        jobId: z.string().optional().describe('绑定岗位，后续「哪版简历带来面试」靠它统计'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ id, ...input }) =>
      guard(async () => {
        const resume = await client.post<ResumeRow>(`/resumes/${id}/duplicate`, input)
        return ok({ id: resume.id, title: resume.title, jobId: resume.jobId })
      }),
  )

  server.registerTool(
    'update_resume',
    {
      title: '修改简历正文',
      description:
        '对 data 做深合并（数组整体替换，所以重排项目顺序会生效）。写接口必须带 provenance；服务端会校验 skill 名与版本。',
      inputSchema: withProvenance({
        id: z.string().min(1),
        data: z.record(z.string(), z.unknown()).describe('只传要改的部分，例如 { projects: [...] }'),
        title: z.string().min(1).max(120).optional(),
        expectedUpdatedAt: z.string().optional().describe('乐观锁：传你读到的 updatedAt'),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ provenance, id, data, ...rest }) =>
      guard(async () => {
        const current = await client.get<ResumeRow>(`/resumes/${id}`)
        const merged = deepMerge(current.data ?? {}, data)
        const resume = await client.patch<ResumeRow>(`/resumes/${id}`, {
          ...rest,
          data: merged,
          provenance: stamp(provenance),
        })
        return ok({ id: resume.id, updatedAt: resume.updatedAt })
      }),
  )

  server.registerTool(
    'tailor_resume',
    {
      title: '按 JD 定制简历',
      description:
        '两步走的第一步：返回「该突出什么」的计划 + 缺口清单，并复制出一份 variant 骨架。正文改写由你（Agent）完成，再调 update_resume 落库——应用不生成内容。严禁编造经历：summaryHints 只包含简历里已有证据的词。',
      inputSchema: {
        baseId: z.string().min(1).describe('母版简历 id'),
        jobId: z.string().min(1),
        title: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async ({ baseId, jobId, title }) =>
      guard(async () => {
        const payload = await client.get<TailorPlanPayload>(
          `/jobs/${jobId}/tailor-plan${qs({ resumeId: baseId })}`,
        )
        const variant = await client.post<ResumeRow>(`/resumes/${baseId}/duplicate`, {
          title: title ?? undefined,
          jobId,
        })
        return ok(
          {
            variantId: variant.id,
            plan: payload.plan,
            instruction: payload.instruction,
            mustNotInvent: true,
          },
          {
            nextActions: [
              '按 plan 改写后调用 update_resume（带 provenance）落到 variantId',
              'gap 里 severity=blocking 的项不要编造，如实留白并在面试前准备可迁移说法',
            ],
          },
        )
      }),
  )

  server.registerTool(
    'export_resume_pdf',
    {
      title: '导出简历 PDF',
      description: '无头导出 PDF 到 data/files/resumes/，返回落盘路径。缺 Chrome 时返回 CHROME_NOT_FOUND。',
      inputSchema: { id: z.string().min(1) },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id }) =>
      guard(async () => {
        const result = await client.post<{ filePath: string; bytes?: number }>(`/resumes/${id}/export`, {})
        return ok(result)
      }),
  )
}

/** 把条目 id 单列出来：Agent 改某个项目时要能准确指名，而不是靠下标猜 */
function collectItemIds(data: Record<string, unknown>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const key of ['experiences', 'projects', 'educations', 'skills', 'contacts']) {
    const value = data[key]
    if (!Array.isArray(value)) continue
    result[key] = value
      .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : null))
      .filter((id): id is string => typeof id === 'string')
  }
  return result
}
