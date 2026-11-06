import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildServer } from './server.js'

/**
 * MCP 入口（stdio）。
 *
 * 一条铁律：**stdout 只能走协议帧**。任何 console.log 都会把 JSON-RPC 流打坏，
 * 表现为「Agent 说工具连不上，但进程明明活着」。所以这里所有日志都写 stderr。
 */
async function main(): Promise<void> {
  const server = buildServer()
  const transport = new StdioServerTransport()

  transport.onerror = (error) => {
    process.stderr.write(`[land-mcp] transport 错误：${error.message}\n`)
  }

  await server.connect(transport)
  process.stderr.write(`[land-mcp] 已连接（stdio）。数据目录见 data/.port 与 data/.token\n`)

  const shutdown = (signal: string): void => {
    process.stderr.write(`[land-mcp] 收到 ${signal}，退出\n`)
    void server.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`[land-mcp] 启动失败：${message}\n`)
  process.exit(1)
})
