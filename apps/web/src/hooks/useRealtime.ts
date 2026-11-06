import { useEffect, useRef, useState } from 'react'

export type RealtimeStatus = 'connecting' | 'open' | 'closed'

interface InvalidateMessage {
  type?: string
  keys?: string[]
}

/**
 * 服务端单向推送（server → page），页面改动仍走 HTTP。
 * 断线后指数退避重连，上限 30s；页面关闭时彻底断开，避免 StrictMode 下双连。
 */
export function useRealtime(onInvalidate: (keys: string[]) => void): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const handler = useRef(onInvalidate)
  handler.current = onInvalidate

  useEffect(() => {
    let socket: WebSocket | null = null
    let timer: number | undefined
    let attempt = 0
    let disposed = false

    const connect = (): void => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`)

      socket.onopen = () => {
        attempt = 0
        setStatus('open')
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as InvalidateMessage
          if (message.type === 'invalidate') handler.current(message.keys ?? [])
        } catch {
          // 忽略非 JSON 消息
        }
      }

      socket.onclose = () => {
        setStatus('closed')
        if (disposed) return
        attempt += 1
        const delay = Math.min(30_000, 1000 * 2 ** (attempt - 1))
        timer = window.setTimeout(connect, delay)
      }

      socket.onerror = () => socket?.close()
    }

    connect()

    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
      socket?.close()
    }
  }, [])

  return status
}
