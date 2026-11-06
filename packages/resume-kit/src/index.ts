/**
 * resume-kit：简历编辑器内核（受控、无 store、无网络）
 *
 * 与源项目 resume-generator-2 的唯一区别是数据来源：
 * 源项目组件直接读 zustand store；这里全部改成 props / context 驱动，
 * 所以既能嵌进 land-a-job 的编辑页，也能被将来的导出页、预览页复用。
 */
export type {
  Contact,
  Education,
  Experience,
  PersonalInfo,
  Project,
  ResumeData,
  Skill,
} from './types/resume'
export type { EditorModule, ResumeTemplate, TemplateId } from './types/template'

export {
  countResumeItems,
  createBlankResume,
  deepMerge,
  isSectionKey,
  normalizeResumeData,
  normalizeSectionItem,
  SECTION_KEYS,
  SECTION_LABELS,
} from './model'
export type { SectionKey } from './model'

export {
  DEFAULT_TEMPLATE_ID,
  getTemplateById,
  isTemplateId,
  templateCatalog,
  templateIds,
  templateName,
  templates,
} from './templates'
export type { TemplateMeta } from './templates'

export { ResumeEditorProvider, useResumeEditor } from './editor/context'
export type { ResumeEditorApi } from './editor/context'
export { EditorPanel } from './editor/EditorPanel'
export { EDITOR_MODULES } from './editor/modules'
export { ResumePages } from './editor/ResumePages'
export type { ResumePagesLayout, ResumePagesProps } from './editor/ResumePages'
export { ResumePaper, RESUME_PAGE_PADDING } from './editor/ResumePaper'
export { ResumePreview } from './editor/ResumePreview'
export { ConfirmDialog } from './editor/ConfirmDialog'
export { CustomSelect } from './editor/CustomSelect'

export { buildResumeFileName, exportResumePdf } from './export/pdf'
export type { ExportPdfOptions, ExportPdfResult } from './export/pdf'

export { parseResumeFromText } from './import/markdown'
export type { ParsedResume } from './import/markdown'
