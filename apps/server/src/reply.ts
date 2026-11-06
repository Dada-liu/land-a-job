import type { ListMeta } from '@land/core'

/**
 * 统一成功信封（ARCHITECTURE 6.1）：`{ data }`，列表额外带 `meta`。
 *
 * 为什么要包一层：Agent 侧拿到任何响应都能先看 data/error 二选一，
 * 不必按端点猜「这个接口返回的是数组还是对象」。
 */
export interface Envelope<T> {
  data: T
  meta?: ListMeta
}

export function ok<T>(data: T, meta?: ListMeta): Envelope<T> {
  return meta ? { data, meta } : { data }
}

export function paginated<T>(items: T[], limit: number, nextCursor: string | null): Envelope<T[]> {
  return { data: items, meta: { limit, nextCursor } }
}
