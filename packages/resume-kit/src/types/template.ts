import type { FC } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ResumeData } from './resume'

export interface EditorModule {
  id: string
  label: string
  icon: LucideIcon
  component: FC
}

export interface ResumeTemplate {
  id: string
  name: string
  /** 一句话说明模板风格与适用场景，Agent 选模板时会读到 */
  description?: string
  component: FC<{ data: ResumeData }>
  defaultResume: ResumeData
  editorModules: EditorModule[]
  /** bleed = 左右分栏需要出血到纸边（经典模板的浅灰侧栏） */
  contentLayout?: 'bleed' | 'inset'
}

export type TemplateId = string
