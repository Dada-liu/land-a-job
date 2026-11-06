import { z } from 'zod'

/** 主键：uuid，测试里也允许短标识，所以只约束长度与空串 */
export const zId = z.string().trim().min(1).max(64)

/**
 * ISO8601 时间。不用 z.iso.datetime()，因为要接受带偏移与不带毫秒的写法
 * （用户手填、Agent 生成、导入旧数据三种来源格式不一致）。
 */
export const zIso = z
  .string()
  .trim()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), '需要 ISO8601 时间，例如 2026-11-04T09:00:00.000Z')

export const zNullableIso = zIso.nullable()

/** 短文本字段：统一 trim + 长度上限，避免误把整份 JD 塞进公司名 */
export const zText = (max = 200) => z.string().trim().min(1).max(max)
export const zOptText = (max = 200) => z.string().trim().max(max).nullish()

/** 1 最高、5 最低，与看板排序方向一致 */
export const zPriority = z.number().int().min(1).max(5)

export const zUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), '需要 http(s) 链接')

/** 金额一律用「元/月」整数，避免浮点在总包模型里累积误差 */
export const zMoney = z.number().int().min(0).max(100_000_000)

export const zRatio = z.number().min(0).max(1)

/** 列表查询参数。limit 有上限，防止一次拉全库把看板拖死 */
export const zListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).optional(),
  q: z.string().trim().max(100).optional(),
})

export type ListQuery = z.infer<typeof zListQuery>

/** 乐观锁：PATCH 带上读到的 updatedAt，不一致说明有人先改了 */
export const zExpectedUpdatedAt = zIso.optional()

/**
 * 不构成「实质修改」的字段：只带这些字段的 PATCH 应当被拒绝。
 * provenance 也算：它只说明「谁写的」，不改变任何内容，单独提交说明 Agent 没真改东西。
 */
const NON_CHANGE_KEYS = ['expectedUpdatedAt', 'actor', 'source', 'provenance']

/**
 * 生成 PATCH schema。
 *
 * 关键点：传入的 shape 里不能有 .default()。否则 z.object(shape).partial() 在空对象上
 * 仍会补出默认值，导致「PATCH {} 把 priority 改回 3」这类静默数据损坏。
 * 所以每个实体的字段定义都不带默认值，默认值只在 create schema 里覆盖。
 */
export function patchOf<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .refine(
      (value) => Object.keys(value).some((key) => !NON_CHANGE_KEYS.includes(key)),
      '至少提供一个要修改的字段',
    )
}

/** 分页结果的信封元信息，与 ARCHITECTURE 6.1 一致 */
export interface ListMeta {
  limit: number
  nextCursor: string | null
  total?: number
}
