import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerApplicationTools } from './application.js'
import { registerApplyTools } from './apply.js'
import { registerCompanyTools } from './company.js'
import { registerInsightTools } from './insights.js'
import { registerInterviewTools } from './interview.js'
import { registerJobTools } from './job.js'
import { registerOfferTools } from './offer.js'
import { registerResumeTools } from './resume.js'

/**
 * 工具清单（P5-2 ~ P5-5）。
 *
 * 这里维护一份**名字清单**是有意的：skills 目录下 SKILL.md 里引用的工具名要能被静态检查，
 * 而「从 server 实例反查已注册工具」需要一个真的 MCP server。清单 + 一条比对测试
 * （test/manifest.test.ts）比「谁记得住」可靠。
 */
export const TOOL_MANIFEST = [
  // 洞察
  'get_app_status',
  'get_dashboard',
  'list_followups',
  'resume_performance',
  // 公司
  'create_company',
  'list_companies',
  'update_company',
  // 岗位
  'add_job',
  'fetch_jd',
  'import_jd',
  'list_jobs',
  'get_job',
  'score_job',
  'override_fit',
  // 简历
  'list_resumes',
  'get_resume',
  'create_resume',
  'duplicate_resume',
  'update_resume',
  'tailor_resume',
  'export_resume_pdf',
  // 投递
  'create_application',
  'list_applications',
  'get_application',
  'update_application_status',
  'add_application_note',
  'get_timeline',
  // 投递助手
  'start_apply_session',
  'plan_form_fill',
  'fill_form',
  'submit_application',
  'close_apply_session',
  // 面试
  'schedule_interview',
  'list_interviews',
  'update_interview',
  'get_interview_context',
  'save_question',
  'score_answer',
  // Offer
  'create_offer',
  'list_offers',
  'update_offer',
  'compare_offers',
  'get_negotiation_brief',
] as const

export type ToolName = (typeof TOOL_MANIFEST)[number]

export function registerTools(server: McpServer): void {
  // 注册顺序刻意与 Skill 的典型调用顺序一致：先看（insights），再动（写接口）
  registerInsightTools(server)
  registerCompanyTools(server)
  registerJobTools(server)
  registerResumeTools(server)
  registerApplicationTools(server)
  registerApplyTools(server)
  registerInterviewTools(server)
  registerOfferTools(server)
}
