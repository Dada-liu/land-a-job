import path from 'node:path'
import pino from 'pino'
import { SERVICE_NAME } from './config.js'

/**
 * 同时写 stdout 与 data/logs/server.log：
 * stdout 便于开发期直接看，文件便于事后排查（MCP 拉起服务时 stdout 无人接管）。
 */
export function createLogger(logDir: string) {
  const streams: Parameters<typeof pino.multistream>[0] = [
    { level: 'info', stream: process.stdout },
  ]

  try {
    // 同步写入：本地单用户场景吞吐不是瓶颈，但「退出时不丢最后几条日志」很重要。
    // 异步流在 process.exit 时会触发 sonic-boom flushSync 未就绪的报错，反而污染退出码。
    const file = pino.destination({ dest: path.join(logDir, 'server.log'), sync: true, mkdir: true })
    streams.push({ level: 'debug', stream: file })
  } catch {
    // 文件不可写时退化为仅 stdout，不影响服务启动
  }

  return pino(
    { level: process.env.LAND_LOG_LEVEL ?? 'info', base: { service: SERVICE_NAME } },
    pino.multistream(streams),
  )
}
