import { describe, expect, it } from 'vitest'
import {
  canonicalTerm,
  extractEducation,
  extractJdSignals,
  extractSalary,
  extractTechTerms,
  extractYears,
  scoreFit,
  type FitResume,
} from '../src/fit.js'

const JD = `高级前端工程师
1. 5-8 年经验，本科及以上学历，计算机相关专业
2. 精通 React / TypeScript，熟悉 Next.js 与 Tailwind CSS
3. 熟悉 Node.js，有 BFF 层开发经验
4. 了解 Kubernetes、Docker 与 CI/CD 流程
5. 有数据可视化经验（ECharts / D3）优先
薪资：35-55K·15薪，工作地点：杭州`

const RESUME: FitResume = {
  personalInfo: { jobTitle: '前端工程师', workYears: '6年', city: '杭州' },
  educations: [{ degree: '本科' }],
  skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Next.js' }, { name: 'Tailwind' }],
  projects: [
    { name: '数据看板', technologies: ['ECharts', 'D3'], description: '用 React 与 TypeScript 实现可视化看板' },
  ],
  experiences: [{ role: '高级前端工程师', company: '某公司', description: '负责 BFF 层与 Node.js 服务' }],
}

describe('extractTechTerms', () => {
  it('命中常见栈并归一化别名', () => {
    const terms = extractTechTerms('熟悉 React.js 与 nodejs，了解 k8s')
    expect(terms).toContain('react')
    expect(terms).toContain('node.js')
    expect(terms).toContain('kubernetes')
  })

  it('不做子串误命中：reactive 不算 react，google 不算 go', () => {
    expect(extractTechTerms('reactive programming')).not.toContain('react')
    expect(extractTechTerms('google analytics')).not.toContain('go')
  })

  it('中文紧邻也能命中', () => {
    expect(extractTechTerms('使用React开发')).toContain('react')
  })
})

describe('信号抽取', () => {
  it('年限区间 / N 年以上 / N 年经验', () => {
    expect(extractYears('5-8年经验')).toEqual({ min: 5, max: 8 })
    expect(extractYears('3年以上')).toEqual({ min: 3, max: 99 })
    expect(extractYears('需要 4 年相关经验')).toEqual({ min: 4, max: 99 })
    expect(extractYears('不限')).toBeNull()
  })

  it('学历取最高要求', () => {
    expect(extractEducation('本科及以上，硕士优先')).toBe('硕士')
    expect(extractEducation('统招本科')).toBe('本科')
    expect(extractEducation('学历不限')).toBe('不限')
  })

  it('薪资统一落到元/月', () => {
    expect(extractSalary('35-55K·15薪')).toEqual({ min: 35_000, max: 55_000 })
    expect(extractSalary('30k-50k')).toEqual({ min: 30_000, max: 50_000 })
    // 年薪写法要除以 12，否则薪资因子会虚高 12 倍
    expect(extractSalary('36-60万/年')).toEqual({ min: 30_000, max: 50_000 })
  })

  it('完整 JD 能抽齐五类信号', () => {
    const signals = extractJdSignals(JD, '高级前端工程师')
    expect(signals.tech.length).toBeGreaterThan(5)
    expect(signals.years).toEqual({ min: 5, max: 8 })
    expect(signals.education).toBe('本科')
    expect(signals.cities).toContain('杭州')
    expect(signals.salary).toEqual({ min: 35_000, max: 55_000 })
  })
})

describe('scoreFit', () => {
  it('匹配度高时给高分，并带可解释因子', () => {
    const result = scoreFit({ title: '高级前端工程师', jdText: JD, city: '杭州' }, RESUME)
    expect(result.score).toBeGreaterThanOrEqual(60)
    expect(result.capped).toBe(false)
    expect(result.factors.map((f) => f.key).sort()).toEqual(['city', 'domain', 'must', 'tech', 'years'])
    for (const factor of result.factors) {
      expect(factor.evidence.length).toBeGreaterThan(0)
    }
  })

  it('硬性条件不满足时封顶 40', () => {
    const junior: FitResume = {
      ...RESUME,
      personalInfo: { ...RESUME.personalInfo, workYears: '1年' },
      educations: [{ degree: '大专' }],
    }
    const result = scoreFit({ title: '高级前端工程师', jdText: JD, city: '杭州' }, junior)
    expect(result.capped).toBe(true)
    expect(result.score).toBeLessThanOrEqual(40)
  })

  it('缺失项不计入分母：JD 无年限、简历无城市时不会因此扣分', () => {
    const sparse = scoreFit(
      { title: '前端工程师', jdText: '熟悉 React、TypeScript、Node.js', city: null },
      {
        personalInfo: { jobTitle: '前端工程师' },
        skills: [{ name: 'React' }, { name: 'TypeScript' }, { name: 'Node.js' }],
      },
    )
    expect(sparse.factors.map((f) => f.key)).toEqual(['tech', 'domain'])
    expect(sparse.score).toBe(100)
  })

  it('同输入同输出（快照式断言，防止词表改动悄悄改变排序）', () => {
    const a = scoreFit({ title: '高级前端工程师', jdText: JD, city: '杭州' }, RESUME)
    const b = scoreFit({ title: '高级前端工程师', jdText: JD, city: '杭州' }, RESUME)
    expect(a).toEqual(b)
  })

  it('空 JD 不崩，返回 0 分而不是 NaN', () => {
    const result = scoreFit({ title: '', jdText: '', city: null }, {})
    expect(result.score).toBe(0)
    expect(Number.isNaN(result.score)).toBe(false)
  })

  it('canonicalTerm 折叠常见写法', () => {
    expect(canonicalTerm('React.js')).toBe('react')
    expect(canonicalTerm('K8S')).toBe('kubernetes')
    expect(canonicalTerm('  分布式  ')).toBe('分布式')
  })
})

describe('领域因子分词', () => {
  const domainOf = (title: string, jobTitle: string) => {
    const result = scoreFit(
      { title, jdText: '熟悉 TypeScript', city: null },
      { personalInfo: { jobTitle }, skills: [{ name: 'TypeScript' }] },
    )
    return result.factors.find((f) => f.key === 'domain')!
  }

  it('中文与拉丁字母接缝处补切：Agent工程师 要能对上 agent + 工程师', () => {
    // 只按空格切会得到「agent工程师」一个词，与简历侧两个词永远碰不上
    expect(domainOf('AI Agent工程师(A100447)', 'AI Agent 工程师').score).toBe(1)
  })

  it('岗位流水号不计入领域分母', () => {
    for (const title of ['AI Agent工程师(A100447)', 'AI Agent工程师 100447', 'AI Agent工程师(J12345)']) {
      expect(domainOf(title, 'AI Agent 工程师').score).toBe(1)
    }
  })

  it('反向接缝也切：资深React开发 / 高级前端工程师', () => {
    const factor = domainOf('资深React开发', 'React 开发')
    expect(factor.score).toBe(1)
  })

  it('领域真的不对口时仍然判 0，别把分词放宽成万能命中', () => {
    expect(domainOf('AI Agent工程师', '前端工程师').score).toBe(0)
  })

  it('角色后缀归一：研发工程师 / 研究员 与 工程师 算同一角色', () => {
    // 「资深Agent研发工程师」曾因「研发工程师」与「工程师」字面不同被判领域不符
    expect(domainOf('资深Agent研发工程师', 'AI Agent 工程师').score).toBe(1)
    expect(domainOf('Agent研究员', 'AI Agent 工程师').score).toBe(1)
  })

  it('只靠角色词对上不算同领域：算法工程师 ≠ 前端工程师', () => {
    expect(domainOf('算法工程师', '前端工程师').score).toBe(0)
  })
})

describe('AI Agent 词表', () => {
  it('能抽出 Agent 岗的核心词，而不是只认前端栈', () => {
    const terms = extractTechTerms('熟悉 LangChain / LlamaIndex，有 Function Calling 与 MCP 落地经验，做过 RAG 与 rerank')
    expect(terms).toContain('langchain')
    expect(terms).toContain('function calling')
    expect(terms).toContain('mcp')
    expect(terms).toContain('rag')
    expect(terms).toContain('rerank')
  })

  it('同一概念的多种写法归成一个词，不膨胀分母', () => {
    // 「AI Agent / Agentic / 多智能体」讲的是同一件事，算三个词会让分母凭空翻三倍
    const terms = extractTechTerms('AI Agent 方向，Agentic 架构，多智能体协作，智能体平台')
    expect(terms.filter((t) => t === 'agent')).toHaveLength(1)
    expect(terms).not.toContain('agentic')
  })

  it('Prompt Engineering 与 Prompt 是同一个词', () => {
    expect(extractTechTerms('Prompt Engineering 经验')).toEqual(['prompt'])
  })
})

describe('非技术词', () => {
  const JD = '负责 Agent 平台研发，与产品运营团队协作，关注用户增长，熟悉 React 与 Node.js'

  it('技术岗 JD 里顺带提到的运营/增长不计入技术因子', () => {
    const terms = extractTechTerms(JD)
    expect(terms).toContain('react')
    // 「运营」「增长」不是这名候选人的技术栈，抽出来只会变成永远命不中的分母
    expect(terms).not.toContain('运营')
    expect(terms).not.toContain('增长')
  })

  it('岗位本身就是产品运营岗时才计入', () => {
    expect(extractJdSignals(JD, '产品运营经理').tech).toContain('运营')
    expect(extractJdSignals(JD, 'Agent 研发工程师').tech).not.toContain('运营')
  })
})

describe('样本量保护', () => {
  it('JD 技术词不足 3 个时不评技术因子，避免 1/1 直接给满分', () => {
    // 正文没抓到的岗位只剩标题里的 agent，命中率是 100% 还是 0% 只反映样本量
    const result = scoreFit(
      { title: 'AI Agent 研究员', jdText: '', city: null },
      { personalInfo: { jobTitle: 'AI Agent 工程师' }, skills: [{ name: 'Agent' }] },
    )
    expect(result.factors.map((f) => f.key)).not.toContain('tech')
  })

  it('技术词够 3 个时正常评', () => {
    const result = scoreFit(
      { title: 'AI Agent 工程师', jdText: '熟悉 LangChain、Function Calling、MCP', city: null },
      { personalInfo: { jobTitle: 'AI Agent 工程师' }, skills: [{ name: 'LangChain' }] },
    )
    expect(result.factors.map((f) => f.key)).toContain('tech')
  })
})

describe('自我介绍参与打分', () => {
  const JOB = { title: '前端工程师', jdText: '熟悉 React、RAG、向量数据库', city: null }

  it('写在自我介绍里的技术词要能命中', () => {
    const base: FitResume = { personalInfo: { jobTitle: '前端工程师' }, skills: [{ name: 'React' }] }
    const withIntro: FitResume = {
      ...base,
      selfIntroduction: '熟悉 RAG 与向量数据库，独立做过 LLM 应用落地',
    }
    const techOf = (r: FitResume) => scoreFit(JOB, r).factors.find((f) => f.key === 'tech')!
    expect(techOf(base).score).toBeCloseTo(1 / 3)
    expect(techOf(withIntro).score).toBe(1)
    expect(techOf(withIntro).evidence).toContain('rag')
    expect(scoreFit(JOB, withIntro).score).toBeGreaterThan(scoreFit(JOB, base).score)
  })

  it('没有自我介绍时不报错、不影响结果', () => {
    const resume: FitResume = { personalInfo: { jobTitle: '前端工程师' }, skills: [{ name: 'React' }] }
    expect(() => scoreFit(JOB, resume)).not.toThrow()
  })
})
