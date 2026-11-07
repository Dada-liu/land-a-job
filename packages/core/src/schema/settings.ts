import { z } from 'zod'
import { WEEKLY_TARGET_MAX, WEEKLY_TARGET_MIN } from '../settings.js'
import { patchOf } from './common.js'

/**
 * 本机偏好：与 settings 表的 key 一一对应（目前只有 weeklyTarget）。
 *
 * 字段不带 `.default()`：`patchOf()` 用 `.partial()` 生成 PATCH schema，
 * 带默认值的话，空 body 会把目标悄悄打回 8。
 */
export const zSettingsPatch = patchOf({
  weeklyTarget: z.number().int().min(WEEKLY_TARGET_MIN).max(WEEKLY_TARGET_MAX),
})

export type SettingsPatch = z.infer<typeof zSettingsPatch>
