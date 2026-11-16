import { describe, expect, it } from 'vitest'
import {
  applyTailorPlan,
  base64ToBytes,
  bytesToBase64,
  isPdf,
  tailorAndExport,
  type TailorBridgeLike,
} from '../src/lib/resume.js'
import type { StagedJob, TailorPlan } from '../src/lib/types.js'

const plan: TailorPlan = {
  summaryHints: ['typescript', 'react', 'kubernetes'],
  reorderProjects: ['AI 助手平台', '电商后台'],
  reorderSkills: ['TypeScript', 'React'],
  gap: [{ keyword: 'kubernetes', severity: 'nice', suggestion: '没做过就留白' }],
  mustNotInvent: true,
  constraints: ['不得新增经历、项目、学历条目'],
  match: { jdTech: 6, matched: 3, ratio: 0.5 },
}

const resumeData = {
  personalInfo: { name: '张三', jobTitle: '前端工程师' },
  selfIntroduction: '5 年前端经验。',
  projects: [
    { name: '电商后台', technologies: ['Vue'], description: '中台' },
    { name: 'AI 助手平台', technologies: ['React', 'TypeScript'], description: '对话产品' },
  ],
  skills: ['React', 'Node.js', 'TypeScript'],
  experiences: [{ company: 'A 公司', period: '2021-2024', description: '前端' }],
}

function staged(patch: Partial<StagedJob> = {}): StagedJob {
  return {
    key: 'sec-1',
    url: 'https://www.zhipin.com/job_detail/sec-1.html',
    jobName: '前端开发',
    brandName: '拓保软件',
    jdText: '岗位职责：React 与 TypeScript。'.repeat(5),
    bossActive: { online: true, capturedAt: 1794454000000, source: 'detail' },
    state: 'replied',
    isNew: true,
    capturedAt: 1794454000000,
    landSync: {
      companyId: 'c-1', jobId: 'j-1', applicationId: 'a-1', syncedAt: 1794454310204,
      reused: { company: false, job: false, application: false },
    },
    ...patch,
  }
}

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])

function mockBridge(opts: {
  validateOk?: boolean
  pdf?: Uint8Array
  planOverride?: Partial<TailorPlan>
} = {}) {
  const calls: string[] = []
  const bridge: TailorBridgeLike = {
    health: async () => ({ ok: true, message: 'ok' }),
    findCompanyByName: async () => null,
    createCompany: async () => 'c-1',
    findJobByUrl: async () => null,
    createJob: async () => 'j-1',
    importJd: async () => {},
    scoreJob: async () => 70,
    findApplicationByJob: async () => null,
    createApplication: async () => 'a-1',
    appendNote: async () => {},
    getJob: async () => ({ id: 'j-1', title: '前端开发' }),
    tailorPlan: async () => {
      calls.push('tailorPlan')
      return {
        jobId: 'j-1',
        resumeId: 'r-master',
        resumeTitle: '前端工程师-母版',
        resumeSource: 'master' as const,
        plan: { ...plan, ...opts.planOverride },
        instruction: '定制简历',
      }
    },
    duplicateResume: async (_id, input) => {
      calls.push(`duplicate:${input.title ?? ''}`)
      return { id: 'r-variant', title: input.title ?? '定制版', kind: 'variant', data: structuredClone(resumeData) }
    },
    validateTailor: async () => {
      calls.push('validate')
      return opts.validateOk === false
        ? { ok: false, violations: [{ kind: 'added-entry' }], message: '新增了 1 个项目条目' }
        : { ok: true, violations: [], message: '' }
    },
    patchResume: async () => {
      calls.push('patch')
      return { id: 'r-variant', title: '定制版', kind: 'variant', data: {} }
    },
    exportResumePdf: async () => {
      calls.push('export')
      return { bytes: opts.pdf ?? PDF, fileName: '张三_前端开发_定制版_20261112.pdf' }
    },
  }
  return { bridge, calls }
}

describe('按计划改写（0 token，只重排 + 补已有事实）', () => {
  it('项目与技能按 JD 命中度重排，条目数量不变', () => {
    const applied = applyTailorPlan(resumeData, plan)
    expect((applied.data.projects as { name: string }[]).map((p) => p.name)).toEqual([
      'AI 助手平台', '电商后台',
    ])
    // 技能顺序完全服从 plan.reorderSkills：TypeScript 优先于 React
    expect(applied.data.skills).toEqual(['TypeScript', 'React', 'Node.js'])
    expect((applied.data.projects as unknown[]).length).toBe(2)
    expect((applied.data.skills as unknown[]).length).toBe(3)
    expect(applied.projectsReordered).toBe(true)
    expect(applied.skillsReordered).toBe(true)
  })

  it('自我介绍只补简历里没有的词，重复执行不会叠加', () => {
    const first = applyTailorPlan(resumeData, plan)
    expect(first.data.selfIntroduction).toBe('5 年前端经验；熟悉 typescript、react、kubernetes。')
    const second = applyTailorPlan(first.data, plan)
    expect(second.data.selfIntroduction).toBe(first.data.selfIntroduction)
    expect(second.summaryAppended).toEqual([])
  })

  it('没有自我介绍字段时不硬塞新文本（避免被判成新增内容）', () => {
    const { selfIntroduction: _drop, ...noSummary } = resumeData
    const applied = applyTailorPlan(noSummary, plan)
    expect(applied.data).not.toHaveProperty('summary')
    expect(applied.summaryAppended).toEqual([])
    expect(applied.skipped).toContain('typescript')
  })

  it('公司、时间等硬字段一个字都不改', () => {
    const applied = applyTailorPlan(resumeData, plan)
    expect(applied.data.experiences).toEqual(resumeData.experiences)
    expect(applied.data.personalInfo).toEqual(resumeData.personalInfo)
  })
})

describe('P3 定制 → 校验 → 落库 → 导出', () => {
  it('按固定顺序调用，导出的 PDF 与 variant 一起返回', async () => {
    const { bridge, calls } = mockBridge()
    const result = await tailorAndExport(staged(), bridge)
    expect(calls).toEqual(['tailorPlan', 'duplicate:前端开发 · 定制版', 'validate', 'patch', 'export'])
    expect(result).toMatchObject({
      resumeId: 'r-variant',
      baseResumeId: 'r-master',
      fileName: '张三_前端开发_定制版_20261112.pdf',
      resumeSource: 'master',
    })
    expect(isPdf(result.bytes)).toBe(true)
  })

  it('防编造校验不通过就停：不 PATCH、不导出', async () => {
    const { bridge, calls } = mockBridge({ validateOk: false })
    await expect(tailorAndExport(staged(), bridge)).rejects.toThrow('新增了 1 个项目条目')
    expect(calls).toEqual(['tailorPlan', 'duplicate:前端开发 · 定制版', 'validate'])
  })

  it('导出不是 PDF 时报错，绝不把 HTML 当附件', async () => {
    const { bridge } = mockBridge({ pdf: new TextEncoder().encode('<html>登录页</html>') })
    await expect(tailorAndExport(staged(), bridge)).rejects.toThrow('不是 PDF')
  })

  it('岗位没落库就不定制（variant 会挂到空气上）', async () => {
    const { bridge, calls } = mockBridge()
    await expect(tailorAndExport(staged({ landSync: undefined }), bridge)).rejects.toThrow('岗位还没落库')
    expect(calls).toEqual([])
  })

  it('用户已接手会话时不动手', async () => {
    const { bridge, calls } = mockBridge()
    await expect(tailorAndExport(staged({ manual: true }), bridge)).rejects.toThrow('自动化停止')
    expect(calls).toEqual([])
  })
})

describe('PDF 判定与 base64 传输', () => {
  it('识别 %PDF- 魔数', () => {
    expect(isPdf(PDF)).toBe(true)
    expect(isPdf(new Uint8Array([0x3c, 0x68, 0x74]))).toBe(false)
    expect(isPdf(new Uint8Array([]))).toBe(false)
  })

  it('字节与 base64 往返不丢数据（大文件分块）', () => {
    const big = new Uint8Array(200_000)
    for (let index = 0; index < big.length; index += 1) big[index] = index % 256
    const restored = base64ToBytes(bytesToBase64(big))
    expect(restored.length).toBe(big.length)
    expect(restored[0]).toBe(0)
    expect(restored[199_999]).toBe(199_999 % 256)
  })
})
