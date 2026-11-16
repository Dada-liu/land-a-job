export interface PersonalInfo {
  name: string
  jobTitle: string
  workYears?: string
  /** 意向城市：模板在个人信息区展示（为空则不显示），fit 打分的城市因子也读它 */
  city?: string
  avatar?: string
  showAvatar?: boolean
  avatarShape?: 'circle' | 'square'
}

export interface Experience {
  id: string
  period: string
  company: string
  position: string
  responsibilities: string[]
}

export interface Education {
  id: string
  school: string
  degree: string
  major: string
  period?: string
}

export interface Skill {
  id: string
  name: string
  description: string
}

export interface Project {
  id: string
  name: string
  period?: string
  role?: string
  description: string
  details: string
  technologies: string[]
  url?: string
}

export interface Contact {
  id: string
  platform: string
  value: string
  url?: string
}

/**
 * 可加空行的区块。
 *
 * 空行的唯一作用是**撑开区块间距**：一行 = 一个正文行高，写在区块内容的最后面。
 * 只有「经典模板（自由编辑）」会渲染它，但字段跟着 data 一起存整份 JSON，
 * 其它模板读到也无害（忽略即可）。
 */
export type SectionSpacingKey = 'personal' | 'experiences' | 'projects' | 'educations' | 'skills' | 'summary'

export interface ResumeData {
  personalInfo: PersonalInfo
  selfIntroduction: string
  experiences: Experience[]
  educations: Education[]
  skills: Skill[]
  projects: Project[]
  contacts: Contact[]
  /** 每个区块末尾追加的空行数（缺省 = 0） */
  sectionSpacing?: Partial<Record<SectionSpacingKey, number>>
}
