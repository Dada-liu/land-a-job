import { z } from 'zod'
import { RESUME_TEMPLATES } from '../resume-templates.js'
import { zProvenance } from '../skills.js'
import { patchOf, zId, zIso } from './common.js'

export const RESUME_KINDS = ['master', 'variant'] as const

/**
 * 模板 id 的唯一来源是 core/resume-templates.ts（它同时也给 Web 列表页取名字）。
 * catalog.json 里的 id 必须与之一致，由 apps/server/test/template-catalog.test.ts 守住。
 */
export { RESUME_TEMPLATES }

/**
 * 简历正文结构由 resume-kit（P2）定义并演进，这里不做字段级约束——
 * 否则每加一个模块字段就要改 core 并重启，反而拖慢编辑器迭代。
 * 只保证它是对象、且整体大小有上限。
 */
const zResumeData = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 500_000, '简历内容过大（>500KB）')

export const zResumeCreate = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(RESUME_KINDS).default('master'),
  templateId: z.enum(RESUME_TEMPLATES).default('classic'),
  /**
   * 允许不带正文：Web 上「填个名字 → 创建 → 进编辑器」是正常动线，
   * 空简历交给编辑器里的 normalizeResumeData 补默认结构。
   * 以前这里是必填，前端只传 title/templateId 就会撞上
   * 「data: Invalid input: expected record, received undefined」。
   */
  data: zResumeData.default({}),
  /** 定制版本的来源母版，用于算「哪版简历带来面试」 */
  baseResumeId: zId.nullish(),
  jobId: zId.nullish(),
  isDefault: z.boolean().default(false),
  /** AI 生成时必填：skill 名 + 版本 + 模型，人工编辑留空。skill 名必须在 SKILL_REGISTRY 内 */
  provenance: zProvenance.nullish(),
})

export const zResumePatch = patchOf({
  title: z.string().trim().min(1).max(120),
  templateId: z.enum(RESUME_TEMPLATES),
  data: zResumeData,
  jobId: zId.nullish(),
  isDefault: z.boolean(),
  provenance: zProvenance.nullish(),
  expectedUpdatedAt: zIso.optional(),
})

export const zResumeDuplicate = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  jobId: zId.nullish(),
})

export type ResumeCreate = z.infer<typeof zResumeCreate>
export type ResumePatch = z.infer<typeof zResumePatch>

export interface ResumeDto {
  id: string
  title: string
  kind: string
  templateId: string
  data: unknown
  baseResumeId: string | null
  jobId: string | null
  isDefault: boolean
  provenance: unknown
  createdAt: string
  updatedAt: string
}

export const zResumeId = z.object({ id: zId })
