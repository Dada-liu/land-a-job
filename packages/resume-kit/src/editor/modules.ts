import { Contact, FileText, FolderKanban, GraduationCap, Briefcase, User, Wrench } from 'lucide-react'
import { ContactEditor } from './editors/ContactEditor'
import { EducationEditor } from './editors/EducationEditor'
import { ExperienceEditor } from './editors/ExperienceEditor'
import { PersonalInfoEditor } from './editors/PersonalInfoEditor'
import { ProjectsEditor } from './editors/ProjectsEditor'
import { SkillsEditor } from './editors/SkillsEditor'
import { SummaryEditor } from './editors/SummaryEditor'
import type { EditorModule } from '../types/template'

/**
 * 三套模板共用同一组编辑器。
 *
 * 源项目把 8 个编辑器在 3 个模板目录下各复制了一份（内容完全一致，约 2400 行重复）。
 * 抽包时合并成一份：模板只决定「怎么渲染」，编辑器只决定「怎么改数据」。
 */
export const EDITOR_MODULES: EditorModule[] = [
  { id: 'personalInfo', label: '个人信息', icon: User, component: PersonalInfoEditor },
  { id: 'summary', label: '自我介绍', icon: FileText, component: SummaryEditor },
  { id: 'experience', label: '工作经历', icon: Briefcase, component: ExperienceEditor },
  { id: 'education', label: '教育经历', icon: GraduationCap, component: EducationEditor },
  { id: 'skills', label: '专业技能', icon: Wrench, component: SkillsEditor },
  { id: 'projects', label: '项目介绍', icon: FolderKanban, component: ProjectsEditor },
  { id: 'contact', label: '联系方式', icon: Contact, component: ContactEditor },
]
