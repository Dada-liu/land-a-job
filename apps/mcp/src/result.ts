import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { LandError, hintFor } from './errors.js'

/**
 * 工具返回的统一形状。
 *
 * MCP 的 `content` 只能是文本，所以全部走 JSON——但 JSON 不能直接甩给 Agent：
 * 一份 JD 动辄上万字，一次 list 的回包就能把上下文塞满。
 * 所以这里统一做「体积裁剪 + 明确的下一步建议」，让 Agent 知道该用哪个工具取详情。
 */

const MAX_TEXT = 8000

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

/** 超长字符串截断并标注：偷偷截断比报错更危险，Agent 会以为拿到了全文 */
function clip(value: unknown, limit = MAX_TEXT): { value: unknown; clipped: boolean } {
  const text = stringify(value)
  if (text.length <= limit) return { value, clipped: false }
  return {
    value: {
      truncated: true,
      note: `响应 ${text.length} 字符，已截断到 ${limit}；请用 get_* 工具按 id 取单条详情`,
      preview: text.slice(0, limit),
    },
    clipped: true,
  }
}

export function ok(payload: unknown, options: { nextActions?: string[] } = {}): CallToolResult {
  const { value } = clip(payload)
  const body =
    options.nextActions && options.nextActions.length > 0
      ? { data: value, nextActions: options.nextActions }
      : { data: value }
  return {
    content: [{ type: 'text', text: stringify(body) }],
  }
}

export function fail(error: unknown): CallToolResult {
  const base =
    error instanceof LandError
      ? { code: error.code, message: error.message, status: error.status, details: error.details }
      : { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) }
  const hint = hintFor(base.code)
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: stringify({
          error: { ...base, ...(hint ? { hint } : {}) },
          // 明确写出来：改参数重试有意义，换工具重试没有
          retry: base.code === 'SERVER_UNREACHABLE' || base.code === 'TOKEN_MISSING' ? 'after_user_action' : 'fix_arguments',
        }),
      },
    ],
  }
}

/** 所有工具的实现都套这一层，保证异常也变成「Agent 可读的结果」而不是协议错误 */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn()
  } catch (error) {
    return fail(error)
  }
}
