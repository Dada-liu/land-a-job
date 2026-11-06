import { useEffect, useState } from 'react'
import { getOverview, type OverviewPayload } from '../lib/api'

export interface OverviewState {
  status: 'loading' | 'ready' | 'error'
  data?: OverviewPayload
  error?: string
}

/**
 * 库内概览。`version` 变化即重取——App 收到 WS invalidate 时递增它，
 * 这样 Agent 侧（MCP）改完数据，页面不用刷新也能看到新数字。
 */
export function useOverview(version = 0): OverviewState {
  const [state, setState] = useState<OverviewState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await getOverview()
        if (!cancelled) setState({ status: 'ready', data })
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [version])

  return state
}
