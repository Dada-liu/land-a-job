import type { FastifyInstance } from 'fastify'
import { createSnapshot, exportAll, listSnapshots, SNAPSHOT_KEEP } from '../backup.js'
import { SNAPSHOT_DIR } from '../config.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

/**
 * 备份相关接口（P7-6）。
 *
 * 前缀用 `/api/data` 而不是 `/api/admin`：单用户本地没有「管理员」这个角色，
 * 这些就是「我的数据」的基本操作。
 */
export function registerDataRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  app.get('/api/data/snapshots', async () =>
    ok({ dir: SNAPSHOT_DIR, keep: SNAPSHOT_KEEP, items: listSnapshots(SNAPSHOT_DIR) }),
  )

  app.post('/api/data/snapshots', async (_request, reply) => {
    const snapshot = await createSnapshot(db, SNAPSHOT_DIR)
    return reply.code(201).send(ok(snapshot))
  })

  /**
   * 全库导出。
   *
   * 默认走 `{ data }` 信封（和其他接口一致，页面好处理）；
   * `?download=1` 时直接流回文件——这是继 PDF 之后第二个不经信封的接口，
   * 因为它的用途就是「存到磁盘再拷走」，包一层信封反而不方便。
   */
  app.get('/api/data/export', async (request, reply) => {
    const query = request.query as { download?: string }
    const dump = exportAll(db)

    if (query.download === '1') {
      const filename = `land-export-${dump.exportedAt.slice(0, 10)}.json`
      reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'no-store')
      return JSON.stringify(dump, null, 2)
    }

    return ok(dump)
  })
}
