import { z } from 'zod'
import { patchOf, zId, zIso, zListQuery, zOptText, zPriority, zText, zUrl } from './common.js'

export const COMPANY_SIZES = ['<100', '100-499', '500-1999', '2000-9999', '10000+'] as const

/** 字段定义不带默认值：默认值只在 create 里给，否则 PATCH {} 会静默改回默认值 */
const companyFields = {
  name: zText(120),
  website: zUrl.nullish(),
  industry: zOptText(80),
  size: z.enum(COMPANY_SIZES).nullish(),
  city: zOptText(40),
  priority: zPriority,
  /** 官网投递入口，投递助手（P4）直接从这里起浏览 */
  applyEntry: zUrl.nullish(),
  notes: zOptText(4000),
}

export const zCompanyCreate = z.object({
  ...companyFields,
  priority: zPriority.default(3),
})

export const zCompanyPatch = patchOf({
  ...companyFields,
  expectedUpdatedAt: zIso.optional(),
})

export const zCompanyListQuery = zListQuery.extend({
  priority: z.coerce.number().int().min(1).max(5).optional(),
})

export type CompanyCreate = z.infer<typeof zCompanyCreate>
export type CompanyPatch = z.infer<typeof zCompanyPatch>

export interface CompanyDto {
  id: string
  name: string
  website: string | null
  industry: string | null
  size: string | null
  city: string | null
  priority: number
  applyEntry: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** 未删除岗位数，列表页直接展示，省一次请求 */
  jobCount?: number
}

export const zCompanyId = z.object({ id: zId })
