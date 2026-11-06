import type { Page } from 'puppeteer-core'
import type { FieldInfo } from './inspect.js'

/**
 * 填充执行器（P4-3）。
 *
 * 逐字段独立执行、逐字段返回原因：一个字段失败不能连累其余字段。
 * 用原生 setter + 手动派发事件，因为 React / Vue 的受控组件只认原生 setter——
 * 直接 `el.value = x` 在 React 里会被下一次渲染覆盖回去。
 */

export interface FillResult {
  key: string
  ok: boolean
  reason?: string
}

export async function fillForm(
  page: Page,
  fields: FieldInfo[],
  values: Record<string, string>,
): Promise<FillResult[]> {
  return page.evaluate(
    (fieldList: { key: string; tag: string; type: string | null }[], input: Record<string, string>) => {
      const results: { key: string; ok: boolean; reason?: string }[] = []

      const setNativeValue = (element: HTMLElement, value: string): void => {
        const prototype =
          element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
        if (descriptor?.set) descriptor.set.call(element, value)
        else (element as HTMLInputElement).value = value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.dispatchEvent(new Event('blur', { bubbles: true }))
      }

      const findElement = (key: string): HTMLElement | null => {
        const byId = document.getElementById(key)
        if (byId) return byId as HTMLElement
        const byName = document.querySelector(`[name="${CSS.escape(key)}"]`)
        if (byName) return byName as HTMLElement
        const escaped = CSS.escape(key)
        return document.querySelector(`#${escaped}, [name="${escaped}"]`) as HTMLElement | null
      }

      for (const field of fieldList) {
        const value = input[field.key]
        if (value === undefined) continue // 没给值就跳过，不算失败

        const element = findElement(field.key)
        if (!element) {
          results.push({ key: field.key, ok: false, reason: '页面上找不到该字段（可能已换步骤）' })
          continue
        }

        try {
          if (field.tag === 'select') {
            const select = element as HTMLSelectElement
            const matched = Array.from(select.options).find(
              (option) => option.value === value || option.text.trim() === value.trim(),
            )
            if (!matched) {
              results.push({
                key: field.key,
                ok: false,
                reason: `选项里没有「${value}」；可选：${Array.from(select.options).map((o) => o.text).slice(0, 6).join('、')}`,
              })
              continue
            }
            select.value = matched.value
            select.dispatchEvent(new Event('change', { bubbles: true }))
            results.push({ key: field.key, ok: true })
            continue
          }

          if (field.type === 'checkbox' || field.type === 'radio') {
            const box = element as HTMLInputElement
            const shouldCheck = ['1', 'true', 'on', 'yes', '是', '同意'].includes(value.trim().toLowerCase())
            if (box.checked !== shouldCheck) box.click()
            results.push({ key: field.key, ok: true })
            continue
          }

          if (field.type === 'file') {
            results.push({ key: field.key, ok: false, reason: '文件上传需要人工选择文件' })
            continue
          }

          if (element.isContentEditable) {
            element.textContent = value
            element.dispatchEvent(new Event('input', { bubbles: true }))
            results.push({ key: field.key, ok: true })
            continue
          }

          const inputElement = element as HTMLInputElement
          inputElement.focus()
          setNativeValue(inputElement, value)
          const expected = value
          if (inputElement.value !== expected) {
            results.push({
              key: field.key,
              ok: false,
              reason: `写入后被页面格式化（期望「${expected}」，实际「${inputElement.value}」）`,
            })
            continue
          }
          results.push({ key: field.key, ok: true })
        } catch (error) {
          results.push({
            key: field.key,
            ok: false,
            reason: error instanceof Error ? error.message : String(error),
          })
        }
      }

      return results
    },
    fields.map((field) => ({ key: field.key, tag: field.tag, type: field.type })),
    values,
  )
}

/** 提交后复查：必填项是否还空着（前端校验没通过时最常见） */
export async function findEmptyRequired(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((element) => {
        const input = element as HTMLInputElement
        if (!input.required || input.disabled) return false
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        if (input.type === 'checkbox' || input.type === 'radio') return !input.checked
        return !input.value?.trim()
      })
      .map((element) => {
        const input = element as HTMLInputElement
        return input.labels?.[0]?.textContent?.trim() || input.name || input.id || input.type
      }),
  )
}
