import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import type { ResumeData } from '../types/resume'

/**
 * 「纸面直接编辑」的上下文。
 *
 * 为什么单独开一套上下文，而不是复用 ResumeEditorProvider：
 * 1. 模板组件是被 ResumePages 渲染的（屏幕预览、无头 PDF、打印页共用同一个组件）。
 *    没有 provider 时它必须退化成**纯静态渲染**，否则打印页/服务端导出会渲染出
 *    contenteditable。所以这里的消费口是「可能为空」，而 useResumeEditor 是必填的。
 * 2. 打印页（/resumes/:id?print=1）压根不该知道编辑这回事，也就不该被编辑器上下文绑住。
 *
 * 只有「自由编辑」模板会消费它；其它模板即使被包在 Provider 里也毫无影响。
 */
export interface FreeformEditApi {
  /**
   * 用「当前最新数据」算出下一版。
   *
   * 必须是 updater 而不是直接传新对象：纸面上的提交带 400ms 防抖，
   * 连着改两个字段时，第二个提交手里的 `data` 可能已经是旧的，
   * 直接传整份数据会把第一个字段的改动覆盖回去。
   */
  update: (updater: (current: ResumeData) => ResumeData) => void
}

const FreeformEditContext = createContext<FreeformEditApi | null>(null)

export interface FreeformEditProviderProps {
  /** 当前数据（与传给 ResumePages 的 data 是同一份） */
  value: ResumeData
  onChange: (next: ResumeData) => void
  children: ReactNode
}

export function FreeformEditProvider({ value, onChange, children }: FreeformEditProviderProps) {
  // 每次渲染刷新：updater 拿到的永远是最新一版
  const latest = useRef(value)
  latest.current = value

  const api = useMemo<FreeformEditApi>(
    () => ({ update: (updater) => onChange(updater(latest.current)) }),
    [onChange],
  )

  return <FreeformEditContext.Provider value={api}>{children}</FreeformEditContext.Provider>
}

/** 没有 Provider 时返回 null：模板据此决定「可编辑」还是「只渲染」 */
export function useFreeformEdit(): FreeformEditApi | null {
  return useContext(FreeformEditContext)
}
