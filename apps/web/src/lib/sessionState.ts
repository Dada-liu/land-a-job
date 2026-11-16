/**
 * 把一小段 UI 状态记在 sessionStorage 里。
 *
 * 场景：岗位库的筛选条件在切换一级 tab（组件卸载）后就没了，回来得重选一遍。
 * 用 session 而不是 local：这是「本次浏览的上下文」，关掉标签页就该清掉；
 * 也不该在多个窗口/标签页之间互相串（localStorage 会串）。
 *
 * 存的值一律 JSON：字符串、数字、数组都能原样回来。读失败（隐私模式、配额满、
 * 手改坏了 JSON）一律退回默认值——记不住筛选条件不值得让整页报错。
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/** 加前缀，免得和同源下别的东西撞 key */
const PREFIX = 'land.ui.'

export function readSession<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeSession(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 存不进去就算了：下次进来只是回到默认值，不影响当前这次使用
  }
}

/**
 * 与 useState 同形（含函数式更新），值会自动镜像到 sessionStorage。
 * 泛型要显式写：`useSessionState<'fit' | 'priority'>('jobs.sort', 'fit')`，
 * 否则会被推断成字面量类型，setter 收不了别的值。
 */
export function useSessionState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readSession(key, fallback))

  useEffect(() => {
    writeSession(key, value)
  }, [key, value])

  return [value, setValue]
}
