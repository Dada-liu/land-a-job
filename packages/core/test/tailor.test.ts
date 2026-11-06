import { describe, expect, it } from 'vitest'
import { buildTailorPlan, validateTailor, type TailorResume } from '../src/tailor.js'

const JD = `高级前端工程师
1. 5-8 年经验
2. 精通 React / TypeScript / Next.js
3. 熟悉 Node.js 与 GraphQL
4. 有 Kubernetes 经验优先`

const base: TailorResume = {
  personalInfo: { name: '张三', jobTitle: '前端工程师', workYears: '6年', city: '杭州' },
  skills: [{ name: 'Node.js' }, { name: 'React' }, { name: 'TypeScript' }],
  projects: [
    { name: '内部工具', technologies: ['Vue'], description: '做了个后台' },
    { name: '数据看板', technologies: ['React', 'TypeScript'], description: '可视化' },
  ],
  experiences: [
    { company: 'A 公司', role: '前端工程师', period: '2019-2021', description: '负责后台' },
    { company: 'B 公司', role: '高级前端工程师', period: '2021-2024', description: '负责增长' },
  ],
  educations: [{ school: 'X 大学', degree: '本科', period: '2015-2019' }],
}

describe('buildTailorPlan', () => {
  it('摘要提示只取简历里已有的证据词', () => {
    const plan = buildTailorPlan(base, { title: '高级前端工程师', jdText: JD })
    expect(plan.summaryHints).toContain('react')
    expect(plan.summaryHints).toContain('typescript')
    // 简历里没有的词不能出现在"摘要建议"里，否则等于诱导编造
    expect(plan.summaryHints).not.toContain('graphql')
  })

  it('项目按 JD 技术命中数排序', () => {
    const plan = buildTailorPlan(base, { title: '高级前端工程师', jdText: JD })
    expect(plan.reorderProjects[0]).toBe('数据看板')
  })

  it('技能按 JD 出现顺序排，没命中的排后面', () => {
    const plan = buildTailorPlan(base, { title: '高级前端工程师', jdText: JD })
    expect(plan.reorderSkills[0]).toBe('React')
    expect(plan.reorderSkills.at(-1)).toBe('Node.js')
  })

  it('缺口标严重度，并给出可执行建议', () => {
    const plan = buildTailorPlan(base, { title: '高级前端工程师', jdText: JD })
    const graphql = plan.gap.find((item) => item.keyword === 'graphql')
    expect(graphql).toBeTruthy()
    expect(['blocking', 'important', 'nice']).toContain(graphql!.severity)
    expect(graphql!.suggestion.length).toBeGreaterThan(10)
    expect(plan.mustNotInvent).toBe(true)
    expect(plan.constraints.length).toBeGreaterThanOrEqual(3)
  })

  it('匹配率反映真实命中情况', () => {
    const plan = buildTailorPlan(base, { title: '高级前端工程师', jdText: JD })
    expect(plan.match.jdTech).toBeGreaterThanOrEqual(4)
    expect(plan.match.matched).toBeGreaterThanOrEqual(2)
    expect(plan.match.ratio).toBeGreaterThan(0)
  })
})

describe('validateTailor（编造校验）', () => {
  it('只重排重述时通过', () => {
    const after: TailorResume = {
      ...base,
      projects: [...base.projects!].reverse(),
      experiences: base.experiences!.map((exp) => ({ ...exp, description: `${exp.description}，用 React 重构` })),
    }
    expect(validateTailor(base, after)).toEqual([])
  })

  it('新增经历被拒', () => {
    const after: TailorResume = {
      ...base,
      experiences: [...base.experiences!, { company: 'C 公司', role: '架构师', period: '2024-2025' }],
    }
    const violations = validateTailor(base, after)
    expect(violations.map((item) => item.kind)).toContain('experience_added')
  })

  it('改公司名被拒', () => {
    const after: TailorResume = {
      ...base,
      experiences: [{ ...base.experiences![0]!, company: '某大厂' }, base.experiences![1]!],
    }
    expect(validateTailor(base, after).map((item) => item.kind)).toContain('company_changed')
  })

  it('改在职时间被拒', () => {
    const after: TailorResume = {
      ...base,
      experiences: [{ ...base.experiences![0]!, period: '2018-2021' }, base.experiences![1]!],
    }
    expect(validateTailor(base, after).map((item) => item.kind)).toContain('period_changed')
  })

  it('新增项目与学历被拒', () => {
    const after: TailorResume = {
      ...base,
      projects: [...base.projects!, { name: '新项目', technologies: ['React'], description: '编的' }],
      educations: [...base.educations!, { school: 'Y 大学', degree: '硕士', period: '2019-2022' }],
    }
    const kinds = validateTailor(base, after).map((item) => item.kind)
    expect(kinds).toContain('project_added')
    expect(kinds).toContain('education_added')
  })

  it('改学位被拒', () => {
    const after: TailorResume = { ...base, educations: [{ ...base.educations![0]!, degree: '硕士' }] }
    expect(validateTailor(base, after).map((item) => item.kind)).toContain('degree_changed')
  })
})
