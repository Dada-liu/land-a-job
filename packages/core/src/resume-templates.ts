/**
 * 简历模板的 id 与中文名：领域数据，放 core 而不是 UI 包。
 *
 * 三处都要读它：
 * - server：zod 枚举校验 templateId（写库前拦住拼错的模板 id）
 * - web 列表页：显示「现代简约 / 经典模板 / 传统表格」，不想为此加载整个编辑器
 * - resume-kit：catalog.json 里的 id 必须与这里一致（apps/server/test 有契约测试）
 *
 * 本文件刻意不 import zod：Web 端只想取几个字符串常量，不该把校验库拖进首屏。
 */
export const RESUME_TEMPLATES = ['classic', 'template-1', 'template-2'] as const

export type ResumeTemplateId = (typeof RESUME_TEMPLATES)[number]

export const RESUME_TEMPLATE_LABELS: Record<ResumeTemplateId, string> = {
  classic: '现代简约',
  'template-1': '经典模板',
  'template-2': '传统表格',
}

/** 一句话说明每个模板长什么样、适合投什么岗位（列表页选模板时要给人看的） */
export const RESUME_TEMPLATE_HINTS: Record<ResumeTemplateId, string> = {
  classic: '左侧浅灰侧栏放头像与联系方式，右侧主栏排经历，分栏清晰，适合互联网与设计类岗位',
  'template-1': '单栏通栏，顶部头像加横向联系方式，标题醒目、层次清楚，大多数岗位都能用',
  'template-2': '顶部信息表格，模块紧凑规整，适合国企和传统行业',
}

export const DEFAULT_RESUME_TEMPLATE: ResumeTemplateId = 'classic'

export function isResumeTemplateId(value: unknown): value is ResumeTemplateId {
  return typeof value === 'string' && (RESUME_TEMPLATES as readonly string[]).includes(value)
}

export function resumeTemplateLabel(id: string): string {
  return isResumeTemplateId(id) ? RESUME_TEMPLATE_LABELS[id] : id
}
