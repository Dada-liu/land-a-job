import { z } from 'zod'
import { CHANNELS } from '../application.js'
import { patchOf, zId, zIso, zMoney, zOptText, zPriority, zText, zUrl } from './common.js'

export const JOB_STATUSES = ['open', 'paused', 'closed'] as const
export const FIT_SOURCES = ['rule', 'agent', 'user'] as const

const jobFields = {
  companyId: zId,
  title: zText(120),
  jdUrl: zUrl.nullish(),
  channel: z.enum(CHANNELS),
  city: zOptText(40),
  salaryMin: zMoney.nullish(),
  salaryMax: zMoney.nullish(),
  level: zOptText(40),
  keywords: z.array(z.string().trim().min(1).max(40)).max(40).nullish(),
  status: z.enum(JOB_STATUSES),
  priority: zPriority,
  notes: zOptText(4000),
  /** 正文可能很长（整份 JD），上限放宽到 200k 字符，够存一份大厂 JD */
  jdText: z.string().max(200_000).nullish(),
  jdSnapshot: zOptText(2048),
  /** 采集来源：官方 ATS / http / browser / paste；NULL = 重构前的历史数据 */
  jdSource: zOptText(40),
}

const salaryOrder = (value: { salaryMin?: number | null; salaryMax?: number | null }) =>
  value.salaryMin == null || value.salaryMax == null || value.salaryMax >= value.salaryMin

export const zJobCreate = z
  .object({
    ...jobFields,
    channel: z.enum(CHANNELS).default('official'),
    status: z.enum(JOB_STATUSES).default('open'),
    priority: zPriority.default(3),
  })
  .refine(salaryOrder, { message: 'salaryMax 不能小于 salaryMin', path: ['salaryMax'] })

export const zJobPatch = patchOf({
  ...jobFields,
  fitScore: z.number().int().min(0).max(100).nullish(),
  fitReasons: z.array(z.string().max(300)).max(20).nullish(),
  fitSource: z.enum(FIT_SOURCES),
  expectedUpdatedAt: zIso.optional(),
}).refine(salaryOrder, { message: 'salaryMax 不能小于 salaryMin', path: ['salaryMax'] })

export type JobCreate = z.infer<typeof zJobCreate>
export type JobPatch = z.infer<typeof zJobPatch>

export interface JobDto {
  id: string
  companyId: string
  title: string
  jdText: string | null
  jdUrl: string | null
  jdSnapshot: string | null
  jdSource: string | null
  channel: string
  city: string | null
  salaryMin: number | null
  salaryMax: number | null
  level: string | null
  keywords: string[] | null
  fitScore: number | null
  fitReasons: string[] | null
  fitSource: string
  status: string
  priority: number
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** 列表视图不返回 jdText，避免一次拉 20 份 JD 把响应撑到几 MB */
export type JobSummaryDto = Omit<JobDto, 'jdText' | 'jdSnapshot'> & {
  companyName?: string
  applicationId?: string | null
}

export const zJobId = z.object({ id: zId })
