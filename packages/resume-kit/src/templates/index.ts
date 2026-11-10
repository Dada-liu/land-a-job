import type { FC } from 'react'
import type { ResumeData } from '../types/resume'
import type { EditorModule, ResumeTemplate } from '../types/template'
import { ClassicTemplate } from './classic/ClassicTemplate'
import { classicEditorModules } from './classic/resumeConfig'
import { Template1 } from './template-1/Template1'
import { template1EditorModules } from './template-1/resumeConfig'
import { Template2 } from './template-2/Template2'
import { template2EditorModules } from './template-2/resumeConfig'
import { templateCatalog } from './meta'

export { DEFAULT_TEMPLATE_ID, isTemplateId, templateCatalog, templateIds, templateName } from './meta'
export type { TemplateMeta } from './meta'

/**
 * 模板定义里刻意没有「默认简历内容」：新建简历时填什么由 `sampleResumeData()` 决定，
 * 三套模板共用同一份示例。以前每个模板各存一份 defaultResume，但没有任何地方读它，
 * 改它也不会影响新建的简历——留着只会让人以为改这里就能改初始内容。
 */
interface TemplateDefinition {
  component: FC<{ data: ResumeData }>
  editorModules: EditorModule[]
  contentLayout?: 'bleed' | 'inset'
}

const definitions: Record<string, TemplateDefinition> = {
  classic: {
    component: ClassicTemplate,
    editorModules: classicEditorModules,
    contentLayout: 'bleed',
  },
  'template-1': {
    component: Template1,
    editorModules: template1EditorModules,
  },
  'template-2': {
    component: Template2,
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
