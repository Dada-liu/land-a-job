/**
 * 本周有效投递目标（北极星的分母）。
 *
 * 为什么是一个可以改的数、而不是写死的 8：8 是 PRD 里「认真投」的下限，
 * 但在职跳槽一周投 3 份、全职找工作一周投 20 份都合理。目标只影响进度条分母
 * 与提示文案，不改任何统计口径——真正算「有效投递」的仍是那三条规则
 * （本周已投 + 绑定简历 + 匹配度 ≥ 60）。
 */
export const DEFAULT_WEEKLY_TARGET = 8

/** 0 会让进度条除以零；三位数以上基本是记错了单位（比如把月目标填进来） */
export const WEEKLY_TARGET_MIN = 1
export const WEEKLY_TARGET_MAX = 100

/**
 * 把任意来源的数字收敛到合法区间。
 *
 * settings 表是 key/value 文本，人可以手改、导出的 JSON 也可以直接搬回来，
 * 所以读到 `"0"`、空串或超范围时既不能让页面崩，也不能把进度条算成 Infinity。
 */
export function clampWeeklyTarget(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return DEFAULT_WEEKLY_TARGET
  return Math.min(WEEKLY_TARGET_MAX, Math.max(WEEKLY_TARGET_MIN, Math.round(value)))
}
