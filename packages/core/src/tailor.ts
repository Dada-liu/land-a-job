/**
 * 定制简历的计划与校验（ARCHITECTURE 9.4，P4-2）。
 *
 * 应用只做两件事：给出「该突出什么」的计划；校验「有没有编造」。
 * 真正的重写发生在 Agent 侧——这是 D2 的边界，不能用「顺手调个模型」越过。
 */

import { canonicalTerm, extractJdSignals, resumeTechTerms, type FitJob, type FitResume } from './fit.js'

export interface TailorExperience {
  company?: string | null
  /** resume-kit 用 position，旧数据用 role */
  position?: string | null
  role?: string | null
  period?: string | null
  description?: string | null
  responsibilities?: string[] | null
}

export interface TailorResume extends FitResume {
  selfIntroduction?: string | null
  experiences?: TailorExperience[] | null
  educations?: { school?: string | null; degree?: string | null; period?: string | null }[] | null
}

export type GapSeverity = 'blocking' | 'important' | 'nice'

export interface TailorGap {
  keyword: string
  severity: GapSeverity
  /** 给用户/Agent 的补证据建议，必须可执行（不写"加强学习"这种空话） */
  suggestion: string
}

export interface TailorPlan {
  /** 摘要里应当出现的词（都来自简历已有证据，不许凭空补） */
  summaryHints: string[]
  /** 项目展示顺序：命中的技术词越多越靠前 */
  reorderProjects: string[]
  /** 技能展示顺序 */
  reorderSkills: string[]
  gap: TailorGap[]
  /** 硬约束，同时返回给 Agent 与页面，避免"忘了" */
  mustNotInvent: true
  constraints: string[]
  /** 匹配度概览，给人一个「改这版值不值」的判断 */
  match: { jdTech: number; matched: number; ratio: number }
}

const DEFAULT_CONSTRAINTS = [
  '不得新增经历、项目、学历条目',
  '不得修改公司名、在职时间、职级、学校与学位',
  '不得虚构数字；量化只能来自已有事实',
  '允许：重排顺序、重述措辞、突出与 JD 相关的部分',
]

function countOccurrences(text: string, term: string): number {
  if (!text || !term) return 0
  let count = 0
  let index = text.toLowerCase().indexOf(term.toLowerCase())
  while (index !== -1) {
    count += 1
    index = text.toLowerCase().indexOf(term.toLowerCase(), index + term.length)
  }
  return count
}

export function buildTailorPlan(resume: TailorResume, job: FitJob): TailorPlan {
  const signals = extractJdSignals(job.jdText ?? '', job.title ?? '')
  const jdTech = signals.tech.length > 0 ? signals.tech : (job.keywords ?? []).map(canonicalTerm)
  const resumeTerms = new Set(resumeTechTerms(resume))

  const matched = jdTech.filter((term) => resumeTerms.has(term))
  const missing = jdTech.filter((term) => !resumeTerms.has(term))
  const jdText = job.jdText ?? ''

  const gap: TailorGap[] = missing.map((keyword) => {
    const frequency = countOccurrences(jdText, keyword)
    // 只在开头出现一次的词通常只是"加分项"，反复出现才是真要求
    const severity: GapSeverity = frequency >= 3 ? 'blocking' : frequency >= 2 ? 'important' : 'nice'
    const suggestion =
      severity === 'blocking'
        ? `JD 里出现 ${frequency} 次。若确实做过，在最近一段经历里补一句具体做了什么、结果是多少；没做过就如实留白。`
        : `JD 提到但简历没有。可在项目描述里点明是否用过；没有就把这个缺口记下来，面试前准备一句「没做过但可迁移」的回答。`
    return { keyword, severity, suggestion }
  })

  const rankProjects = (resume.projects ?? [])
    .map((project) => {
      const bag = `${project.name ?? ''} ${(project.technologies ?? []).join(' ')} ${project.description ?? ''}`
      const own = new Set(extractJdSignals(bag).tech)
      const score = jdTech.filter((term) => own.has(term)).length
      return { name: project.name ?? '未命名项目', score }
    })
    .sort((a, b) => b.score - a.score)

  const rankSkills = (resume.skills ?? [])
    .map((skill) => {
      const name = canonicalTerm(skill.name ?? '')
      const index = jdTech.indexOf(name)
      return { name: skill.name ?? '', score: index === -1 ? Number.MAX_SAFE_INTEGER : index }
    })
    .sort((a, b) => a.score - b.score)
    .map((item) => item.name)
    .filter(Boolean)

  return {
    summaryHints: matched.slice(0, 6),
    reorderProjects: rankProjects.map((item) => item.name),
    reorderSkills: rankSkills,
    gap,
    mustNotInvent: true,
    constraints: DEFAULT_CONSTRAINTS,
    match: {
      jdTech: jdTech.length,
      matched: matched.length,
      ratio: jdTech.length === 0 ? 0 : Math.round((matched.length / jdTech.length) * 100) / 100,
    },
  }
}

/* --------------------------------- 校验 --------------------------------- */

export type TailorViolationKind =
  | 'experience_added'
  | 'project_added'
  | 'education_added'
  | 'company_changed'
  | 'period_changed'
  | 'degree_changed'

export interface TailorViolation {
  kind: TailorViolationKind
  message: string
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 编造校验：Agent 改完的简历落库前必须过这一关。
 *
 * 只做「能不能证明是编造」的判断，不做风格审查：
 * 重排、重述、加粗、改标点都放行；新增条目、改公司/时间/学位一律拒绝。
 */
export function validateTailor(before: TailorResume, after: TailorResume): TailorViolation[] {
  const violations: TailorViolation[] = []

  const beforeExp = before.experiences ?? []
  const afterExp = after.experiences ?? []
  if (afterExp.length > beforeExp.length) {
    violations.push({
      kind: 'experience_added',
      message: `经历条目从 ${beforeExp.length} 条变成 ${afterExp.length} 条；定制版不允许新增经历`,
    })
  }
  for (let index = 0; index < Math.min(beforeExp.length, afterExp.length); index += 1) {
    const was = beforeExp[index]!
    const now = afterExp[index]!
    if (normalize(was.company) !== normalize(now.company)) {
      violations.push({
        kind: 'company_changed',
        message: `第 ${index + 1} 段经历的公司被改了：「${normalize(was.company)}」→「${normalize(now.company)}」`,
      })
    }
    if (normalize(was.period) !== normalize(now.period)) {
      violations.push({
        kind: 'period_changed',
        message: `第 ${index + 1} 段经历的时间被改了：「${normalize(was.period)}」→「${normalize(now.period)}」`,
      })
    }
  }

  const beforeProjects = before.projects ?? []
  const afterProjects = after.projects ?? []
  if (afterProjects.length > beforeProjects.length) {
    violations.push({
      kind: 'project_added',
      message: `项目从 ${beforeProjects.length} 个变成 ${afterProjects.length} 个；只能重排与重述`,
    })
  }

  const beforeEdu = before.educations ?? []
  const afterEdu = after.educations ?? []
  if (afterEdu.length > beforeEdu.length) {
    violations.push({ kind: 'education_added', message: '不允许新增学历条目' })
  }
  for (let index = 0; index < Math.min(beforeEdu.length, afterEdu.length); index += 1) {
    const was = beforeEdu[index]!
    const now = afterEdu[index]!
    if (normalize(was.degree) !== normalize(now.degree)) {
      violations.push({
        kind: 'degree_changed',
        message: `第 ${index + 1} 条学历的学位被改了：「${normalize(was.degree)}」→「${normalize(now.degree)}」`,
      })
    }
  }

  return violations
}

/** 一句话总结违规，直接给 Agent 与页面用 */
export function describeViolations(violations: TailorViolation[]): string {
  if (violations.length === 0) return ''
  return `定制版被拒绝写入：${violations.map((item) => item.message).join('；')}`
}
