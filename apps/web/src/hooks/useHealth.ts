import { useCallback, useEffect, useState } from 'react'
import { getHealth, type HealthPayload } from '../lib/api'

export interface HealthState {
  status: 'loading' | 'online' | 'offline'
  data?: HealthPayload
  error?: string
}

/** 轮询服务状态：P0 阶段唯一的"活数据"，用来证明页面 → 服务 → SQLite 这条链是通的 */
export function useHealth(pollMs = 10_000): HealthState & { refresh: () => void } {
  const [state, setState] = useState<HealthState>({ status: 'loading' })
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const run = async (): Promise<void> => {
      try {
        const data = await getHealth()
        if (!cancelled) setState({ status: 'online', data })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'offline',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void run(), pollMs)
      }
    }

    void run()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pollMs, generation])

  const refresh = useCallback(() => setGeneration((n) => n + 1), [])
  return { ...state, refresh }
}
