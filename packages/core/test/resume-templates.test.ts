import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESUME_TEMPLATE,
  isResumeTemplateId,
  RESUME_TEMPLATE_LABELS,
  RESUME_TEMPLATES,
  resumeTemplateLabel,
} from '../src/resume-templates.js'

describe('简历模板元数据', () => {
  it('每个模板 id 都有中文名，且没有多余条目', () => {
    expect(Object.keys(RESUME_TEMPLATE_LABELS).sort()).toEqual([...RESUME_TEMPLATES].sort())
    for (const id of RESUME_TEMPLATES) {
      expect(RESUME_TEMPLATE_LABELS[id]).toBeTruthy()
    }
  })

  it('默认模板必须是已知 id', () => {
    expect(isResumeTemplateId(DEFAULT_RESUME_TEMPLATE)).toBe(true)
  })

  it('未知 id 原样返回，方便页面在模板被删后仍能显示点什么', () => {
    expect(resumeTemplateLabel('legacy-template')).toBe('legacy-template')
    expect(resumeTemplateLabel('classic')).toBe('经典模板')
  })

  it('isResumeTemplateId 拒绝非字符串与拼错的值', () => {
    expect(isResumeTemplateId('classicc')).toBe(false)
    expect(isResumeTemplateId(null)).toBe(false)
    expect(isResumeTemplateId(1)).toBe(false)
  })
})
