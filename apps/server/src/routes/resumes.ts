import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  RESUME_KINDS,
  zId,
  zListQuery,
  zResumeCreate,
  zResumeDuplicate,
  zResumePatch,
} from '@land/core'
import { FILES_DIR } from '../config.js'
import {
  createResume,
  deleteResume,
  duplicateResume,
  getResume,
  listResumes,
  updateResume,
} from '../db/repositories/resume.js'
import { ok, paginated } from '../reply.js'
import { acceptProvenance } from '../provenance.js'
import { exportResumePdfHeadless } from '../resume/export.js'
import type { RouteDeps } from './index.js'

const listQuery = zListQuery.extend({
  jobId: zId.optional(),
  kind: z.enum(RESUME_KINDS).optional(),
})

const exportQuery = z.object({
  download: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})

export function registerResumeRoutes(app: FastifyInstance, { db, ws, port }: RouteDeps): void {
  app.get('/api/resumes', async (request) => {
    const query = listQuery.parse(request.query)
    const page = listResumes(db, query)
    return paginated(page.items, query.limit, page.nextCursor)
  })

  app.get('/api/resumes/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    return ok(getResume(db, id))
  })

  app.post('/api/resumes', async (request, reply) => {
    const input = zResumeCreate.parse(request.body)
    const resume = createResume(db, { ...input, provenance: acceptProvenance(input.provenance) })
    ws.invalidate(['resumes', 'stats'])
    return reply.code(201).send(ok(resume))
  })

  app.patch('/api/resumes/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const patch = zResumePatch.parse(request.body)
    const resume = updateResume(db, id, {
      ...patch,
      ...(patch.provenance === undefined ? {} : { provenance: acceptProvenance(patch.provenance) }),
    })
    ws.invalidate(['resumes', `resume:${id}`])
    return ok(resume)
  })

  app.post('/api/resumes/:id/duplicate', async (request, reply) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const input = zResumeDuplicate.parse(request.body ?? {})
    const resume = duplicateResume(db, id, input)
    ws.invalidate(['resumes', 'stats'])
    return reply.code(201).send(ok(resume))
  })

  /**
   * 无头导出 PDF：页面没开也能导（Agent/MCP 用得上）。
   * 默认返回落盘路径；带 ?download=1 时直接把文件流回浏览器。
   */
  app.post('/api/resumes/:id/export', async (request, reply) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    const { download } = exportQuery.parse(request.query ?? {})
    const resume = getResume(db, id)
    const result = await exportResumePdfHeadless({
      resumeId: id,
      resumeTitle: resume.title,
      data: (resume.data ?? {}) as { personalInfo?: { name?: string; jobTitle?: string } },
      port,
      filesDir: FILES_DIR,
    })

    if (!download) return ok(result)

    reply.header('content-type', 'application/pdf')
    reply.header(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(result.filePath))}`,
    )
    return reply.send(createReadStream(result.filePath))
  })

  app.delete('/api/resumes/:id', async (request) => {
    const { id } = z.object({ id: zId }).parse(request.params)
    deleteResume(db, id)
    ws.invalidate(['resumes', 'stats'])
    return ok({ id, deleted: true })
  })
}
