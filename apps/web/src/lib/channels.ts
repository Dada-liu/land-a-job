/** 投递渠道：两个「进入待投」弹窗与「直接投递」弹窗共用同一份取值，别各自硬编码 */
export const CHANNEL_OPTIONS = [
  { value: 'official', label: '官网' },
  { value: 'referral', label: '内推' },
  { value: 'platform', label: '招聘平台' },
  { value: 'other', label: '其他' },
]

/** 岗位里可能存着历史/自定义渠道，落到下拉里必须是可选项之一 */
export function normalizeChannel(value: string | undefined): string {
  return CHANNEL_OPTIONS.some((item) => item.value === value) ? (value ?? 'official') : 'official'
}
