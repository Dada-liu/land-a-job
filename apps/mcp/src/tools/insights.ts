import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SKILL_REGISTRY } from '@land/core'
import { client } from '../client.js'
import { guard, ok } from '../result.js'

/**
 * 洞察类工具：Skill 的第一步永远是看，不是写。
 *
 * 这组工具存在的意义是让「今天该做什么」有据可查——没有它们，
 * Agent 只能凭用户口述猜现状，然后就一定会开始编。
 */

interface DashboardPayload {
  northStar: { label: string; value: number; target: number; hint: string }
  funnel: { stage: string; label: string; reached: number; conversion: number | null }[]
  /**
   * 待办来自 `core/followup.ts` 的 `evaluateFollowups()`（纯函数现算）。
   * 字段名必须与 `FollowupTask` 一致：理由在 `detail`，不是 `reason`——
   * 写错类型不会报错，只会让 Agent 读到 undefined 然后自己编理由。
   */
  today: {
    kind: string
    applicationId?: string
    companyName?: string
    jobTitle?: string
    title: string
    detail: string
    days: number
    priority: string
  }[]
  week: { start: string; newJobs: number; newApplications: number; submitted: number; effective: number }
  totals: Record<string, number>
  upcoming: { interviews: number; offersPending: number }
}

export function registerInsightTools(server: McpServer): void {
  server.registerTool(
    'get_app_status',
    {
      title: '服务与 Skill 状态',
      description:
        'Skill 的第一步：确认服务可用、数据库正常、本机 Skill 版本是否兼容。返回 registeredSkills 里 compatible=false 时，应先让用户更新 Skill 再继续。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard(async () => {
        const health = await client.status()
        if (!health.ok) {
          return ok({
            service: 'down',
            error: health.error,
            // 明确告诉 Agent 不要继续，也不要编数据
            advice: '服务不可用：请如实告知用户并提示运行 npm start，不要凭印象回答求职进度',
          })
        }
        let skills: unknown = []
        try {
          skills = await client.get('/skills')
        } catch {
          skills = { note: '读取 skills 失败，不影响其余工具' }
        }
        return ok(
          {
            service: 'up',
            base: health.base,
            version: health.version,
            skills,
            registeredSkills: SKILL_REGISTRY.map((item) => ({
              name: item.name,
              version: item.version,
              minVersion: item.minVersion,
            })),
          },
          { nextActions: ['get_dashboard 看今天该做什么', 'list_followups 看待跟进的投递'] },
        )
      }),
  )

  server.registerTool(
    'get_dashboard',
    {
      title: '今日总览',
      description:
        '北极星（本周有效投递）、漏斗、今日待办、本周新增、近期面试与 offer 数。输出待办时最多取 5 条，并说明「为什么是现在」。',
      inputSchema: {
        now: z.string().optional().describe('ISO 时间，用于回看某一天；正常不传'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ now }) =>
      guard(async () => {
        const dashboard = await client.get<DashboardPayload>(
          `/stats/dashboard${now ? `?now=${encodeURIComponent(now)}` : ''}`,
        )
        return ok(
          {
            northStar: dashboard.northStar,
            week: dashboard.week,
            funnel: dashboard.funnel,
            upcoming: dashboard.upcoming,
            todayCount: dashboard.today.length,
            today: dashboard.today.slice(0, 10),
            totals: dashboard.totals,
          },
          {
            nextActions: [
              '对待办逐条处置：update_application_status / add_application_note',
              '需要出题准备面试时用 get_interview_context',
            ],
          },
        )
      }),
  )

  server.registerTool(
    'list_followups',
    {
      title: '待跟进清单',
      description:
        '规则命中的待跟进项（无回音催办、面试后感谢信、offer 倒计时、静默流失）。这些是现算结果，处置后自然消失，不需要「删除任务」。',
      inputSchema: {
        now: z.string().optional().describe('ISO 时间，用于回看；正常不传'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ now }) =>
      guard(async () => {
        const dashboard = await client.get<DashboardPayload>(
          `/stats/dashboard${now ? `?now=${encodeURIComponent(now)}` : ''}`,
        )
        return ok(
          { count: dashboard.today.length, tasks: dashboard.today },
          { nextActions: ['逐条处置后重新调用本工具确认已消失'] },
        )
      }),
  )

  server.registerTool(
    'resume_performance',
    {
      title: '简历版本胜率',
      description:
        '哪一版简历更容易过筛。样本 < 3 的条目 interviewRate/offerRate 为 null，必须按「样本不足」表述，不要据此下结论。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard(async () => {
        const rows = await client.get<{ resumeTitle: string; applied: number; enough: boolean }[]>(
          '/stats/resume-performance',
        )
        return ok({
          rows,
          caveat: '样本 < 3 不给转化率；1 投 1 面看起来是 100%，照着优化只会过拟合',
        })
      }),
  )
}
