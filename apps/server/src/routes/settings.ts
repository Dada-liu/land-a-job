import type { FastifyInstance } from 'fastify'
import { zSettingsPatch } from '@land/core'
import { readSettings, writeSettings } from '../db/repositories/settings.js'
import { ok } from '../reply.js'
import type { RouteDeps } from './index.js'

/**
 * 本机偏好（P7 之后新增）。
 *
 * 与 `/api/data/*` 的分工：那边是「整库的备份与迁移」，这边是「界面上的开关与阈值」。
 * 走 `/api/settings` 而不是塞进 `/api/stats` 的写接口：stats 的 GET 是纯读、可放心轮询，
 * 把写混进去会让人以为这个接口有副作用。
 */
export function registerSettingsRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  app.get('/api/settings', async () => ok(readSettings(db)))

  /**
   * 改偏好。目前只有 `weeklyTarget`，PATCH 的语义是「只改传了的字段」。
   * 改完广播 `stats`：北极星的分母变了，别的窗口开着的总览页要立刻重取。
   */
  app.patch('/api/settings', async (request) => {
    const patch = zSettingsPatch.parse(request.body)
    const settings = writeSettings(db, patch)
    ws.invalidate(['stats'])
    return ok(settings)
  })
}
