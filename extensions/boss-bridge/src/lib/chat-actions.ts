/**
 * 聊天页的纯判定逻辑：会话匹配、发简历按钮是否可点。
 *
 * 放在这里而不是直接写在内容脚本里，是因为「该不该点」必须能单测——
 * 点错一次等于给对方发错简历，这个错误不可撤销。
 */

export interface ConversationLike {
  /** 会话标题里能看到的公司名 / 招聘者名 */
  label: string
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[\u200B-\u200F\uFEFF]/g, '')
}

/**
 * 从会话列表里挑出目标公司那一条。
 *
 * 优先精确匹配，其次包含匹配；多个包含时取**最短**的那条（避免「拓保软件（深圳）」
 * 抢在「拓保软件」前面）。都匹配不到就返回 null，让上层停下——绝不发错人。
 */
export function pickConversation<T extends ConversationLike>(list: T[], target: string): T | null {
  const wanted = normalize(target)
  if (!wanted) return null
  const exact = list.find((item) => normalize(item.label) === wanted)
  if (exact) return exact
  const partial = list
    .filter((item) => normalize(item.label).includes(wanted) || wanted.includes(normalize(item.label)))
    .sort((a, b) => normalize(a.label).length - normalize(b.label).length)
  return partial[0] ?? null
}

export interface ResumeButtonState {
  available: boolean
  reason: string
}

/**
 * 「发简历」按钮的状态判定（实测结论）。
 *
 * Boss 在**对方还没回复**时把按钮渲染成 `unable`，并在 `aria-label` 里写
 * 「正在请求中，等待对方回复」。这种情况必须原样告诉用户，而不是点一下试试。
 */
export function parseResumeButton(className: string, ariaLabel?: string): ResumeButtonState {
  const label = (ariaLabel ?? '').trim()
  if (!className.includes('unable')) {
    return { available: true, reason: '可以发简历' }
  }
  if (/请求|等待|回复/.test(label)) return { available: false, reason: label }
  return { available: false, reason: label || '对方尚未回复，暂不能发简历' }
}

/** 附件列表里是否已经出现这次上传的文件（Boss 列表按上传时间倒序） */
export function hasUploadedFile(list: string[], fileName: string): boolean {
  const wanted = normalize(fileName).toLowerCase()
  if (!wanted) return false
  return list.some((item) => {
    const value = normalize(item).toLowerCase()
    return value.includes(wanted) || (wanted.endsWith('.pdf') && value.includes(wanted.replace(/\.pdf$/, '')))
  })
}
