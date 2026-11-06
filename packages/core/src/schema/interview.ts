import { z } from 'zod'
import { patchOf, zId, zIso, zListQuery } from './common.js'

export const INTERVIEW_KINDS = ['phone', 'tech', 'manager', 'hr', 'cross', 'final'] as const
export const INTERVIEW_FORMATS = ['onsite', 'video', 'phone'] as const
export const PREP_STATUSES = ['none', 'planned', 'ready', 'done'] as const
export const INTERVIEW_RESULTS = ['pending', 'passed', 'failed', 'cancelled'] as const

const interviewFields = {
  round: z.number().int().min(1).max(20),
  kind: z.enum(INTERVIEW_KINDS),
  scheduledAt: zIso.nullish(),
  durationMin: z.number().int().min(5).max(600).nullish(),
  format: z.enum(INTERVIEW_FORMATS).nullish(),
  interviewer: z.string().trim().max(200).nullish(),
  location: z.string().trim().max(500).nullish(),
  prepStatus: z.enum(PREP_STATUSES),
  feedback: z.string().max(8000).nullish(),
  selfRating: z.number().int().min(1).max(5).nullish(),
  result: z.enum(INTERVIEW_RESULTS),
  notes: z.string().max(8000).nullish(),
}

export const zInterviewCreate = z.object({
  applicationId: zId,
  ...interviewFields,
  round: interviewFields.round.default(1),
  kind: interviewFields.kind.default('tech'),
  prepStatus: interviewFields.prepStatus.default('none'),
  result: interviewFields.result.default('pending'),
})

/** applicationId 不可改：换投递等于换一场面试，应该删了重加 */
export const zInterviewPatch = patchOf(interviewFields)

export type InterviewCreate = z.infer<typeof zInterviewCreate>
export type InterviewPatch = z.infer<typeof zInterviewPatch>

export interface InterviewDto {
  id: string
  applicationId: string
  round: number
  kind: string
  scheduledAt: string | null
  durationMin: number | null
  format: string | null
  interviewer: string | null
  location: string | null
  prepStatus: string
  feedback: string | null
  selfRating: number | null
  result: string
  notes: string | null
  createdAt: string
  updatedAt: string
}

export const zInterviewQuery = zListQuery.extend({
  applicationId: zId.optional(),
  /** 只要未来的（面试日历 / 今日待办用） */
  upcoming: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
})
