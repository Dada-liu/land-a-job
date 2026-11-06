import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import type { Contact, Education, Experience, PersonalInfo, Project, ResumeData, Skill } from '../types/resume'

/**
 * 受控编辑上下文。
 *
 * 源项目用 zustand 全局 store：编辑器直接 import store 改数据，导致组件无法在别处复用。
 * 这里保留**同样的 API 形状**（resume / updatePersonalInfo / addExperience / ...），
 * 但实现换成 props 驱动的受控更新——所以编辑器组件体几乎不用改，
 * 又能被任何持有 ResumeData 的页面复用。
 *
 * 取舍：不改成「每个编辑器收 value+onChange」的原因，是那要重写 8 个编辑器的每个字段，
 * 改动面大且容易引入交互回归；用 context 适配器只改 import 一行。
 */

const newId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2, 10)}`

function reorder<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved as T)
  return next
}

export interface ResumeEditorApi {
  resume: ResumeData
  activeEditor: string | null
  setActiveEditor: (id: string | null) => void
  setResume: (data: ResumeData) => void
  updatePersonalInfo: (info: PersonalInfo) => void
  updateSelfIntroduction: (intro: string) => void
  addExperience: () => void
  updateExperience: (id: string, experience: Experience) => void
  deleteExperience: (id: string) => void
  reorderExperiences: (fromIndex: number, toIndex: number) => void
  addEducation: () => void
  updateEducation: (id: string, education: Education) => void
  deleteEducation: (id: string) => void
  addSkill: () => void
  updateSkill: (id: string, skill: Skill) => void
  deleteSkill: (id: string) => void
  reorderSkills: (fromIndex: number, toIndex: number) => void
  addProject: () => void
  updateProject: (id: string, project: Project) => void
  deleteProject: (id: string) => void
  reorderProjects: (fromIndex: number, toIndex: number) => void
  addContact: () => void
  updateContact: (id: string, contact: Contact) => void
  deleteContact: (id: string) => void
}

const ResumeEditorContext = createContext<ResumeEditorApi | null>(null)

export interface ResumeEditorProviderProps {
  value: ResumeData
  onChange: (next: ResumeData) => void
  activeEditor?: string | null
  onActiveEditorChange?: (id: string | null) => void
  children: ReactNode
}

export function ResumeEditorProvider({
  value,
  onChange,
  activeEditor = null,
  onActiveEditorChange,
  children,
}: ResumeEditorProviderProps) {
  const setActiveEditor = useCallback(
    (id: string | null) => onActiveEditorChange?.(id),
    [onActiveEditorChange],
  )

  const api = useMemo<ResumeEditorApi>(() => {
    /** 所有写操作都走这里：一次浅拷贝 + 覆盖单个区块，保证 onChange 拿到的是新对象 */
    const patch = (part: Partial<ResumeData>): void => onChange({ ...value, ...part })

    return {
      resume: value,
      activeEditor,
      setActiveEditor,
      setResume: (data) => onChange(data),
      updatePersonalInfo: (info) => patch({ personalInfo: info }),
      updateSelfIntroduction: (intro) => patch({ selfIntroduction: intro }),

      addExperience: () =>
        patch({
          experiences: [
            ...value.experiences,
            { id: newId(), period: '', company: '', position: '', responsibilities: [''] },
          ],
        }),
      updateExperience: (id, experience) =>
        patch({ experiences: value.experiences.map((item) => (item.id === id ? experience : item)) }),
      deleteExperience: (id) =>
        patch({ experiences: value.experiences.filter((item) => item.id !== id) }),
      reorderExperiences: (fromIndex, toIndex) =>
        patch({ experiences: reorder(value.experiences, fromIndex, toIndex) }),

      addEducation: () =>
        patch({
          educations: [...value.educations, { id: newId(), school: '', degree: '', major: '', period: '' }],
        }),
      updateEducation: (id, education) =>
        patch({ educations: value.educations.map((item) => (item.id === id ? education : item)) }),
      deleteEducation: (id) => patch({ educations: value.educations.filter((item) => item.id !== id) }),

      addSkill: () => patch({ skills: [...value.skills, { id: newId(), name: '', description: '' }] }),
      updateSkill: (id, skill) =>
        patch({ skills: value.skills.map((item) => (item.id === id ? skill : item)) }),
      deleteSkill: (id) => patch({ skills: value.skills.filter((item) => item.id !== id) }),
      reorderSkills: (fromIndex, toIndex) => patch({ skills: reorder(value.skills, fromIndex, toIndex) }),

      addProject: () =>
        patch({
          projects: [
            ...value.projects,
            { id: newId(), name: '', period: '', role: '', description: '', details: '', technologies: [''] },
          ],
        }),
      updateProject: (id, project) =>
        patch({ projects: value.projects.map((item) => (item.id === id ? project : item)) }),
      deleteProject: (id) => patch({ projects: value.projects.filter((item) => item.id !== id) }),
      reorderProjects: (fromIndex, toIndex) =>
        patch({ projects: reorder(value.projects, fromIndex, toIndex) }),

      addContact: () => patch({ contacts: [...value.contacts, { id: newId(), platform: '', value: '' }] }),
      updateContact: (id, contact) =>
        patch({ contacts: value.contacts.map((item) => (item.id === id ? contact : item)) }),
      deleteContact: (id) => patch({ contacts: value.contacts.filter((item) => item.id !== id) }),
    }
  }, [value, onChange, activeEditor, setActiveEditor])

  return <ResumeEditorContext.Provider value={api}>{children}</ResumeEditorContext.Provider>
}

export function useResumeEditor(): ResumeEditorApi {
  const api = useContext(ResumeEditorContext)
  if (!api) {
    throw new Error('useResumeEditor 必须在 ResumeEditorProvider 内使用（简历编辑器已去 store 化）')
  }
  return api
}
