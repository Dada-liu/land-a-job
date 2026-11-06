import type { FastifyInstance } from 'fastify'
import { overview } from '../db/repositories/application.js'
import { dashboard, resumePerformance } from '../db/repositories/stats.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

export function registerStatsRoutes(app: FastifyInstance, { db }: RouteDeps): void {
  /** 轻量概览：P1 起就在用，页面顶部计数与「库里有什么」直接读它 */
  app.get('/api/stats/overview', async () => ok(overview(db)))

  /**
   * Dashboard 聚合：北极星、漏斗、今日待办、本周新增。
   *
   * `?now=` 只为测试与「回看某一天」保留；正常调用不传，服务端用当前时间。
   * 跟进规则是纯函数现算，所以这个接口没有任何写副作用，可以放心轮询。
   */
  app.get('/api/stats/dashboard', async (request) => {
    const query = request.query as { now?: string }
    const now = query.now ? new Date(query.now) : new Date()
    return ok(dashboard(db, Number.isNaN(now.getTime()) ? new Date() : now))
  })

  /** 版本胜率：哪一版简历更容易过筛。样本 < 3 的返回 rate=null（不下结论） */
  app.get('/api/stats/resume-performance', async () => ok(resumePerformance(db)))
}
