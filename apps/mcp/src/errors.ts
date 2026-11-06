/**
 * MCP 侧的错误类型。
 *
 * 与 server 的 AppError 保持同一套 code 词表，但**不共享代码**：
 * MCP 是独立进程，import server 的运行时会把 better-sqlite3、fastify 全拖进来。
 */
export interface AppErrorBody {
  code: string
  message: string
  details?: unknown
}

export class LandError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(input: { code: string; message: string; status: number; details?: unknown }) {
    super(input.message)
    this.name = 'LandError'
    this.code = input.code
    this.status = input.status
    this.details = input.details
  }
}

/**
 * 给 Agent 的「可自我纠正」提示。
 *
 * 同一个 400，Agent 看到「参数不合法」只会重试；看到「当前状态 applied 不能到 offer，
 * 允许：screening/rejected」才知道下一步该调什么。这段文案是产品体验的一部分。
 */
const RECOVERY_HINTS: Record<string, string> = {
  INVALID_TRANSITION: '状态机拒绝：请先看 allowed 列表，选择允许的目标状态',
  CONFLICT: '存在冲突记录：先 list/get 找到已有那条，改它而不是新建',
  VALIDATION_FAILED: '参数校验失败：按 details 里的 path 修正后重试，不要换工具重试',
  SKILL_OUTDATED: 'Skill 版本过旧：让用户执行 bash scripts/install-skills.sh 后重试',
  SKILL_UNKNOWN: 'Skill 名未登记：只能用 SKILL_REGISTRY 里登记过的名字',
  NOT_FOUND: '记录不存在：可能是 id 写错，先 list 一遍拿到真实 id',
  SERVER_UNREACHABLE: '服务未启动：已尝试自动拉起但失败，请让用户手动 npm start',
  TOKEN_MISSING: '读不到令牌：让用户先启动一次服务端',
  CONFIRM_REQUIRED: '提交类操作必须显式 confirm:true，且应当先向用户复述将要提交的内容',
  APPLY_BLOCKED: '页面有验证码/登录墙：必须停止自动化，请用户人工处理后继续',
  CHROME_NOT_FOUND: '找不到本机 Chrome：改用「复制粘贴」面板人工投递',
  JD_URL_MISSING: '岗位没有 JD 链接：先补链接，或让用户粘贴 JD 正文后写回岗位',
  JD_URL_INVALID: 'JD 链接不合法：检查是否是完整 http(s) 链接，不要传标题或片段',
  JD_TOO_SHORT: '抓到的正文过短（登录墙/JS 渲染/列表页）：按 details.hint 让用户粘贴全文，或换公司官网的同岗位链接重试，不要用标题臆造 JD',
  JD_TOO_LARGE: '页面超过 4MB：多半不是岗位详情页，换链接或让用户粘贴正文',
  JD_FETCH_FAILED: '抓取失败：看 details.attempts 与 details.hint，官方渠道可重试，平台站直接请用户粘贴正文',
  JD_ATS_FAILED: '官方 ATS 接口失败：管线会自动降级到通用抓取；仍失败就请用户粘贴正文',
}

export function hintFor(code: string): string | undefined {
  return RECOVERY_HINTS[code]
}
