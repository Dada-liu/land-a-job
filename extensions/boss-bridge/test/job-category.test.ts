import { describe, expect, it } from 'vitest'
import { classifyJob, describeCategories, keepByCategory } from '../src/lib/job-category.js'

describe('岗位类型识别（抓取时筛选的依据）', () => {
  it('实习：标题里出现"实习"或 Intern（大小写都算）', () => {
    expect(classifyJob('AI Agent 开发实习生（Intern）')).toContain('intern')
    expect(classifyJob('前端开发实习')).toContain('intern')
    expect(classifyJob('Agent Engineer Intern')).toContain('intern')
  })

  it('校招：校招 / 校园 / 应届 / XX届', () => {
    expect(classifyJob('【校招】Web前端开发工程师')).toContain('campus')
    expect(classifyJob('AI Agent开发工程师-27届')).toContain('campus')
    expect(classifyJob('2026届校园招聘-后端')).toContain('campus')
  })

  it('外包：标题里的外包/驻场/派遣/项目顾问', () => {
    expect(classifyJob('Java开发（外包）')).toContain('outsourced')
    expect(classifyJob('前端开发（驻场）')).toContain('outsourced')
    expect(classifyJob('Agent 开发（项目顾问）')).toContain('outsourced')
  })

  it('外包：几家人力外包公司名也算（只看公司名，不看 JD）', () => {
    expect(classifyJob('前端开发工程师', '博彦科技承德有限公司')).toContain('outsourced')
    expect(classifyJob('Agent开发', '中软国际')).toContain('outsourced')
    expect(classifyJob('前端开发', '北京字节跳动')).not.toContain('outsourced')
  })

  it('没命中任何关键词就是社招', () => {
    expect(classifyJob('AI Agent 全栈开发工程师')).toEqual(['experienced'])
    expect(classifyJob('前端开发工程师（react+vue）')).toEqual(['experienced'])
    expect(classifyJob('')).toEqual(['experienced'])
  })

  it('可以同时命中两类（外包公司的实习岗）', () => {
    expect(classifyJob('前端开发实习生', '中软国际')).toEqual(['intern', 'outsourced'])
  })

  it('筛选按"命中任一即可"：勾了实习，实习岗留下、纯社招被跳过', () => {
    expect(keepByCategory('AI Agent 开发实习生', '某公司', ['intern'])).toBe(true)
    expect(keepByCategory('AI Agent 全栈开发', '某公司', ['intern'])).toBe(false)
    expect(keepByCategory('AI 校招岗', '某公司', ['intern', 'campus'])).toBe(true)
  })

  it('允许列表为空视为不筛选（老版本设置里没有这个字段）', () => {
    expect(keepByCategory('AI Agent 开发实习生', '某公司', [])).toBe(true)
    expect(keepByCategory('AI Agent 开发实习生', '某公司', undefined)).toBe(true)
  })

  it('describeCategories 给的是中文标签，日志里能直接读', () => {
    expect(describeCategories('前端开发实习生', '中软国际')).toBe('实习+外包')
    expect(describeCategories('全栈开发')).toBe('社招')
  })
})
