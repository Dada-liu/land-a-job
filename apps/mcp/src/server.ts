import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VERSION } from '@land/core'
import { registerResources } from './resources.js'
import { registerTools } from './tools/index.js'

/**
 * 服务端 instructions：降低 Agent 乱序调用的概率。
 *
 * 这段文字会被放进每次会话的上下文，所以它写的是「顺序与禁止」，
 * 不写工具清单（工具清单本来就能从 tools/list 拿到，重复一遍只是烧 token）。
 */
export const INSTRUCTIONS = `land-a-job 是一个本地求职流水线。你通过这里的工具读写它的数据。

工作顺序（不要跳步）：
1. 任何会话都以 get_app_status 开始：确认服务在跑、Skill 版本兼容。服务不可用时如实告知用户，不要凭印象编造求职进度。
2. 「今天该做什么」→ get_dashboard，再按 today 列表逐条处置；处置完重新取一次确认已消失。
3. 投递类动作：create_application 登记 → start_apply_session 打开页面 → plan_form_fill 校验字段映射 → fill_form 执行 → 向用户复述并得到确认 → submit_application(confirm=true)。
4. 改简历：tailor_resume 拿计划 → 自己改写措辞 → update_resume 落库（必须带 provenance）。
5. 收岗位 JD：add_job / fetch_jd 走服务端采集；抓不到时按 jd-collect Skill 用 Agent 自带浏览器读回原文，再 import_jd 落库。浏览器兜底前先征得用户同意，产物没落库等于没完成。
6. 批量与新流程：job-search-batch（按城市批量搜岗）、resume-tailor-batch（批量定制并进 queued）、browser-apply（本机浏览器预填、用户亲自提交）、application-status-sync（定时巡检站点状态）各有独立 SKILL.md，先读再动手。这四个流程的第 0 步都是前置检查：服务可用、库里有简历；没有简历就启动前后端并打开 Web 创建简历页，让用户先建第一份母版。

硬性禁止：
- 不编造经历、学历、公司、在职时间、数字。缺失就如实留白，并记进缺口。
- 不在用户未明确同意时提交任何投递；提交前必须复述「公司 + 岗位 + 关键字段」。
- 页面出现验证码或登录墙时立即停止自动化，请用户人工处理，不要尝试绕过。
- 写接口必须带 provenance（skill 名必须在 SKILL_REGISTRY 内），否则会被拒绝。
- 本机浏览器辅助投递时最后一下提交由用户点击；没拿到「已提交」信号前不许把状态写成 applied，也不要用 submit_application 代投。
- 建 queued 投递不要写 appliedAt：漏斗会把带投递时间的待投记录算成「已投」。
- 目标未达成时不要虚报成功：这些工具的返回值就是事实来源。`

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'land-a-job', version: VERSION },
    {
      instructions: INSTRUCTIONS,
      // 单条工具入参不应该塞进整份简历；超出明显是误用，早报错比截断好
      maxToolInputElements: 20_000,
    },
  )
  registerTools(server)
  registerResources(server)
  return server
}
