import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

export interface WsHub {
  /** 数据变化后通知页面失效对应查询键 */
  invalidate(keys: string[]): void
  clientCount(): number
  close(): Promise<void>
}

const HEARTBEAT_MS = 30_000

/**
 * WebSocket 只做单向通知（server → page），页面改动走 HTTP。
 * 双向同步会引入双写冲突，本轮明确不做（ARCHITECTURE 6.3）。
 */
export function attachWs(server: Server): WsHub {
  const wss = new WebSocketServer({ server, path: '/ws' })
  const alive = new WeakSet<WebSocket>()

  wss.on('connection', (socket) => {
    alive.add(socket)
    socket.send(JSON.stringify({ type: 'hello', at: new Date().toISOString() }))

    socket.on('pong', () => alive.add(socket))
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as { type?: string }
        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }))
        }
      } catch {
        // 非法消息直接忽略，不因一个坏客户端断开整个连接池
      }
    })
    socket.on('error', () => socket.terminate())
  })

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.has(socket)) {
        socket.terminate()
        continue
      }
      alive.delete(socket)
      socket.ping()
    }
  }, HEARTBEAT_MS)
  heartbeat.unref()

  return {
    invalidate(keys) {
      const payload = JSON.stringify({ type: 'invalidate', keys, at: new Date().toISOString() })
      for (const socket of wss.clients) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload)
      }
    },
    clientCount: () => wss.clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat)
        for (const socket of wss.clients) socket.terminate()
        wss.close(() => resolve())
      }),
  }
}
