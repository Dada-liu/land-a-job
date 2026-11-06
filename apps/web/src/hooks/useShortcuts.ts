import { useEffect, useRef } from 'react'

/**
 * 键盘快捷键（P7-4）。
 *
 * 只用两键序列（`g` 然后一个字母），不抢浏览器/系统单键：
 * 单键快捷键在中文输入法下会把「g」当拼音打到输入框里，用户会以为坏了。
 * 所以：
 * - 焦点在输入类元素时一律不接管；
 * - 只有按下 `g` 之后的 1.2 秒内按第二个键才生效；
 * - 序列中途按 Esc 直接放弃。
 */

export interface ShortcutMap {
  /** 形如 "g d" 或 "n" */
  [sequence: string]: () => void
}

const SEQUENCE_TIMEOUT_MS = 1200

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable
}

export function useShortcuts(map: ShortcutMap, enabled = true): void {
  const pendingRef = useRef<{ key: string; at: number } | null>(null)
  // 用 ref 存 map：调用方每次渲染都会传新对象，进依赖会导致反复解绑
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      const key = event.key.toLowerCase()

      if (key === 'escape') {
        pendingRef.current = null
        return
      }

      const pending = pendingRef.current
      if (pending && Date.now() - pending.at < SEQUENCE_TIMEOUT_MS) {
        const run = mapRef.current[`${pending.key} ${key}`]
        pendingRef.current = null
        if (run) {
          event.preventDefault()
          run()
          return
        }
      }

      // 单键命令
      const single = mapRef.current[key]
      if (single) {
        event.preventDefault()
        single()
        pendingRef.current = null
        return
      }

      // 有可能是序列的第一个键：只有当存在以它开头的序列时才记下来
      const startsSequence = Object.keys(mapRef.current).some((sequence) => sequence.startsWith(`${key} `))
      pendingRef.current = startsSequence ? { key, at: Date.now() } : null
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
