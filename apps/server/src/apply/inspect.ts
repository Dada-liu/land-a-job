import type { Page } from 'puppeteer-core'

/**
 * 表单字段抽取（P4-2）。
 *
 * 关键约束：`page.evaluate` 里的代码会被序列化到浏览器执行，**不能引用外部变量**。
 * 所以可见性判断、标签回退都写在函数内部——这是最容易踩的坑。
 */

export const FIELD_TAGS = ['input', 'textarea', 'select', '[contenteditable="true"]'] as const

export interface FieldInfo {
  /** 稳定键：优先 id，其次 name，最后按下标兜底 */
  key: string
  tag: string
  type: string | null
  name: string | null
  id: string | null
  label: string
  placeholder: string | null
  options: string[] | null
  required: boolean
}

export async function inspectForm(page: Page): Promise<FieldInfo[]> {
  return page.evaluate(() => {
    const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image'])

    const visible = (element: Element): boolean => {
      const rect = (element as HTMLElement).getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return false
      const style = window.getComputedStyle(element as HTMLElement)
      if (style.visibility === 'hidden' || style.display === 'none') return false
      return !(element as HTMLInputElement).disabled
    }

    const labelOf = (element: Element): string => {
      const input = element as HTMLInputElement
      const tags = input.labels ? Array.from(input.labels) : []
      if (tags.length > 0 && tags[0]) {
        const text = (tags[0] as HTMLElement).innerText || tags[0].textContent || ''
        if (text.trim()) return text.trim().slice(0, 80)
      }
      const id = element.getAttribute('id')
      if (id) {
        const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`)
        if (explicit?.textContent?.trim()) return explicit.textContent.trim().slice(0, 80)
      }
      const aria = element.getAttribute('aria-label')
      if (aria?.trim()) return aria.trim().slice(0, 80)

      // 最后一招：找最近的祖先里的标题文本（很多表单不用 label，只用 div 包一层）
      let node: Element | null = element.parentElement
      for (let depth = 0; depth < 3 && node; depth += 1) {
        const heading = node.querySelector('label, .label, .form-label, dt')
        if (heading?.textContent?.trim()) return heading.textContent.trim().slice(0, 80)
        node = node.parentElement
      }
      return ''
    }

    const elements = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'))
    const fields: {
      key: string
      tag: string
      type: string | null
      name: string | null
      id: string | null
      label: string
      placeholder: string | null
      options: string[] | null
      required: boolean
    }[] = []

    elements.forEach((element, index) => {
      if (!visible(element)) return
      const input = element as HTMLInputElement
      if (input.type && SKIP_TYPES.has(input.type)) return

      const id = input.id || null
      const name = input.getAttribute('name')
      fields.push({
        key: id || name || `field-${index}`,
        tag: element.tagName.toLowerCase(),
        type: input.type || null,
        name,
        id,
        label: labelOf(element),
        placeholder: input.placeholder || null,
        options: element.tagName === 'SELECT' ? Array.from((element as HTMLSelectElement).options).map((option) => option.text) : null,
        required: Boolean(input.required),
      })
    })

    return fields
  })
}

/** 把字段列表按「能不能自动填」分组，页面与 Agent 都要看这份判断 */
export function summarizeFields(fields: FieldInfo[]): { fillable: FieldInfo[]; manual: FieldInfo[] } {
  const manual = fields.filter((field) => field.type === 'file' || field.tag === 'select' && (field.options ?? []).length === 0)
  const fillable = fields.filter((field) => !manual.includes(field))
  return { fillable, manual }
}
