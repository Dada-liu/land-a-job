import type { FastifyError, FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import { InvalidTransitionError } from '@land/core'

/**
 * 统一错误形状：{ error: { code, message, details? } }
 * code 用大写下划线，便于 Agent 侧据此自我纠正（如 INVALID_TRANSITION）。
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} 不存在：${id}`, 404)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, 409, details)
  }
}

/** 乐观锁冲突：前端应提示「已被其他会话修改」并刷新，而不是直接覆盖 */
export class VersionConflictError extends AppError {
  constructor(entity: string, id: string) {
    super('VERSION_CONFLICT', `${entity} 已被其他会话修改（${id}），请刷新后重试`, 409)
  }
}

function zodMessage(error: ZodError): string {
  const first = error.issues[0]
  if (!first) return '请求参数不合法'
  const path = first.path.join('.')
  return path ? `${path}: ${first.message}` : first.message
}

/** 把 SQLite 的唯一约束报错翻译成人能看懂的话，而不是把 SQL 原文甩给用户 */
const UNIQUE_HINTS: Record<string, string> = {
  'company.name': '同名公司已存在',
  'offer.application_id': '该投递已有 offer 记录，请直接修改',
  'application.job_id': '该岗位已有进行中的投递',
}

function uniqueViolation(error: unknown): { target: string; message: string } | null {
  if (!(error instanceof Error)) return null
  const match = /UNIQUE constraint failed: ([^\s)]+)/i.exec(error.message)
  if (!match?.[1]) return null
  const target = match[1]
  return { target, message: UNIQUE_HINTS[target] ?? `记录已存在（${target}）` }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // Fastify 5 把 error 声明为 unknown，这里统一收敛成可读形状
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      })
    }

    // 状态机拒绝：不是「参数错了」而是「当前状态不允许」，用 409 更贴近语义
    if (error instanceof InvalidTransitionError) {
      return reply.code(409).send({
        error: {
          code: 'INVALID_TRANSITION',
          message: error.message,
          details: { from: error.from, to: error.to, allowed: [...error.allowed] },
        },
      })
    }

    // 校验失败：把第一条问题带到 message，details 保留完整 issues 供 Agent 精确修参数
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          message: zodMessage(error),
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        },
      })
    }

    const err = error as FastifyError

    // 唯一约束兜底：路由里通常已先查再写并给出更具体的 409，
    // 这里负责「并发下两条请求同时通过检查」的漏网情况。
    const conflict = uniqueViolation(err)
    if (conflict) {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: conflict.message, details: { target: conflict.target } },
      })
    }

    if (err.validation) {
      return reply.code(400).send({
        error: { code: 'VALIDATION_FAILED', message: err.message, details: err.validation },
      })
    }

    const statusCode = err.statusCode ?? 500
    if (statusCode < 500) {
      return reply.code(statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message } })
    }

    request.log.error({ err }, '未处理的服务端错误')
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: '服务内部错误，详情见 data/logs/server.log' },
    })
  })
}
