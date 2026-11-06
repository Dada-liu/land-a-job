import { describe, expect, it } from 'vitest'
import { countResumeItems, createBlankResume, deepMerge, normalizeResumeData } from '../src/model'
import { parseResumeFromText } from '../src/import/markdown'

/**
 * 这些用例的来源是真实的坑：AI/旧文件给出的简历 JSON 经常不是编译器眼里的 ResumeData。
 * normalizeResumeData 是「坏数据进库前」的最后一道闸，必须能吃掉这些变体。
 */
describe('normalizeResumeData', () => {
  it('旧项目的 basics/experience 结构会被转成 personalInfo/experiences', () => {
    const data = normalizeResumeData({
      personalInfo: { name: '李四', jobTitle: '前端' },
      experiences: [{ company: 'A 公司', position: 'FE', period: '2020-2022', responsibilities: '做了什么\n- 又做了什么' }],
    })
    expect(data.personalInfo.name).toBe('李四')
    expect(data.experiences).toHaveLength(1)
    // 换行文本会按行拆成数组，并去掉项目符号
    expect(data.experiences[0]?.responsibilities).toEqual(['做了什么', '又做了什么'])
    expect(data.experiences[0]?.id).toBeTruthy()
  })

  it('summary / introduction 都当作自我介绍', () => {
    expect(normalizeResumeData({ summary: '我是摘要' }).selfIntroduction).toBe('我是摘要')
    expect(normalizeResumeData({ introduction: '我是介绍' }).selfIntroduction).toBe('我是介绍')
  })

  it('联系方式兼容 label/text 与 platform/value 两种写法', () => {
    const data = normalizeResumeData({
      contacts: [
        { label: 'Email', text: 'a@b.com' },
        { platform: 'Phone', value: '138' },
      ],
    })
    expect(data.contacts.map((c) => [c.platform, c.value])).toEqual([
      ['Email', 'a@b.com'],
      ['Phone', '138'],
    ])
  })

  it('完全无效的输入也返回完整结构，而不是 undefined', () => {
    const data = normalizeResumeData(null)
    expect(data.personalInfo.name).toBe('')
    expect(data.experiences).toEqual([])
    expect(data.contacts).toEqual([])
  })

  it('保留已有 id：旧数据里的条目 id 被投递记录引用过', () => {
    const data = normalizeResumeData({ skills: [{ id: 'skill-1', name: 'TS' }] })
    expect(data.skills[0]?.id).toBe('skill-1')
  })
})

describe('deepMerge', () => {
  it('对象递归合并，数组整体替换', () => {
    const base = { a: 1, nested: { b: 2, c: 3 }, list: [1, 2] }
    const merged = deepMerge(base, { nested: { c: 9 }, list: [3] })
    expect(merged).toEqual({ a: 1, nested: { b: 2, c: 9 }, list: [3] })
  })

  it('undefined 与 null 不覆盖已有值', () => {
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 })
    expect(deepMerge({ a: 1 }, { a: null })).toEqual({ a: 1 })
  })
})

describe('countResumeItems', () => {
  it('统计各区块条数与职责总条数', () => {
    const data = createBlankResume()
    data.experiences = [
      { id: 'e1', period: '', company: '', position: '', responsibilities: ['a', 'b'] },
      { id: 'e2', period: '', company: '', position: '', responsibilities: ['c'] },
    ]
    expect(countResumeItems(data)).toMatchObject({ experiences: 2, responsibilities: 3 })
  })
})

describe('parseResumeFromText', () => {
  it('识别常见中文标题、姓名与联系方式', () => {
    const parsed = parseResumeFromText(
      [
        '# 王五',
        '前端工程师 | 邮箱：wang@example.com',
        '',
        '## 工作经历',
        '2021.03 - 至今 某公司 前端',
        '- 做了 A',
        '- 做了 B',
        '',
        '## 教育经历',
        '2017.09 - 2021.06 某大学 本科 计算机',
      ].join('\n'),
    )

    expect(parsed.data.personalInfo.name).toBe('王五')
    expect(parsed.data.experiences.length).toBeGreaterThan(0)
    expect(parsed.data.experiences[0]?.responsibilities).toContain('做了 A')
    expect(parsed.data.contacts.some((c) => c.value.includes('wang@example.com'))).toBe(true)
  })
})
