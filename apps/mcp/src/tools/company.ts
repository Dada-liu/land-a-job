import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { COMPANY_SIZES } from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'
import { pickAll, qs } from './shared.js'

const COMPANY_KEYS = ['id', 'name', 'city', 'priority', 'industry', 'jobCount'] as const

interface CompanyRow extends Record<string, unknown> {
  id: string
  name: string
}

export function registerCompanyTools(server: McpServer): void {
  server.registerTool(
    'create_company',
    {
      title: '新建公司',
      description:
        '登记一家公司。同名公司已存在时返回已有记录（409 CONFLICT 带 existingId），此时应直接用已有 id，不要换名字重试。',
      inputSchema: {
        name: z.string().min(1).max(120).describe('公司全名，尽量与官网一致'),
        website: z.string().optional().describe('官网首页 URL'),
        applyEntry: z.string().optional().describe('官网投递入口 URL，投递助手会从这里开始'),
        city: z.string().optional(),
        industry: z.string().optional(),
        size: z.enum(COMPANY_SIZES).optional(),
        priority: z.number().int().min(1).max(5).optional().describe('1 最高、5 最低；越想去越高'),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const company = await client.post<CompanyRow>('/companies', input)
        return ok(company, { nextActions: ['add_job 给这家公司加岗位'] })
      }),
  )

  server.registerTool(
    'list_companies',
    {
      title: '公司列表',
      description: '按优先级/关键词查公司，只返回摘要（id/名称/城市/优先级/岗位数）。',
      inputSchema: {
        q: z.string().optional().describe('名称关键词'),
        priority: z.number().int().min(1).max(5).optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ q, priority, limit }) =>
      guard(async () => {
        const rows = await client.get<CompanyRow[]>(`/companies${qs({ q, priority, limit })}`)
        return ok({ count: rows.length, companies: pickAll(rows, COMPANY_KEYS) })
      }),
  )

  server.registerTool(
    'update_company',
    {
      title: '修改公司',
      description: '只传要改的字段。带 expectedUpdatedAt 时启用乐观锁，不一致返回 VERSION_CONFLICT。',
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        website: z.string().nullable().optional(),
        applyEntry: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        industry: z.string().nullable().optional(),
        size: z.enum(COMPANY_SIZES).nullable().optional(),
        priority: z.number().int().min(1).max(5).optional(),
        notes: z.string().nullable().optional(),
        expectedUpdatedAt: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ id, ...patch }) =>
      guard(async () => {
        const company = await client.patch<CompanyRow>(`/companies/${id}`, patch)
        return ok({ company, changed: Object.keys(patch) })
      }),
  )
}
