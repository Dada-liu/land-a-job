import { z } from 'zod'
import { ACTORS, CHANNELS, CONFIDENCES, SOURCES, STATUSES } from '../application.js'
import { patchOf, zId, zIso } from './common.js'

const baseApplication = {
  jobId: zId,
  resumeId: zId.nullish(),
  status: z.enum(STATUSES).default('queued'),
  channel: z.enum(CHANNELS).default('official'),
  appliedAt: zIso.nullish(),
  contact: z.string().trim().max(200).nullish(),
  nextActionAt: zIso.nullish(),
  confidence: z.enum(CONFIDENCES).default('reported'),
  notes: z.string().max(8000).nullish(),
  actor: z.enum(ACTORS).default('user'),
  source: z.enum(SOURCES).default('web'),
}

export const zApplicationCreate = z
  .object(baseApplication)
  // 状态已经是「已投」及以后，必须有投递时间，否则后续跟进规则算不出天数
  .refine((v) => !['applied', 'screening', 'assessment', 'interview', 'offer'].includes(v.status) || !!v.appliedAt, {
    message: '状态为已投递之后必须提供 appliedAt',
    path: ['appliedAt'],
  })

const applicationPatchFields = {
  resumeId: zId.nullish(),
  channel: z.enum(CHANNELS),
  appliedAt: zIso.nullish(),
  contact: z.string().trim().max(200).nullish(),
  nextActionAt: zIso.nullish(),
  confidence: z.enum(CONFIDENCES),
  /** 投递助手提交后会补上截图路径与最终 URL；人工编辑也可以清空 */
  evidence: z.record(z.string(), z.unknown()).nullish(),
  notes: z.string().max(8000).nullish(),
  expectedUpdatedAt: zIso,
  actor: z.enum(ACTORS),
  source: z.enum(SOURCES),
}

/** 注意：PATCH 不接受 status —— 改状态必须走 /status 端点，否则事件不会写入 */
export const zApplicationPatch = patchOf(applicationPatchFields)

export const zStatusChange = z.object({
  to: z.enum(STATUSES),
  note: z.string().trim().max(2000).optional(),
  /** 人工修正误标时置 true；服务端会把 forced 与 reason 一起写进事件 */
  force: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
  appliedAt: zIso.optional(),
  actor: z.enum(ACTORS).default('user'),
  source: z.enum(SOURCES).default('web'),
})

export const zNoteAppend = z.object({
  note: z.string().trim().min(1).max(4000),
  actor: z.enum(ACTORS).default('user'),
  source: z.enum(SOURCES).default('web'),
})

export type ApplicationCreate = z.infer<typeof zApplicationCreate>
export type ApplicationPatch = z.infer<typeof zApplicationPatch>
export type StatusChange = z.infer<typeof zStatusChange>

export interface ApplicationDto {
  id: string
  jobId: string
  resumeId: string | null
  status: string
  channel: string
  appliedAt: string | null
  statusAt: string
  contact: string | null
  nextActionAt: string | null
  evidence: unknown
  confidence: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface ApplicationListItemDto extends ApplicationDto {
  jobTitle?: string
  companyName?: string
  companyId?: string
  /** 派生字段：距上次状态变更天数，看板直接拿来标「需跟进」 */
  daysInStatus?: number
  nextStatuses?: string[]
}

export interface ApplicationEventDto {
  id: string
  applicationId: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  payload: unknown
  actor: string
  source: string
  at: string
}

export const zApplicationId = z.object({ id: zId })
