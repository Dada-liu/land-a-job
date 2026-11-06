import type { FC } from 'react'
import type { ResumeData } from '../types/resume'
import type { EditorModule, ResumeTemplate } from '../types/template'
import { ClassicTemplate } from './classic/ClassicTemplate'
import { classicDefaultResume, classicEditorModules } from './classic/resumeConfig'
import { Template1 } from './template-1/Template1'
import { template1DefaultResume, template1EditorModules } from './template-1/resumeConfig'
import { Template2 } from './template-2/Template2'
import { template2DefaultResume, template2EditorModules } from './template-2/resumeConfig'
import { templateCatalog } from './meta'

export { DEFAULT_TEMPLATE_ID, isTemplateId, templateCatalog, templateIds, templateName } from './meta'
export type { TemplateMeta } from './meta'

interface TemplateDefinition {
  component: FC<{ data: ResumeData }>
  defaultResume: ResumeData
  editorModules: EditorModule[]
  contentLayout?: 'bleed' | 'inset'
}

const definitions: Record<string, TemplateDefinition> = {
  classic: {
    component: ClassicTemplate,
    defaultResume: classicDefaultResume,
    editorModules: classicEditorModules,
    contentLayout: 'bleed',
  },
  'template-1': {
    component: Template1,
    defaultResume: template1DefaultResume,
    editorModules: template1EditorModules,
  },
  'template-2': {
    component: Template2,
    defaultResume: template2DefaultResume,
    editorModules: template2EditorModules,
  },
}

export const templates: ResumeTemplate[] = templateCatalog.map((meta) => {
  const definition = definitions[meta.id]
  if (!definition) {
    throw new Error(`模板 ${meta.id} 缺少实现，请检查 packages/resume-kit/src/templates/index.ts`)
  }
  return { ...meta, ...definition }
})

export function getTemplateById(id: string): ResumeTemplate | undefined {
  return templates.find((template) => template.id === id)
}
