import { DB_FILE, DEFAULT_PORT, HOST, LOG_DIR, WEB_ROOT, ensureDataDirs } from './config.js'
import { buildApp } from './app.js'
import { createLogger } from './logger.js'
import { AlreadyRunningError, resolvePort } from './port.js'
import { getOrCreateToken } from './token.js'

async function main(): Promise<void> {
  ensureDataDirs()
  const logger = createLogger(LOG_DIR)
  const token = getOrCreateToken()

  let port: number
  try {
    port = await resolvePort(DEFAULT_PORT)
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      logger.info(error.message)
      process.exit(0)
    }
    throw error
  }

  const land = await buildApp({ dbFile: DB_FILE, token, port, webRoot: WEB_ROOT, logger })

  await land.app.listen({ host: HOST, port })
  logger.info({ port, db: DB_FILE, webRoot: WEB_ROOT }, 'land-a-job 已启动')
  process.stdout.write(`\n  Land a Job   http://${HOST}:${port}\n  数据目录     ${DB_FILE}\n\n`)

  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    logger.info({ signal }, '正在关闭')
    await land.close()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`启动失败：${message}\n`)
  process.exit(1)
})
