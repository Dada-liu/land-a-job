import catalog from './catalog.json'

export interface TemplateMeta {
  id: string
  name: string
  description: string
}

/**
 * 模板元数据单独成文件（只读 catalog.json，不 import 任何模板组件）。
 *
 * 这样列表页可以只取模板名，而不用把三套模板 + jsPDF 一起拉进首屏包。
 */
export const templateCatalog: TemplateMeta[] = catalog

export const DEFAULT_TEMPLATE_ID = 'classic'

export const templateIds: string[] = templateCatalog.map((template) => template.id)

export function isTemplateId(id: string): boolean {
  return templateIds.includes(id)
}

export function templateName(id: string): string {
  return templateCatalog.find((template) => template.id === id)?.name ?? id
}
