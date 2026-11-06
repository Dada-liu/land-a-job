export interface PersonalInfo {
  name: string
  jobTitle: string
  workYears?: string
  /** 期望城市：简历本身不一定要展示，但 fit 打分需要它（城市因子） */
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
