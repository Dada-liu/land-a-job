import { describe, expect, it } from 'vitest'
import { normalizeResumeData } from '../src/model'
import { sampleResumeData } from '../src/sample-resume'

describe('新建简历的示例内容', () => {
  it('每个区块都有一条示例，新用户才看得到模板有几块', () => {
    const data = sampleResumeData()
    expect(data.experiences.length).toBeGreaterThan(0)
    expect(data.educations.length).toBeGreaterThan(0)
    expect(data.skills.length).toBeGreaterThan(0)
    expect(data.projects.length).toBeGreaterThan(0)
    expect(data.contacts.length).toBeGreaterThan(0)
    expect(data.selfIntroduction).not.toBe('')
  })

  it('个人信息带上意向城市：模板与 fit 城市因子都读它', () => {
    expect(sampleResumeData().personalInfo.city).toBe('上海')
  })

  it('规范化不会把示例内容洗成空的（字段名写错会在这里暴露）', () => {
    const data = sampleResumeData()
    expect(data).toEqual(normalizeResumeData(data))
  })

  it('每次返回独立副本：条目 id 重新生成，改一份不会污染另一份', () => {
    const first = sampleResumeData()
    const second = sampleResumeData()
    expect(first.experiences[0]?.id).not.toBe(second.experiences[0]?.id)
    first.personalInfo.name = '李四'
    expect(second.personalInfo.name).not.toBe('李四')
  })

  it('每条经历都有职责，简历上不会出现空的项目符号块', () => {
    for (const experience of sampleResumeData().experiences) {
      expect(experience.responsibilities.length).toBeGreaterThan(0)
      expect(experience.responsibilities.every((item) => item.trim() !== '')).toBe(true)
    }
  })
})
