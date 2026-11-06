/**
 * 种子数据：3 家公司 / 5 个岗位 / 2 份简历 / 3 条投递 / 1 场面试。
 *
 * 用固定 id，所以可以反复执行——已存在的记录直接跳过，不会产生重复。
 * 走的是真实 repository，不是裸 SQL：种子数据本身就是一次端到端自检。
 *
 *   npm run seed -w @land/server          首次写入
 *   npm run seed -w @land/server -- --reset  先清空种子记录再写（只删 seed-* 前缀）
 */
import { DB_FILE } from './config.js'
import { openDb } from './db/index.js'
import { createCompany, getCompany } from './db/repositories/company.js'
import { createJob, getJob } from './db/repositories/job.js'
import { createApplication } from './db/repositories/application.js'
import { createInterview } from './db/repositories/interview.js'
import { createResume, getResume } from './db/repositories/resume.js'

const daysFromNow = (days: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

const db = openDb(DB_FILE)

if (process.argv.includes('--reset')) {
  // 顺序必须服从外键：先删引用方（offer/事件/面试/投递），再删被引用方（简历/岗位/公司）。
  // 事件与面试的 id 是随机 uuid，所以按 application_id 反查，而不是按 id 前缀。
  const statements = [
    "DELETE FROM offer WHERE application_id LIKE 'seed-%'",
    "DELETE FROM application_event WHERE application_id LIKE 'seed-%'",
    "DELETE FROM interview WHERE id LIKE 'seed-%' OR application_id LIKE 'seed-%'",
    "DELETE FROM application WHERE id LIKE 'seed-%'",
    "DELETE FROM resume WHERE id LIKE 'seed-%'",
    "DELETE FROM job WHERE id LIKE 'seed-%'",
    "DELETE FROM company WHERE id LIKE 'seed-%'",
  ]
  db.transaction(() => {
    for (const sql of statements) db.prepare(sql).run()
  })()
  process.stdout.write('已清除 seed-* 记录\n')
}

const COMPANIES = [
  {
    id: 'seed-co-bytedance',
    name: '字节跳动',
    website: 'https://jobs.bytedance.com',
    industry: '互联网',
    size: '10000+',
    city: '北京',
    priority: 1,
    applyEntry: 'https://jobs.bytedance.com/experienced/position',
    notes: '流程快，三轮技术面 + HR；简历需体现高并发与稳定性经验。',
  },
  {
    id: 'seed-co-xhs',
    name: '小红书',
    website: 'https://job.xiaohongshu.com',
    industry: '互联网',
    size: '2000-9999',
    city: '上海',
    priority: 2,
    applyEntry: 'https://job.xiaohongshu.com/campus',
    notes: '社区业务线，前端重交互与性能。',
  },
  {
    id: 'seed-co-moonshot',
    name: '月之暗面',
    website: 'https://www.moonshot.cn',
    industry: '人工智能',
    size: '100-499',
    city: '北京',
    priority: 1,
    applyEntry: 'https://www.moonshot.cn/careers',
    notes: 'AI 应用方向，看重全栈能力与产品感。',
  },
] as const

const JOBS = [
  {
    id: 'seed-job-bd-fe',
    companyId: 'seed-co-bytedance',
    title: '高级前端工程师（增长方向）',
    city: '北京',
    level: '2-2',
    salaryMin: 35_000,
    salaryMax: 55_000,
    channel: 'official',
    jdUrl: 'https://jobs.bytedance.com/experienced/position/7000000000000000000/detail',
    jdText:
      '负责增长业务前端架构与性能优化。要求：5 年以上前端经验；精通 React / TypeScript；有大规模 To C 产品性能治理经验；熟悉埋点与 AB 实验体系优先。',
    keywords: ['React', 'TypeScript', '性能优化', 'AB 实验'],
    priority: 1,
  },
  {
    id: 'seed-job-bd-be',
    companyId: 'seed-co-bytedance',
    title: '服务端开发工程师（Go）',
    city: '北京',
    level: '2-1',
    salaryMin: 30_000,
    salaryMax: 50_000,
    channel: 'official',
    jdUrl: null,
    jdText: '负责推荐链路服务端开发。要求：熟悉 Go；有高并发服务经验；了解分布式存储与消息队列。',
    keywords: ['Go', '高并发', '分布式'],
    priority: 2,
  },
  {
    id: 'seed-job-xhs-fe',
    companyId: 'seed-co-xhs',
    title: '前端工程师（社区）',
    city: '上海',
    level: 'P6',
    salaryMin: 28_000,
    salaryMax: 45_000,
    channel: 'referral',
    jdUrl: 'https://job.xiaohongshu.com/position/100000',
    jdText: '社区内容消费场景前端开发。要求：3 年以上 React 经验；对交互细节敏感；有移动端性能优化经验。',
    keywords: ['React', '移动端', '交互'],
    priority: 2,
  },
  {
    id: 'seed-job-xhs-growth',
    companyId: 'seed-co-xhs',
    title: '增长前端工程师',
    city: '上海',
    level: 'P6',
    salaryMin: 30_000,
    salaryMax: 48_000,
    channel: 'official',
    jdUrl: null,
    jdText: '负责增长活动页与投放链路。要求：熟悉低代码/搭建体系；有活动页性能与转化优化经验。',
    keywords: ['低代码', '增长', '转化'],
    priority: 3,
  },
  {
    id: 'seed-job-ms-fullstack',
    companyId: 'seed-co-moonshot',
    title: '全栈工程师（AI 应用）',
    city: '北京',
    level: 'P7',
    salaryMin: 40_000,
    salaryMax: 70_000,
    channel: 'official',
    jdUrl: 'https://www.moonshot.cn/careers/fullstack',
    jdText:
      '负责 AI 应用从 0 到 1。要求：熟悉 TypeScript 全栈；有 LLM 应用落地经验（RAG / Agent / 工具调用）；能独立完成产品设计与实现。',
    keywords: ['TypeScript', 'LLM', 'Agent', '全栈'],
    priority: 1,
  },
] as const

/**
 * 简历正文必须是 resume-kit 的 ResumeData 结构（personalInfo / selfIntroduction /
 * experiences / educations / skills / projects / contacts）。
 * 服务端不 import resume-kit（它有 React 依赖），所以这里按同一结构手写；
 * apps/server/test/template-catalog.test.ts 会校验模板 id 一致。
 */
const RESUME_DATA = {
  personalInfo: {
    name: '示例用户',
    jobTitle: '前端工程师',
    workYears: '7年',
    city: '杭州',
    showAvatar: true,
    avatarShape: 'circle',
  },
  selfIntroduction: '7 年前端经验，主导过日活千万级产品的性能治理与增长链路建设。',
  experiences: [
    {
      id: 'seed-exp-1',
      period: '2021.03 - 至今',
      company: '某互联网公司',
      position: '前端技术专家',
      responsibilities: ['首屏 LCP 从 2.8s 降至 1.4s', '搭建增长活动页平台，交付效率提升 60%'],
    },
    {
      id: 'seed-exp-2',
      period: '2018.07 - 2021.02',
      company: '某创业公司',
      position: '前端工程师',
      responsibilities: ['从 0 搭建管理后台体系', '推动 TypeScript 全量迁移'],
    },
  ],
  educations: [
    {
      id: 'seed-edu-1',
      school: '某大学',
      degree: '本科',
      major: '计算机科学与技术',
      period: '2014.09 - 2018.06',
    },
  ],
  skills: [
    { id: 'seed-skill-1', name: 'TypeScript', description: '熟练掌握' },
    { id: 'seed-skill-2', name: 'React', description: '熟练掌握' },
    { id: 'seed-skill-3', name: 'Node.js', description: '熟悉' },
    { id: 'seed-skill-4', name: '性能优化', description: '有完整治理经验' },
  ],
  projects: [
    {
      id: 'seed-proj-1',
      name: '增长活动页平台',
      period: '2023.02 - 2023.09',
      role: '前端负责人',
      description: '面向运营的可视化活动页搭建平台，替代逐页手写。',
      details: '沉淀 20+ 区块物料，活动页平均交付时间从 3 天降到 4 小时。',
      technologies: ['React', 'TypeScript', 'Vite'],
    },
  ],
  contacts: [
    { id: 'seed-contact-1', platform: 'Email', value: 'demo@example.com' },
    { id: 'seed-contact-2', platform: 'Phone', value: '138-0000-0000' },
  ],
}

let created = 0
let skipped = 0

const exists = (check: () => unknown): boolean => {
  try {
    check()
    return true
  } catch {
    return false
  }
}

for (const company of COMPANIES) {
  if (exists(() => getCompany(db, company.id))) {
    skipped += 1
    continue
  }
  createCompany(db, { ...company })
  created += 1
}

for (const job of JOBS) {
  if (exists(() => getJob(db, job.id))) {
    skipped += 1
    continue
  }
  createJob(db, { ...job })
  created += 1
}

if (!exists(() => getResume(db, 'seed-resume-master'))) {
  createResume(db, {
    id: 'seed-resume-master',
    title: '前端工程师-母版',
    kind: 'master',
    templateId: 'classic',
    data: RESUME_DATA,
    isDefault: true,
  })
  created += 1
} else {
  skipped += 1
}

if (!exists(() => getResume(db, 'seed-resume-bd-fe'))) {
  createResume(db, {
    id: 'seed-resume-bd-fe',
    title: '字节-增长前端-定制版',
    kind: 'variant',
    templateId: 'template-1',
    data: {
      ...RESUME_DATA,
      selfIntroduction: '7 年前端经验，专注 To C 增长链路与大规模性能治理，主导 LCP 优化 50%。',
    },
    baseResumeId: 'seed-resume-master',
    jobId: 'seed-job-bd-fe',
    provenance: { skill: 'resume-tailor', version: '0.1.0', model: 'demo' },
  })
  created += 1
} else {
  skipped += 1
}

const APPLICATIONS = [
  {
    id: 'seed-app-bd-fe',
    jobId: 'seed-job-bd-fe',
    resumeId: 'seed-resume-bd-fe',
    status: 'interview' as const,
    channel: 'official' as const,
    appliedAt: daysFromNow(-9),
    confidence: 'confirmed' as const,
    notes: '内推人：张工（增长组）',
  },
  {
    id: 'seed-app-xhs-fe',
    jobId: 'seed-job-xhs-fe',
    resumeId: 'seed-resume-master',
    status: 'screening' as const,
    channel: 'referral' as const,
    appliedAt: daysFromNow(-4),
    confidence: 'reported' as const,
    notes: null,
  },
  {
    id: 'seed-app-ms-fullstack',
    jobId: 'seed-job-ms-fullstack',
    resumeId: null,
    status: 'queued' as const,
    channel: 'official' as const,
    appliedAt: null,
    confidence: 'reported' as const,
    notes: '等定制简历准备好再投',
  },
]

for (const application of APPLICATIONS) {
  const existing = db
    .prepare('SELECT id FROM application WHERE id = ? AND deleted_at IS NULL')
    .get(application.id)
  if (existing) {
    skipped += 1
    continue
  }
  createApplication(db, { ...application })
  created += 1
}

const hasInterview = db.prepare('SELECT id FROM interview WHERE id = ?').get('seed-interview-bd-1')
if (!hasInterview) {
  createInterview(db, {
    id: 'seed-interview-bd-1',
    applicationId: 'seed-app-bd-fe',
    round: 2,
    kind: 'tech',
    scheduledAt: daysFromNow(2),
    durationMin: 60,
    format: 'video',
    interviewer: '增长组 TL',
    location: '飞书会议',
    prepStatus: 'planned',
    notes: '重点准备：性能治理案例、AB 实验设计、跨团队协作。',
  })
  created += 1
} else {
  skipped += 1
}

process.stdout.write(
  `\n种子数据完成：新建 ${created} 条，跳过已存在 ${skipped} 条\n` +
    `数据库：${DB_FILE}\n` +
    `下一步：npm start 后打开 http://127.0.0.1:4399\n\n`,
)
db.close()
