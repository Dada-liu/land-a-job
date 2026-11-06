/**
 * fit 打分：纯规则、确定性、可解释（ARCHITECTURE 5.2）。
 *
 * 为什么不交给模型：这个分数决定「今天先投哪家」，必须离线可用、可复算、
 * 同样输入永远得到同样结果。Agent 只能通过 `fit_source='agent'` 覆盖，
 * 覆盖时规则分仍保留在 fit_reasons 里，事后能对比谁更准。
 */

/** 打分权重。缺项不计入分母，所以权重之和不必等 1 */
export const FIT_WEIGHTS = {
  must: 0.35,
  tech: 0.25,
  years: 0.15,
  domain: 0.1,
  city: 0.1,
  salary: 0.05,
} as const

export type FitFactorKey = keyof typeof FIT_WEIGHTS

/** JD 抽出的技术词少于这个数就不评技术因子：样本太少时命中率是噪声，不是匹配度 */
const MIN_JD_TECH_TERMS = 3

export interface FitFactor {
  key: FitFactorKey
  weight: number
  /** 0..1 */
  score: number
  /** 给用户看的一句话证据，不要写"因子 1 得分 0.6" */
  evidence: string
}

export interface FitResult {
  score: number
  factors: FitFactor[]
  /** 硬性条件不满足 → 封顶 40，避免"技能全中但学历不符"排到最前 */
  capped: boolean
  /** 抽取出的 JD 信号，详情页与定制简历直接用 */
  signals: JdSignals
}

export interface JdSignals {
  tech: string[]
  years: { min: number; max: number } | null
  education: EducationLevel | null
  cities: string[]
  salary: { min: number | null; max: number | null } | null
}

export const EDUCATION_LEVELS = ['不限', '大专', '本科', '硕士', '博士'] as const
export type EducationLevel = (typeof EDUCATION_LEVELS)[number]

const EDUCATION_RANK: Record<EducationLevel, number> = {
  不限: 0,
  大专: 1,
  本科: 2,
  硕士: 3,
  博士: 4,
}

/**
 * 常见技术栈词表。命中判定用「前后不是字母数字」的边界，
 * 因此 `react` 不会误命中 `reactive`，`go` 不会误命中 `google`。
 */
export const TECH_TERMS: readonly string[] = [
  // 语言
  'javascript', 'typescript', 'python', 'java', 'golang', 'go', 'rust', 'c++', 'c#', 'c', 'kotlin',
  'swift', 'objective-c', 'php', 'ruby', 'scala', 'elixir', 'erlang', 'dart', 'lua', 'perl', 'r',
  'matlab', 'shell', 'bash', 'powershell', 'sql', 'html', 'css', 'sass', 'less', 'webassembly',
  // 前端
  'react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'remix', 'astro', 'vite', 'webpack',
  'rollup', 'esbuild', 'babel', 'tailwind', 'tailwindcss', 'redux', 'zustand', 'mobx', 'jotai',
  'react query', 'swr', 'react router', 'd3', 'three.js', 'echarts', 'antd', 'element ui',
  'jquery', 'electron', 'tauri', 'pwa', 'ssr', 'seo', 'webgl', 'canvas', 'websocket',
  // 后端 / 运行时
  'node.js', 'deno', 'bun', 'express', 'koa', 'fastify', 'nest.js', 'nestjs', 'spring', 'spring boot',
  'django', 'flask', 'fastapi', 'tornado', 'rails', 'laravel', 'gin', 'echo', 'fiber', 'actix',
  'axum', 'grpc', 'rest', 'graphql', 'trpc', 'openapi', 'swagger',
  // 数据存储
  'mysql', 'postgresql', 'postgres', 'sqlite', 'oracle', 'sql server', 'mongodb', 'redis',
  'elasticsearch', 'clickhouse', 'hbase', 'cassandra', 'neo4j', 'tidb', 'oceanbase', 'dynamodb',
  'kafka', 'rabbitmq', 'rocketmq', 'pulsar', 'nats', 'zookeeper', 'etcd', 'minio',
  // 基础设施
  'docker', 'kubernetes', 'k8s', 'helm', 'istio', 'terraform', 'ansible', 'jenkins', 'gitlab ci',
  'github actions', 'argo cd', 'prometheus', 'grafana', 'loki', 'opentelemetry', 'jaeger',
  'nginx', 'envoy', 'linux', 'unix', 'aws', 'azure', 'gcp', 'aliyun', '阿里云', '腾讯云',
  'serverless', 'faas', 'paas', 'cdn', 'dns', 'tcp', 'http', 'https', 'quic', 'vpn',
  // 数据 / 算法
  'pandas', 'numpy', 'scipy', 'pytorch', 'tensorflow', 'keras', 'sklearn', 'xgboost', 'lightgbm',
  'spark', 'hadoop', 'flink', 'hive', 'airflow', 'dbt', 'etl', 'olap', '数据仓库', '数据湖',
  '机器学习', '深度学习', '推荐系统', '自然语言处理', 'nlp', '计算机视觉', 'cv', 'llm',
  '大模型', 'rag', '向量数据库', 'transformer', 'a/b test', 'ab test', '数据治理', '数据建模',
  // AI / LLM 应用
  // 这一组原先整个缺失，导致 Agent 岗的 JD 抽不出自己的核心词：
  // 小米那份 JD 只抽出 6 个技术词、命中 4 个，而「Function Calling / Memory / Planner / RAG」
  // 这些真正的考点一个都没进分母，技术因子等于在拿前端词表评 AI 岗。
  'agent', 'ai agent', 'agentic', 'multi-agent', '多 agent', '智能体', '多智能体',
  'langchain', 'llamaindex', 'autogen', 'crewai', 'dify', 'coze', 'n8n',
  'function calling', 'tool calling', 'tool use', 'prompt', 'prompt engineering',
  'context engineering', 'mcp', 'a2a', 'planner', 'memory',
  '检索增强', 'embedding', 'vector database', 'rerank', '混合检索',
  'fine-tune', 'finetune', '微调', 'sft', 'rlhf', 'dpo', 'lora',
  'vllm', 'sglang', 'ollama', 'tensorrt', 'cuda', 'gpu',
  'eval', '评测', 'swe-bench', 'benchmark', '多模态', 'multimodal', 'chain of thought',
  // 移动端 / 客户端
  'android', 'ios', 'flutter', 'react native', 'weex', 'uniapp', '小程序', '微信小程序',
  'harmonyos', '鸿蒙', 'unity', 'unreal',
  // 工程能力
  'ci/cd', 'devops', 'devsecops', 'tdd', 'unit test', 'code review', 'agile', 'scrum', 'kanban',
  'ddd', '微服务', '分布式', '高并发', '高可用', '性能优化', '重构', '架构设计', '技术架构', '技术方案',
  '安全', '渗透测试', '加密', '认证', 'oauth', 'jwt', 'sso', 'rbac',
  // 产品 / 协作工具（技术岗也要用，算技术词）
  'figma', 'sketch', 'axure', 'jira', 'confluence', 'git', 'svn', 'monorepo', 'npm', 'pnpm', 'yarn',
  '需求分析', '数据分析',
] as const

/**
 * 非技术岗的词：产品、运营、增长、项目管理。
 *
 * 它们对技术岗是纯噪声——JD 里提一句「与产品运营团队协作」，技术因子就多一个
 * 永远命不中的分母，白扣分。所以默认不参与匹配，只有岗位本身就是这类岗位时才计入。
 */
export const NON_TECH_TERMS: readonly string[] = [
  '产品设计', '产品运营', '用户研究', '增长黑客', '增长', '运营', '项目管理', 'pmp',
] as const

/** 岗位本身就是产品/运营/设计/项目管理岗时，才把非技术词纳入技术因子 */
const NON_TECH_ROLE_RE = /产品经理|产品运营|产品设计|运营专员|增长黑客|用户研究|交互设计|视觉设计|项目经理|项目管理岗/

/**
 * 同义写法归一：JD 里写 React.js，简历里写 react，应该算命中。
 *
 * 这里刻意不收 `js` / `ts` / `node` 这类过短的别名：
 * `next.js` 里的 `js` 会被当成 javascript 命中，反而污染评分。
 */
const ALIASES: Record<string, string> = {
  'react.js': 'react',
  reactjs: 'react',
  'vue.js': 'vue',
  vuejs: 'vue',
  nextjs: 'next.js',
  nuxtjs: 'nuxt',
  nodejs: 'node.js',
  golang: 'go',
  k8s: 'kubernetes',
  postgres: 'postgresql',
  tailwindcss: 'tailwind',
  nestjs: 'nest.js',
  'ab test': 'a/b test',
  微服务架构: '微服务',
  机器学习算法: '机器学习',
  // AI 词的同义写法必须归到一个主名，否则一份 JD 里「AI Agent / Agentic / 多智能体」
  // 会被算成三个不同的技术词，分母凭空膨胀三倍，而简历侧只写了一种写法。
  'ai agent': 'agent',
  agentic: 'agent',
  'multi-agent': 'agent',
  'multiagent': 'agent',
  '多 agent': 'agent',
  '多agent': 'agent',
  智能体: 'agent',
  多智能体: 'agent',
  'prompt engineering': 'prompt',
  'tool calling': 'function calling',
  'tool use': 'function calling',
  finetune: '微调',
  'fine-tune': '微调',
  检索增强: 'rag',
  检索增强生成: 'rag',
  'vector database': '向量数据库',
  multimodal: '多模态',
  评测: 'eval',
  技术架构: '架构设计',
  系统架构: '架构设计',
  llm应用: 'llm',
  大语言模型: '大模型',
}

/** 归一化：小写、全角括号、多余空格；并把别名折到主名 */
export function canonicalTerm(raw: string): string {
  const lowered = raw
    .toLowerCase()
    .replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'))
    .replace(/\s+/g, ' ')
    .trim()
  return ALIASES[lowered] ?? lowered
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 词的边界判定：左右不能紧邻字母或数字。
 *
 * 不用 \b，因为 \b 是 ASCII 词边界，中文「使用React开发」里 React 左边是汉字，
 * \b 会认为存在边界（碰巧成立），而「reactjs」又不该命中 react（也碰巧成立）——
 * 靠巧合工作的正则在换个 JD 模板后就会出错，这里显式写清楚。
 */
function termPattern(term: string): RegExp {
  const body = escapeRegExp(term).replace(/\\ /g, '[\\s-]?')
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i')
}

/** 词表 + 别名键都参与匹配，命中后统一折成主名 */
const TECH_SOURCES = [...new Set<string>([...TECH_TERMS, ...Object.keys(ALIASES)])]

const MATCHERS: { term: string; re: RegExp; nonTech: boolean }[] = [
  ...TECH_SOURCES.map((term) => ({ term: canonicalTerm(term), re: termPattern(term), nonTech: false })),
  ...NON_TECH_TERMS.map((term) => ({ term: canonicalTerm(term), re: termPattern(term), nonTech: true })),
]

export interface ExtractTechOptions {
  /**
   * 是否把产品/运营/管理类词也算进来。
   * 只该在岗位本身是这类岗位时为 true——技术岗 JD 里顺带提一句「与运营团队协作」
   * 不该变成技术因子里一个永远命不中的分母。
   */
  includeNonTech?: boolean
}

/**
 * 从一段文本里抽出命中的技术词。
 *
 * 按「在文本里首次出现的先后」排序，而不是按词表顺序：
 * JD 把 React 写在第一条、Node.js 写在第四条，就说明前者更重要——
 * 排序信息会一路用到定制简历的技能重排上。
 */
export function extractTechTerms(text: string, options: ExtractTechOptions = {}): string[] {
  if (!text) return []
  const hits = new Map<string, number>()
  for (const { term, re, nonTech } of MATCHERS) {
    if (nonTech && !options.includeNonTech) continue
    const match = re.exec(text)
    if (!match || match.index === undefined) continue
    const canonical = canonicalTerm(term)
    const previous = hits.get(canonical)
    if (previous === undefined || match.index < previous) hits.set(canonical, match.index)
  }
  return [...hits.entries()].sort((a, b) => a[1] - b[1]).map(([term]) => term)
}

const CITY_NAMES = [
  '北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '武汉', '西安', '苏州', '天津', '重庆',
  '长沙', '郑州', '合肥', '厦门', '福州', '济南', '青岛', '大连', '沈阳', '哈尔滨', '长春',
  '东莞', '佛山', '珠海', '无锡', '宁波', '常州', '南昌', '昆明', '贵阳', '石家庄', '太原',
  '香港', '新加坡', '远程',
] as const

/** 年限：优先取区间，其次「N 年以上」，最后「N 年经验」 */
export function extractYears(text: string): { min: number; max: number } | null {
  if (!text) return null
  const range = /(\d{1,2})\s*[-~至到]\s*(\d{1,2})\s*年/.exec(text)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (min <= max) return { min, max }
  }
  const above = /(\d{1,2})\s*年(?:及)?以上/.exec(text)
  if (above) return { min: Number(above[1]), max: 99 }
  const atLeast = /至少\s*(\d{1,2})\s*年/.exec(text)
  if (atLeast) return { min: Number(atLeast[1]), max: 99 }
  const plain = /(\d{1,2})\s*年.{0,6}(?:经验|工作经历)/.exec(text)
  if (plain) return { min: Number(plain[1]), max: 99 }
  return null
}

export function extractEducation(text: string): EducationLevel | null {
  if (!text) return null
  // 从高到低判：JD 常写「本科及以上」，也可能写「硕士优先」
  if (/博士/.test(text)) return '博士'
  if (/硕士|研究生/.test(text)) return '硕士'
  if (/本科|学士|统招/.test(text)) return '本科'
  if (/大专|专科/.test(text)) return '大专'
  if (/学历不限|不限学历/.test(text)) return '不限'
  return null
}

/** 薪资：`30-50K`、`30k-50k·15薪`、`2-3万`、`30-50万/年` 都能落成「元/月」 */
export function extractSalary(text: string): { min: number | null; max: number | null } | null {
  if (!text) return null
  // 后一个单位必须存在（`30k-50k` 两处都有、`35-55K` 只在末尾有），
  // 否则 `5-8 年` 这类年限写法会被误判成薪资
  const kRange = /(\d{1,3}(?:\.\d)?)\s*[kK千]?\s*[-~至到]\s*(\d{1,3}(?:\.\d)?)\s*[kK千]/.exec(text)
  if (kRange) {
    return { min: Math.round(Number(kRange[1]) * 1000), max: Math.round(Number(kRange[2]) * 1000) }
  }
  const wanRange = /(\d{1,3}(?:\.\d)?)\s*[wW万]?\s*[-~至到]\s*(\d{1,3}(?:\.\d)?)\s*万/.exec(text)
  if (wanRange) {
    const min = Number(wanRange[1])
    const max = Number(wanRange[2])
    // 「30-50万/年」是年薪，「3-5万」多半是月薪：以 12 为分界猜，宁可少算不要算错
    const annual = max >= 12
    const factor = annual ? 10_000 / 12 : 10_000
    return { min: Math.round(min * factor), max: Math.round(max * factor) }
  }
  const kSingle = /(\d{1,3})\s*[kK]\s*(?:以上|\+)/.exec(text)
  if (kSingle) return { min: Number(kSingle[1]) * 1000, max: null }
  return null
}

/** 从 JD 正文（+ 标题）抽全部信号 */
export function extractJdSignals(jdText: string, title = ''): JdSignals {
  const text = `${title}\n${jdText ?? ''}`
  const cities = CITY_NAMES.filter((city) => text.includes(city))
  return {
    tech: extractTechTerms(text, { includeNonTech: NON_TECH_ROLE_RE.test(title) }),
    years: extractYears(text),
    education: extractEducation(text),
    cities,
    salary: extractSalary(text),
  }
}

/* --------------------------------- 简历侧 -------------------------------- */

/**
 * 只声明打分用得到的字段，避免 core 依赖 resume-kit（依赖方向必须是 kit → core）。
 *
 * 同时兼容两套命名：`resume-kit` 的 ResumeData 用 `position` / `responsibilities`，
 * 旧 JSON 与 Agent 产出常用 `role` / `description`。打分逻辑不该因为字段叫法不同
 * 就少算一半证据，所以两种都认。
 */
export interface FitResume {
  personalInfo?: { name?: string; jobTitle?: string | null; workYears?: string | null; city?: string | null } | null
  /**
   * 自我介绍。它不是装饰段落：候选人最常把「熟悉 RAG、LangChain、多 Agent 编排」
   * 这类总结写在这里而不重复进技能栏，此前不参与打分等于白写。
   */
  selfIntroduction?: string | null
  educations?: { degree?: string | null; school?: string | null }[] | null
  skills?: { name?: string | null; level?: string | null; description?: string | null }[] | null
  projects?: {
    name?: string | null
    description?: string | null
    details?: string | null
    technologies?: string[] | null
  }[] | null
  experiences?: {
    company?: string | null
    /** resume-kit 用 position，旧数据用 role */
    position?: string | null
    role?: string | null
    description?: string | null
    /** resume-kit 用 responsibilities 数组 */
    responsibilities?: string[] | null
  }[] | null
}

export interface FitJob {
  title?: string | null
  jdText?: string | null
  keywords?: string[] | null
  city?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  level?: string | null
}

export interface FitOptions {
  /** 期望月薪（元）。填了才算薪资因子，没填不占分母 */
  expectedSalary?: number | null
  /** JD 里明确写的「必须」条件，由调用方补充（如自定义硬性门槛） */
  mustHave?: string[]
}

/** 简历正文 → 一组可匹配的技术词（自我介绍 + skills + projects + 经历里出现的技术词） */
export function resumeTechTerms(resume: FitResume): string[] {
  const bag: string[] = []
  if (resume.selfIntroduction) bag.push(resume.selfIntroduction)
  for (const skill of resume.skills ?? []) {
    if (skill?.name) bag.push(skill.name)
    if (skill?.description) bag.push(skill.description)
  }
  for (const project of resume.projects ?? []) {
    if (project?.name) bag.push(project.name)
    if (project?.description) bag.push(project.description)
    if (project?.details) bag.push(project.details)
    for (const tech of project?.technologies ?? []) bag.push(tech)
  }
  for (const exp of resume.experiences ?? []) {
    if (exp?.description) bag.push(exp.description)
    if (exp?.position) bag.push(exp.position)
    if (exp?.role) bag.push(exp.role)
    for (const line of exp?.responsibilities ?? []) bag.push(line)
  }
  const text = bag.join('\n')
  const explicit = new Set(bag.map(canonicalTerm))
  return [...new Set([...extractTechTerms(text), ...explicit])].filter(Boolean)
}

function parseWorkYears(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = /(\d{1,2}(?:\.\d)?)/.exec(raw)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function highestDegree(resume: FitResume): EducationLevel | null {
  let best: EducationLevel | null = null
  for (const edu of resume.educations ?? []) {
    const level = extractEducation(edu?.degree ?? '')
    if (!level) continue
    if (!best || EDUCATION_RANK[level] > EDUCATION_RANK[best]) best = level
  }
  return best
}

/** 纯编号：`A100447`、`100447`、`J12345` 这类岗位流水号，不承载任何领域信息 */
const JOB_CODE_RE = /^[a-z]{0,2}\d{3,}$/

/**
 * 标题里的修饰词：「资深 AI Agent 工程师」与「AI Agent 工程师」是同一个领域，
 * 但前者多一个词就把领域分压到 3/4。这些词既不是角色也不是技术栈，一律不算分母。
 */
const TITLE_NOISE = new Set([
  '资深', '高级', '中级', '初级', '专家', '急招', '诚聘', '招聘',
  '全职', '兼职', '实习', '实习生', '校招', '社招', '远程', '外包', '高薪',
  '团队', '方向', '事业部', '部门', '小组', '岗位', '职位', 'multi', 'junior', 'senior', 'lead',
])

/** 角色后缀：`工程师` / `架构师` / `研究员` / `开发者`，以及英文写法 */
const ROLE_TAIL_RE = /(?:工程师|架构师|研究员|程序员|开发者|engineer|developer|architect|researcher|scientist)$/

/**
 * 剥掉角色后缀、再剥掉一层「开发/研发/工程」之后只剩这些词，说明它本身不含领域信息。
 *
 * 刻意不含「前端」「算法」「后端」——它们是有领域含义的，必须保留下来参与比较，
 * 否则「算法工程师」和「前端工程师」会被归一成同一个 role，领域因子彻底失效。
 */
const ROLE_MODIFIER_RE = /^(?:技术|软件|程序|系统|平台|基础架构|tech|software|platform|system)$/

/**
 * 中文岗位名没有空格，「研发工程师」「研究员」「架构师」各写各的，
 * 而简历侧往往只写「工程师」——两边永远碰不上，同岗位被判成领域不符。
 *
 * 统一折成 `role`；带领域前缀的保留前缀（算法工程师 → 算法、全栈开发工程师 → 全栈），
 * 这样「算法工程师」与「前端工程师」仍然是两个领域。
 */
function foldRoleToken(token: string): string {
  const matched = ROLE_TAIL_RE.exec(token)
  if (!matched) return token
  const head = token.slice(0, matched.index).replace(/(?:开发|研发|工程)$/, '')
  return !head || ROLE_MODIFIER_RE.test(head) ? 'role' : head
}

/**
 * 分词：标题按空格/顿号/斜杠切，用于判断领域是否对口。
 *
 * 中文与拉丁字母的接缝要补切一刀：招聘站标题常写成「AI Agent工程师」，
 * 只按空格切会得到 `agent工程师` 一个词，而简历侧「AI Agent 工程师」是
 * `agent` + `工程师` 两个词，两边永远碰不上，领域因子被判 0。
 * 反过来「资深React开发」也要切成 `资深` / `react` / `开发`。
 *
 * 纯编号与修饰词一并剔掉——`AI Agent工程师(A100447)` 的流水号若算进分母，
 * 领域分最高只能到 3/4，白扣一次。
 */
function titleTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/(?<=[\u4e00-\u9fff])(?=[a-z0-9])|(?<=[a-z0-9])(?=[\u4e00-\u9fff])/g, ' ')
    .split(/[\s/、,，·|()（）\-]+/)
    .filter((token) => token.length >= 2 && !JOB_CODE_RE.test(token) && !TITLE_NOISE.has(token))
    // 先折别名再折角色：「Agentic Engineer」里的 Agentic 与 Agent 是同一个方向，
    // 不做这一步，标题侧写 Agentic、简历侧写 Agent 就永远对不上。
    .map((token) => canonicalTerm(token))
    .map(foldRoleToken)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 主入口：确定性打分。
 *
 * 缺失项（JD 没写年限、简历没写城市）直接从分母里去掉，
 * 否则「信息不全」会被当成「不满足」，把候选岗位无端压低。
 */
export function scoreFit(job: FitJob, resume: FitResume, options: FitOptions = {}): FitResult {
  const signals = extractJdSignals(job.jdText ?? '', job.title ?? '')
  const resumeTerms = new Set(resumeTechTerms(resume))
  const factors: FitFactor[] = []

  /* 硬性条件：学历 + 年限。命中率 < 1 时封顶 */
  const mustParts: { ok: boolean; text: string }[] = []
  const jdDegree = signals.education
  const myDegree = highestDegree(resume)
  if (jdDegree && jdDegree !== '不限' && myDegree) {
    const ok = EDUCATION_RANK[myDegree] >= EDUCATION_RANK[jdDegree]
    mustParts.push({ ok, text: `学历要求${jdDegree}，你${myDegree}` })
  }
  const years = signals.years
  const myYears = parseWorkYears(resume.personalInfo?.workYears)
  if (years && myYears !== null) {
    const ok = myYears >= years.min
    const range = years.max >= 99 ? `${years.min} 年以上` : `${years.min}-${years.max} 年`
    mustParts.push({ ok, text: `要求 ${range}经验，你 ${round1(myYears)} 年` })
  }
  for (const item of options.mustHave ?? []) {
    const term = canonicalTerm(item)
    mustParts.push({ ok: resumeTerms.has(term), text: `必须项「${item}」${resumeTerms.has(term) ? '已命中' : '未命中'}` })
  }
  if (mustParts.length > 0) {
    const hit = mustParts.filter((p) => p.ok).length / mustParts.length
    factors.push({
      key: 'must',
      weight: FIT_WEIGHTS.must,
      score: hit,
      evidence: mustParts.map((p) => `${p.ok ? '✓' : '✗'} ${p.text}`).join('；'),
    })
  }

  /* 技术匹配 */
  const jdTechRaw = signals.tech.length > 0 ? signals.tech : (job.keywords ?? []).map(canonicalTerm)
  /**
   * 技术词太少时不评这一项。
   *
   * JD 正文没抓到时只能从标题抽词，「AI Agent 研究员」只剩 agent 一个——
   * 命中它就是 100%，没命中就是 0%，这个数字只反映样本量，不反映匹配度。
   * 与「缺失项不计入分母」同一条原则：信息不足时不猜。
   */
  const jdTech = jdTechRaw.length >= MIN_JD_TECH_TERMS ? jdTechRaw : []
  if (jdTech.length > 0) {
    const matched = jdTech.filter((term) => resumeTerms.has(term))
    const missing = jdTech.filter((term) => !resumeTerms.has(term))
    factors.push({
      key: 'tech',
      weight: FIT_WEIGHTS.tech,
      score: matched.length / jdTech.length,
      evidence:
        `JD 技术词 ${jdTech.length} 个，命中 ${matched.length} 个` +
        (matched.length > 0 ? `（${matched.slice(0, 6).join('、')}）` : '') +
        (missing.length > 0 ? `；缺 ${missing.slice(0, 6).join('、')}` : ''),
    })
  }

  /* 年限匹配：低于下限线性衰减，超出上限轻微扣分（资深应聘初级岗反而易被拒） */
  if (years && myYears !== null) {
    let score: number
    if (myYears < years.min) {
      score = years.min === 0 ? 1 : Math.max(0, myYears / years.min)
    } else if (years.max < 99 && myYears > years.max) {
      score = Math.max(0.6, 1 - (myYears - years.max) * 0.1)
    } else {
      score = 1
    }
    factors.push({
      key: 'years',
      weight: FIT_WEIGHTS.years,
      score,
      evidence: `你 ${round1(myYears)} 年 vs 要求 ${years.max >= 99 ? `${years.min}+` : `${years.min}-${years.max}`} 年`,
    })
  }

  /* 领域匹配：岗位标题与简历目标岗位/经历角色的词重叠 */
  const jobTokens = titleTokens(job.title ?? '')
  const resumeTokens = new Set([
    ...titleTokens(resume.personalInfo?.jobTitle ?? ''),
    ...(resume.experiences ?? []).flatMap((exp) => titleTokens(exp?.position ?? exp?.role ?? '')),
  ])
  if (jobTokens.length > 0 && resumeTokens.size > 0) {
    const overlap = jobTokens.filter((token) => resumeTokens.has(token))
    // 「工程师」对上了「研发工程师」只说明都是技术岗，不等于同领域：
    // 必须有一个非 role 词重合，否则算法岗与前端岗会因为共用角色词而互相满分。
    const domainHit = overlap.filter((token) => token !== 'role')
    const score = domainHit.length === 0 ? 0 : overlap.length / jobTokens.length
    factors.push({
      key: 'domain',
      weight: FIT_WEIGHTS.domain,
      score,
      evidence:
        domainHit.length > 0
          ? `岗位与经历重合：${domainHit.join('、')}`
          : `岗位「${job.title}」在简历里没有直接对应角色`,
    })
  }

  /* 城市匹配 */
  const jobCity = (job.city ?? signals.cities[0] ?? '').replace(/市$/, '')
  const myCity = (resume.personalInfo?.city ?? '').replace(/市$/, '')
  if (jobCity && myCity) {
    const same = jobCity === myCity
    const remote = jobCity.includes('远程') || myCity.includes('远程')
    factors.push({
      key: 'city',
      weight: FIT_WEIGHTS.city,
      score: same || remote ? 1 : 0.4,
      evidence: same ? `同在${myCity}` : remote ? '支持远程' : `岗位在${jobCity}，你在${myCity}`,
    })
  }

  /* 薪资匹配：只有给了期望月薪才算 */
  const expected = options.expectedSalary
  const jobMax = job.salaryMax ?? signals.salary?.max ?? null
  const jobMin = job.salaryMin ?? signals.salary?.min ?? null
  if (expected && jobMax) {
    const ratio = jobMax / expected
    const score = ratio >= 1 ? 1 : Math.max(0, ratio)
    factors.push({
      key: 'salary',
      weight: FIT_WEIGHTS.salary,
      score,
      evidence: `岗位上限 ${(jobMax / 1000).toFixed(0)}K vs 期望 ${(expected / 1000).toFixed(0)}K` +
        (jobMin ? `（下限 ${(jobMin / 1000).toFixed(0)}K）` : ''),
    })
  }

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0)
  const raw = totalWeight === 0 ? 0 : factors.reduce((sum, f) => sum + f.weight * f.score, 0) / totalWeight
  const capped = factors.some((f) => f.key === 'must' && f.score < 1)
  const score = Math.round((capped ? Math.min(raw * 100, 40) : raw * 100))

  return { score: Math.max(0, Math.min(100, score)), factors, capped, signals }
}

/** 因子中文名：服务端写进 fit_reasons、前端 tooltip 直接复用，避免两处各写一套 */
export const FIT_FACTOR_LABELS: Record<FitFactorKey, string> = {
  must: '硬性条件',
  tech: '技术匹配',
  years: '年限',
  domain: '领域',
  city: '城市',
  salary: '薪资',
}

/**
 * 把因子序列化成给人看的字符串数组，存进 `job.fit_reasons`。
 *
 * 存字符串而不是对象是有意的：MCP 工具返回、列表 tooltip、导出报告都直接展示，
 * 结构化数据留在 fit 计算结果里即可，库表不需要为它加 JSON 列。
 */
export function formatFitReasons(factors: FitFactor[]): string[] {
  return factors.map((factor) => `${FIT_FACTOR_LABELS[factor.key]} ${Math.round(factor.score * 100)}｜${factor.evidence}`)
}

/** 一句话解释，列表 tooltip 用 */
export function explainFit(result: FitResult): string {
  const weakest = [...result.factors].sort((a, b) => a.score - b.score)[0]
  const strongest = [...result.factors].sort((a, b) => b.score - a.score)[0]
  const parts: string[] = []
  if (result.capped) parts.push('硬性条件未完全满足，分数已封顶 40')
  if (strongest) parts.push(`强项：${strongest.evidence}`)
  if (weakest && weakest !== strongest) parts.push(`弱项：${weakest.evidence}`)
  return parts.join('｜')
}
