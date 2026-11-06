import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { compareOffers, formatMoney, type OfferLike } from '@land/core'
import { client } from './client.js'

/**
 * MCP 资源（P5-6）。
 *
 * 资源与工具的区别不是格式，而是**成本**：资源是 Agent 按需 Read 的快照，
 * 不占工具列表；`land://today` 这种「一眼看全貌」的东西做成资源，
 * 比让 Agent 连调三个工具更省上下文。
 */

const text = (uri: URL | string, body: string) => ({
  contents: [{ uri: String(uri), mimeType: 'text/markdown', text: body }],
})

function table(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

interface DashboardPayload {
  northStar: { label: string; value: number; target: number }
  week: { submitted: number; effective: number; newJobs: number }
  funnel: { label: string; reached: number; conversion: number | null }[]
  today: { kind: string; companyName?: string; jobTitle?: string; reason: string; priority: string }[]
  upcoming: { interviews: number; offersPending: number }
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    'today',
    'land://today',
    {
      title: '今日速览',
      description: '今日面试、待跟进、待确认提交、offer 倒计时（Markdown）',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const dashboard = await client.get<DashboardPayload>('/stats/dashboard')
      const lines = [
        `# 今日速览`,
        ``,
        `- ${dashboard.northStar.label}：**${dashboard.northStar.value}** / 目标 ${dashboard.northStar.target}`,
        `- 本周已投：${dashboard.week.submitted}（有效 ${dashboard.week.effective}）｜新增岗位 ${dashboard.week.newJobs}`,
        `- 近期面试 ${dashboard.upcoming.interviews} 场｜待定 offer ${dashboard.upcoming.offersPending} 份`,
        ``,
        `## 待办（${dashboard.today.length}）`,
        ...(dashboard.today.length === 0
          ? ['暂无。可以考虑补投或推进已有岗位。']
          : dashboard.today.map(
              (task, index) =>
                `${index + 1}. [${task.priority}] ${task.companyName ?? ''} ${task.jobTitle ?? ''} — ${task.reason}`,
            )),
      ]
      return text(uri, lines.join('\n'))
    },
  )

  server.registerResource(
    'pipeline',
    'land://pipeline',
    {
      title: '投递看板',
      description: '所有活跃投递的紧凑表（状态、公司、岗位、在状态天数）',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const rows = await client.get<Record<string, unknown>[]>('/applications?active=true&limit=200')
      const body = table(
        ['状态', '公司', '岗位', '在状态天数', '下一步'],
        rows.map((row) => [
          String(row.status ?? ''),
          String(row.companyName ?? '—'),
          String(row.jobTitle ?? '—'),
          String(row.daysInStatus ?? '—'),
          (Array.isArray(row.nextStatuses) ? (row.nextStatuses as string[]).join(' / ') : '—') || '—',
        ]),
      )
      return text(uri, `# 投递看板（${rows.length} 条活跃）\n\n${body}`)
    },
  )

  server.registerResource(
    'job',
    new ResourceTemplate('land://job/{id}', { list: undefined }),
    {
      title: '岗位详情',
      description: '岗位 JD 全文 + 关键词 + fit 因子',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      const job = await client.get<Record<string, unknown>>(`/jobs/${String(id)}`)
      const reasons = Array.isArray(job.fitReasons) ? (job.fitReasons as string[]) : []
      const keywords = Array.isArray(job.keywords) ? (job.keywords as string[]) : []
      const body = [
        `# ${String(job.title ?? '岗位')}`,
        ``,
        `- fit：${String(job.fitScore ?? '—')}（来源 ${String(job.fitSource ?? 'rule')}）`,
        `- 城市：${String(job.city ?? '—')}｜薪资：${String(job.salaryMin ?? '—')}–${String(job.salaryMax ?? '—')}`,
        `- 关键词：${keywords.join('、') || '—'}`,
        ``,
        reasons.length > 0 ? `## fit 因子\n\n${reasons.map((item) => `- ${item}`).join('\n')}` : '',
        ``,
        `## JD 全文`,
        ``,
        String(job.jdText ?? '（未抓取）'),
      ]
      return text(uri, body.filter((line) => line !== '').join('\n'))
    },
  )

  server.registerResource(
    'resume',
    new ResourceTemplate('land://resume/{id}', { list: undefined }),
    {
      title: '简历全文',
      description: '简历正文的 Markdown 渲染，便于 Agent 直接阅读与改写',
      mimeType: 'text/markdown',
    },
    async (uri, variables) => {
      const id = Array.isArray(variables.id) ? variables.id[0] : variables.id
      const resume = await client.get<{ title: string; kind: string; data: Record<string, unknown> }>(
        `/resumes/${String(id)}`,
      )
      return text(uri, renderResume(resume.title, resume.kind, resume.data))
    },
  )

  server.registerResource(
    'offer-compare',
    'land://offer/compare',
    {
      title: 'offer 对比',
      description: '所有 pending offer 的总包对比表（口径写在表下方）',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      const rows = await client.get<OfferLike[]>('/offers?status=pending&limit=50')
      if (rows.length === 0) return text(uri, '# offer 对比\n\n暂无待定 offer。')
      const result = compareOffers(rows)
      const body = table(
        ['公司', '4 年现金', '4 年期权', '4 年总包', '综合分'],
        result.rows.map((row) => [
          row.companyName,
          formatMoney(row.breakdown.fourYearCash),
          formatMoney(row.breakdown.equityFourYear),
          formatMoney(row.breakdown.fourYearTotal),
          row.totalScore.toFixed(3),
        ]),
      )
      return text(
        uri,
        `# offer 对比\n\n${body}\n\n口径：\n${result.assumptions.map((item) => `- ${item}`).join('\n')}`,
      )
    },
  )
}

/** 把任意结构的简历正文渲染成 Markdown：字段名不可枚举，所以按常见模块尽力渲染 */
export function renderResume(title: string, kind: string, data: Record<string, unknown>): string {
  const info = (data.personalInfo ?? {}) as Record<string, unknown>
  const lines: string[] = [`# ${title}`, ``, `> kind: ${kind}`, ``]
  const head = [info.name, info.jobTitle, info.workYears, info.city].filter(Boolean).join(' · ')
  if (head) lines.push(head, '')
  if (data.selfIntroduction) lines.push(String(data.selfIntroduction), '')

  const section = (key: string, heading: string, format: (item: Record<string, unknown>) => string) => {
    const list = data[key]
    if (!Array.isArray(list) || list.length === 0) return
    lines.push(`## ${heading}`)
    for (const item of list) {
      if (item && typeof item === 'object') lines.push(format(item as Record<string, unknown>))
    }
    lines.push('')
  }

  section('experiences', '工作经历', (item) => {
    const duty = Array.isArray(item.responsibilities) ? (item.responsibilities as string[]) : []
    return `- ${[item.company, item.position, item.period].filter(Boolean).join(' · ')}\n${duty
      .map((line) => `  - ${line}`)
      .join('\n')}`
  })
  section('projects', '项目', (item) => {
    const tech = Array.isArray(item.technologies) ? (item.technologies as string[]).join('、') : ''
    return `- ${String(item.name ?? '')}（${tech}）${item.description ? ` — ${String(item.description)}` : ''}`
  })
  section('educations', '教育', (item) =>
    `- ${[item.school, item.major, item.degree, item.period].filter(Boolean).join(' · ')}`,
  )
  section('skills', '技能', (item) => `- ${String(item.name ?? '')}${item.description ? `：${String(item.description)}` : ''}`)
  section('contacts', '联系方式', (item) => `- ${String(item.platform ?? '')}：${String(item.value ?? '')}`)

  return lines.join('\n')
}
