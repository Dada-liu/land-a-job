/**
 * 岗位类型识别（抓取时筛选用）。
 *
 * 只用标题与公司名的关键词判断——BOSS 的列表接口没有"类型"字段，
 * 这里也不猜。规则刻意保守：拿不准就归到「社招」，宁可多抓一条，
 * 也不要把一条正经岗位静默丢掉。
 */

export type JobCategory = 'intern' | 'campus' | 'experienced' | 'outsourced'

export const JOB_CATEGORIES: readonly JobCategory[] = ['experienced', 'campus', 'intern', 'outsourced']

export const CATEGORY_LABELS: Record<JobCategory, string> = {
  experienced: '社招',
  campus: '校招',
  intern: '实习',
  outsourced: '外包',
}

/** 标题里的强信号 */
const TITLE_RULES: { id: JobCategory; re: RegExp }[] = [
  { id: 'intern', re: /实习|intern/i },
  { id: 'campus', re: /校招|校园|应届|毕业生|\d{2,4}\s*届/ },
  { id: 'outsourced', re: /外包|驻场|外派|派遣|项目顾问|人力服务/ },
]

/**
 * 公司名的弱信号：这些是人力/驻场外包服务商，岗位挂在甲方名下招。
 * 只放"确定是外包"的几家；有争议的（东软、神州数码等有自己的产品线）不放。
 */
const BRAND_RULES: { id: JobCategory; re: RegExp }[] = [
  { id: 'outsourced', re: /中软国际|博彦科技|软通动力|外企德科|亿达信息|人瑞|文思海辉|柯莱特|中电金信/ },
]

/** 返回命中的类型；一个都没命中＝社招 */
export function classifyJob(jobName: string, brandName = ''): JobCategory[] {
  const title = jobName ?? ''
  const brand = brandName ?? ''
  const hits = new Set<JobCategory>()

  for (const rule of TITLE_RULES) if (rule.re.test(title)) hits.add(rule.id)
  for (const rule of BRAND_RULES) if (rule.re.test(brand)) hits.add(rule.id)

  if (hits.size === 0) hits.add('experienced')
  /** 实习岗也常带"校招"字样，社招标签只留给真正没命中的 */
  return JOB_CATEGORIES.filter((id) => hits.has(id))
}

/** 是否属于允许保留的类型；`allowed` 为空视为不筛选 */
export function keepByCategory(jobName: string, brandName: string, allowed?: JobCategory[]): boolean {
  if (!allowed || allowed.length === 0) return true
  const cats = classifyJob(jobName, brandName)
  return cats.some((c) => allowed.includes(c))
}

/** 给日志和 UI 用的一句话说明 */
export function describeCategories(jobName: string, brandName = ''): string {
  return classifyJob(jobName, brandName).map((c) => CATEGORY_LABELS[c]).join('+')
}
