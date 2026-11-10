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

export interface ResumeData {
  personalInfo: PersonalInfo
  selfIntroduction: string
  experiences: Experience[]
  educations: Education[]
  skills: Skill[]
  projects: Project[]
  contacts: Contact[]
}
