import type {
  Contact,
  Education,
  Experience,
  PersonalInfo,
  Project,
  ResumeData,
  Skill,
} from './types/resume'

/**
 * 简历数据的规范化与合并。
 *
 * 迁自源项目 mcp-server/src/resume.ts：这部分是纯函数、与 MCP 无关，
 * 但价值很高——AI 产出的 JSON 经常缺字段、用别名（summary/introduction）、
 * 把数组写成换行文本，这里统一收口成合法 ResumeData，避免坏数据直接进 UI。
 */

const newId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2, 10)}`

export const SECTION_KEYS = ['experiences', 'educations', 'skills', 'projects', 'contacts'] as const
export type SectionKey = (typeof SECTION_KEYS)[number]

export const SECTION_LABELS: Record<SectionKey, string> = {
  experiences: '工作经历',
  educations: '教育经历',
  skills: '专业技能',
  projects: '项目经历',
  contacts: '联系方式',
}

export function isSectionKey(value: string): value is SectionKey {
  return (SECTION_KEYS as readonly string[]).includes(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asOptionalString(value: unknown): string | undefined {
  const text = asString(value)
  return text ? text : undefined
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => asString(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((item) => item.replace(/^[-*•·]\s*/, '').trim())
      .filter(Boolean)
  }
  return []
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asId(value: unknown): string {
  const id = asString(value).trim()
  return id || newId()
}

export function createBlankResume(): ResumeData {
  return {
    personalInfo: { name: '', jobTitle: '', showAvatar: true, avatarShape: 'circle' },
    selfIntroduction: '',
    experiences: [],
    educations: [],
    skills: [],
    projects: [],
    contacts: [],
  }
}

function normalizePersonalInfo(input: unknown): PersonalInfo {
  const raw = asRecord(input)
  const info: PersonalInfo = { name: asString(raw.name), jobTitle: asString(raw.jobTitle) }
  const workYears = asOptionalString(raw.workYears)
  if (workYears) info.workYears = workYears
  const avatar = asOptionalString(raw.avatar)
  if (avatar) info.avatar = avatar
  if (typeof raw.showAvatar === 'boolean') info.showAvatar = raw.showAvatar
  if (raw.avatarShape === 'square' || raw.avatarShape === 'circle') info.avatarShape = raw.avatarShape
  return info
}

function normalizeExperience(input: unknown): Experience {
  const raw = asRecord(input)
  return {
    id: asId(raw.id),
    period: asString(raw.period),
    company: asString(raw.company),
    position: asString(raw.position),
    responsibilities: asStringArray(raw.responsibilities),
  }
}

function normalizeEducation(input: unknown): Education {
  const raw = asRecord(input)
  return {
    id: asId(raw.id),
    school: asString(raw.school),
    degree: asString(raw.degree),
    major: asString(raw.major),
    period: asString(raw.period),
  }
}

function normalizeSkill(input: unknown): Skill {
  const raw = asRecord(input)
  return { id: asId(raw.id), name: asString(raw.name), description: asString(raw.description) }
}

function normalizeProject(input: unknown): Project {
  const raw = asRecord(input)
  const project: Project = {
    id: asId(raw.id),
    name: asString(raw.name),
    description: asString(raw.description),
    details: asString(raw.details),
    technologies: asStringArray(raw.technologies),
  }
  const period = asOptionalString(raw.period)
  if (period) project.period = period
  const role = asOptionalString(raw.role)
  if (role) project.role = role
  const url = asOptionalString(raw.url)
  if (url) project.url = url
  return project
}

function normalizeContact(input: unknown): Contact {
  const raw = asRecord(input)
  // 兼容 { platform, value } 与常见的 { label, text } 两种写法
  const contact: Contact = {
    id: asId(raw.id),
    platform: asString(raw.platform) || asString(raw.label),
    value: asString(raw.value) || asString(raw.text),
  }
  const url = asOptionalString(raw.url)
  if (url) contact.url = url
  return contact
}

/** 把任意来源（Agent / JSON / Markdown / 旧项目）的数据整理成合法的 ResumeData */
export function normalizeResumeData(input: unknown): ResumeData {
  const raw = asRecord(input)
  return {
    personalInfo: normalizePersonalInfo(raw.personalInfo),
    selfIntroduction: asString(raw.selfIntroduction ?? raw.summary ?? raw.introduction),
    experiences: toArray(raw.experiences).map(normalizeExperience),
    educations: toArray(raw.educations ?? raw.education).map(normalizeEducation),
    skills: toArray(raw.skills).map(normalizeSkill),
    projects: toArray(raw.projects).map(normalizeProject),
    contacts: toArray(raw.contacts ?? raw.contact).map(normalizeContact),
  }
}

export function normalizeSectionItem(section: SectionKey, input: unknown) {
  switch (section) {
    case 'experiences':
      return normalizeExperience(input)
    case 'educations':
      return normalizeEducation(input)
    case 'skills':
      return normalizeSkill(input)
    case 'projects':
      return normalizeProject(input)
    case 'contacts':
      return normalizeContact(input)
    default:
      throw new Error(`未知的简历区块：${String(section)}`)
  }
}

export function countResumeItems(data: ResumeData) {
  return {
    experiences: data.experiences.length,
    educations: data.educations.length,
    skills: data.skills.length,
    projects: data.projects.length,
    contacts: data.contacts.length,
    responsibilities: data.experiences.reduce((total, item) => total + item.responsibilities.length, 0),
  }
}

/** 简单深合并：对象递归合并，数组与基础类型直接替换 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base
  if (Array.isArray(patch)) return patch as unknown as T
  if (patch && typeof patch === 'object' && base && typeof base === 'object' && !Array.isArray(base)) {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      result[key] = deepMerge((base as Record<string, unknown>)[key], value)
    }
    return result as T
  }
  if (patch === null) return base
  return patch as T
}
