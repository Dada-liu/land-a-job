/**
 * 简历差异（P7-11）。
 *
 * 用来回答一个很具体的问题：「这版是 AI 按 JD 改的，那它到底改了哪儿？」
 * 不做富文本 diff、不算相似度——只逐字段比对，把「路径 + 前后值」摊开，
 * 让人一眼看出是「摘要重写」还是「整段经历被动了」。
 *
 * 三个刻意的取舍：
 * 1. 只报**叶子字段**的变化，不报「projects 数组变了」这种笼统结论；
 * 2. 数组按下标对齐（简历条目顺序本身就是内容的一部分）；
 * 3. 输出上限 `max`，超出的只给条数——差异面板不该变成第二个编辑器。
 */

export interface DiffEntry {
  /** 人类可读路径，如 projects[1].description */
  path: string
  before: string
  after: string
}

export interface DiffResult {
  entries: DiffEntry[]
  /** 被截断的条数 */
  truncated: number
  /** 有差异的顶层区块，用于一句话总结 */
  sections: string[]
}

const SECTION_LABELS: Record<string, string> = {
  personalInfo: '基本信息',
  educations: '教育',
  skills: '技能',
  projects: '项目',
  experiences: '经历',
  awards: '荣誉',
  selfIntro: '自我介绍',
}

const MAX_TEXT = 220

function show(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    // 技能这类「字符串数组」的变化，直接列出来比说「数组变了」有用
    const simple = value.every((item) => typeof item === 'string')
    if (simple) return (value as string[]).join('、')
    return `${value.length} 项`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const label = record['name'] ?? record['company'] ?? record['school'] ?? record['title']
    if (typeof label === 'string' && label) return label
    return JSON.stringify(value).slice(0, MAX_TEXT)
  }
  return String(value)
}

export function diffResume(before: unknown, after: unknown, options: { max?: number } = {}): DiffResult {
  const max = options.max ?? 40
  const entries: DiffEntry[] = []
  const sections = new Set<string>()

  const walk = (left: unknown, right: unknown, path: string, section: string) => {
    if (entries.length >= max + 1) return

    const bothArray = Array.isArray(left) && Array.isArray(right)
    const bothObject = isPlainObject(left) && isPlainObject(right)

    if (bothArray) {
      const longest = Math.max(left.length, right.length)
      for (let index = 0; index < longest; index += 1) {
        const childPath = `${path}[${index}]`
        if (left[index] === undefined) {
          entries.push({ path: childPath, before: '', after: show(right[index]) })
          sections.add(section)
          continue
        }
        if (right[index] === undefined) {
          entries.push({ path: childPath, before: show(left[index]), after: '' })
          sections.add(section)
          continue
        }
        walk(left[index], right[index], childPath, section)
      }
      return
    }

    if (bothObject) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      for (const key of keys) {
        const childPath = path ? `${path}.${key}` : key
        // 顶层区块名本身就用来做总结，所以 section 只在第一层取
        walk(left[key], right[key], childPath, path ? section : key)
      }
      return
    }

    const beforeText = show(left)
    const afterText = show(right)
    if (beforeText !== afterText) {
      entries.push({ path, before: beforeText, after: afterText })
      sections.add(section)
    }
  }

  walk(before, after, '', 'other')

  const truncated = Math.max(0, entries.length - max)
  return {
    entries: entries.slice(0, max),
    truncated,
    sections: [...sections].map((key) => SECTION_LABELS[key] ?? key),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
