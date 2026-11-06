import type { FastifyInstance } from 'fastify'
import path from 'node:path'
import { z } from 'zod'
import { zId, zUrl } from '@land/core'
import { DATA_DIR } from '../config.js'
import { getCompany } from '../db/repositories/company.js'
import { getJob } from '../db/repositories/job.js'
import { appendNote, createApplication, listApplications, updateApplication } from '../db/repositories/application.js'
import { AppError, ConflictError } from '../errors.js'
import { ok } from '../reply.js'
import { demoFormHtml } from '../apply/demo.js'
import {
  closeSession,
  currentSession,
  fillSession,
  getSession,
  openSession,
  reInspect,
  submitSession,
} from '../apply/session.js'
import type { RouteDeps } from './index.js'

const idParams = z.object({ id: zId })

/**
 * 投递助手路由（P4）。
 *
 * 所有写操作都返回「当前会话快照」，让页面只靠一次响应就能重绘：
 * 字段列表、手动字段、拦截原因、逐字段填充结果都在里面。
 */
export function registerApplyRoutes(app: FastifyInstance, { db, ws }: RouteDeps): void {
  /**
   * 演示表单：不挂 /api 前缀，所以不需要令牌（它就是给浏览器直接打开的页面）。
   * 真实投递前的最后一步验证都在这里跑，避免拿真实公司官网当测试场。
   */
  app.get('/apply-demo', async (request, reply) => {
    const query = request.query as { captcha?: string; title?: string }
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(demoFormHtml({ captcha: query.captcha === '1', title: query.title }))
  })

  app.get('/api/apply/sessions/current', async () => ok({ session: currentSession() }))

  app.post('/api/apply/sessions', async (request, reply) => {
    const input = z
      .object({
        jobId: zId,
        resumeId: zId.nullish(),
        /** 允许显式指定起始地址（演示页、内推链接），否则回落到岗位 > 公司的投递入口 */
        url: zUrl.optional(),
        /** 自动化测试与无人值守场景用；正常使用应当有头，方便人工登录 */
        headless: z.boolean().optional(),
      })
      .parse(request.body)

    const job = getJob(db, input.jobId)
    const company = getCompany(db, job.companyId)
    const url = input.url ?? job.jdUrl ?? company.applyEntry
    if (!url) {
      throw new AppError('APPLY_URL_MISSING', '该岗位没有 JD 链接，公司也没有投递入口；先补一个链接再来', 400)
    }

    const session = await openSession({
      jobId: input.jobId,
      resumeId: input.resumeId ?? null,
      url,
      headless: input.headless,
    })
    return reply.code(201).send(ok(session))
  })

  app.get('/api/apply/sessions/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(getSession(id))
  })

  /** 多步表单 / 登录之后重新扫描字段 */
  app.post('/api/apply/sessions/:id/inspect', async (request) => {
    const { id } = idParams.parse(request.params)
    return ok(await reInspect(id))
  })

  app.post('/api/apply/sessions/:id/fill', async (request) => {
    const { id } = idParams.parse(request.params)
    const { values } = z.object({ values: z.record(z.string(), z.string()) }).parse(request.body)
    return ok(await fillSession(id, values))
  })

  /**
   * 提交：必须 confirm:true。
   * 成功后自动登记投递（已存在活跃投递则补证据），并把截图路径写进 evidence。
   */
  app.post('/api/apply/sessions/:id/submit', async (request) => {
    const { id } = idParams.parse(request.params)
    // channel 由「直接投递」弹窗传入；旧调用（MCP、API 测试）不带，沿用 official
    const { confirm, channel } = z
      .object({ confirm: z.boolean().default(false), channel: z.string().optional() })
      .parse(request.body ?? {})

    const result = await submitSession(id, confirm)
    const evidence = {
      screenshot: result.screenshotPath ? path.relative(DATA_DIR, result.screenshotPath) : null,
      finalUrl: result.finalUrl,
      buttonText: result.buttonText,
      emptyRequired: result.emptyRequired,
      at: new Date().toISOString(),
    }

    // 只看活跃投递：已结束的那条不该被本次提交「顺带复活」
    const existing = listApplications(db, { limit: 1, jobId: result.session.jobId, activeOnly: true }).items[0]
    let application
    if (existing) {
      application = updateApplication(db, existing.id, {
        evidence,
        appliedAt: existing.appliedAt ?? new Date().toISOString(),
        resumeId: existing.resumeId ?? result.session.resumeId ?? undefined,
      })
    } else {
      try {
        application = createApplication(db, {
          jobId: result.session.jobId,
          resumeId: result.session.resumeId,
          status: 'applied',
          appliedAt: new Date().toISOString(),
          channel: channel ?? 'official',
          confidence: 'screenshot',
          actor: 'user',
          source: 'web',
          evidence,
        })
      } catch (error) {
        // 并发下可能刚好被别人插入，转成可读冲突而不是 500
        if (error instanceof ConflictError) {
          throw new AppError('APPLICATION_EXISTS', '该岗位已有进行中的投递，未重复登记；可在看板里补证据', 409, error.details)
        }
        throw error
      }
    }

    /**
     * 无论新登记还是补证据，都在时间线留一条人话备注。
     * 证据路径只在 evidence 字段里，看板上不显示；事后回看「这版是谁用什么方式投的」全靠这条。
     */
    appendNote(db, application.id, {
      note: `投递助手已提交（${
        evidence.screenshot ? `证据：${evidence.screenshot}` : '未截到图'
      }）${result.emptyRequired.length > 0 ? `；仍有必填未填：${result.emptyRequired.join('、')}` : ''}`,
      actor: 'user',
      source: 'web',
    })

    ws.invalidate(['applications', 'stats', 'jobs'])
    return ok({ ...result, application })
  })

  app.delete('/api/apply/sessions/:id', async (request) => {
    const { id } = idParams.parse(request.params)
    await closeSession(id)
    return ok({ id, closed: true })
  })
}
