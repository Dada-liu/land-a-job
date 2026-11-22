/**
 * 薪资来源的中文短标签。
 *
 * 同一个数字可能是三条路来的：招聘平台列表卡片（最贴近岗位本身）、JD 正文
 * （常是"能给的范围"甚至别家的数字）、人工填写。列出来是为了让人一眼判断
 * 这个价格要不要信，而不是只看数字。
 */
const LABELS: Record<string, string> = {
  listing: '列表薪资',
  jd: 'JD 抽取',
  manual: '手动填写',
}

/** 列表里只在有来源时显示，避免历史数据挂一排"来源未记录" */
export function salarySourceLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return LABELS[value] ?? value
}

/** 标题下面那行用短标签，四个字段并排时不至于挤成一团 */
const SHORT: Record<string, string> = {
  listing: '列表',
  jd: 'JD',
  manual: '手填',
}

export function salarySourceShort(value: string | null | undefined): string | null {
  if (!value) return null
  return SHORT[value] ?? LABELS[value] ?? value
}

/** 详情页要完整：没有来源也说明一下，免得让人以为是漏填 */
export function salarySourceLabelOrUnknown(value: string | null | undefined): string {
  return salarySourceLabel(value) ?? '来源未记录'
}
