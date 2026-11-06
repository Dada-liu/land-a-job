import { z } from 'zod'
import { zProvenance } from '../skills.js'
import { patchOf, zId, zListQuery } from './common.js'

export const QUESTION_CATEGORIES = ['tech', 'project', 'behavior', 'risk', 'company', 'other'] as const
export const QUESTION_ORIGINS = ['generated', 'manual', 'imported'] as const

const questionFields = {
  interviewId: zId.nullish(),
  jobId: zId.nullish(),
  category: z.enum(QUESTION_CATEGORIES),
  question: z.string().trim().min(1).max(2000),
  intent: z.string().max(2000).nullish(),
  /** 关联的简历条目 / 岗位关键词，用于「这题考的是哪段经历」 */
  linkedItem: z.string().trim().max(200).nullish(),
  myAnswer: z.string().max(20_000).nullish(),
  score: z.record(z.string(), z.unknown()).nullish(),
  improvement: z.string().max(4000).nullish(),
  origin: z.enum(QUESTION_ORIGINS),
  /** AI 生成的题目必须留 provenance，Web 上要能筛「只看 AI 生成」 */
  provenance: zProvenance.nullish(),
}

export const zQuestionCreate = z.object({
  ...questionFields,
  category: questionFields.category.default('tech'),
  origin: questionFields.origin.default('manual'),
})

export const zQuestionPatch = patchOf(questionFields)

export type QuestionCreate = z.infer<typeof zQuestionCreate>
export type QuestionPatch = z.infer<typeof zQuestionPatch>

export interface QuestionDto {
  id: string
  interviewId: string | null
  jobId: string | null
  category: string
  question: string
  intent: string | null
  linkedItem: string | null
  myAnswer: string | null
  score: unknown
  improvement: string | null
  origin: string
  provenance: unknown
  createdAt: string
}

export const zQuestionQuery = zListQuery.extend({
  jobId: zId.optional(),
  interviewId: zId.optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
})
