import { createBlankResume } from '../model.js'
import type { ResumeData } from '../types/resume'

type SectionName = 'summary' | 'experiences' | 'educations' | 'skills' | 'projects' | 'contacts'

const SECTION_KEYWORDS: { name: SectionName; keywords: string[] }[] = [
  { name: 'summary', keywords: ['自我介绍', '个人简介', '个人优势', '个人评价', '关于我', 'summary', 'profile', 'about'] },
  { name: 'experiences', keywords: ['工作经历', '工作经验', '职业经历', '从业经历', 'experience', 'employment', 'work'] },
  { name: 'educations', keywords: ['教育经历', '教育背景', '学历', 'education'] },
  { name: 'skills', keywords: ['专业技能', '技能', '技术栈', 'skills', 'skill'] },
  { name: 'projects', keywords: ['项目经历', '项目经验', '项目', 'projects', 'project'] },
  { name: 'contacts', keywords: ['联系方式', '联系我', 'contact', 'contacts'] },
]

const BULLET_PATTERN = /^[-*•·+]\s+/
const HEADING_PATTERN = /^(#{1,6})\s*(.+?)\s*#*$/
const DATE_RANGE_PATTERN = /((19|20)\d{2}[\s./年-].{0,12}?((19|20)\d{2}|至今|现在|present|now|今))/i

const CONTACT_KEYWORDS: { keywords: string[]; platform: string }[] = [
  { keywords: ['邮箱', 'email', 'e-mail', 'mail'], platform: 'Email' },
  { keywords: ['电话', '手机', '联系方式', 'tel', 'phone', 'mobile'], platform: 'Phone' },
  { keywords: ['微信', 'wechat', 'weixin'], platform: '微信' },
  { keywords: ['github'], platform: 'GitHub' },
  { keywords: ['博客', 'blog', '网站', '主页', 'homepage', 'website'], platform: 'Blog' },
  { keywords: ['城市', '现居', '地址', 'location', 'city', 'address'], platform: '城市' },
]

export interface ParsedResume {
  data: ResumeData
  warnings: string[]
}

function matchSection(heading: string): SectionName | null {
  const normalized = heading.toLowerCase().replace(/[\s:：]/g, '')
  for (const entry of SECTION_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      return entry.name
    }
  }
  return null
}

function clean(text: string) {
  return text.replace(/\*\*/g, '').replace(/`/g, '').trim()
}

function splitFields(line: string): string[] {
  return clean(line)
    .split(/\s*[|｜]\s*|\s+-\s+|\s+—\s+|\s+·\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function pickPeriod(fields: string[]): string | undefined {
  return fields.find((field) => DATE_RANGE_PATTERN.test(field))
}

interface Entry {
  header: string[]
  bullets: string[]
  text: string[]
}

function groupEntries(lines: string[]): Entry[] {
  const entries: Entry[] = []
  let current: Entry | null = null

  const push = (entry: Entry) => {
    if (entry.bullets.length || entry.header.length || entry.text.length) entries.push(entry)
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const heading = line.match(HEADING_PATTERN)
    if (heading && (heading[1]?.length ?? 0) >= 2) {
      if (current) push(current)
      current = { header: splitFields(heading[2] ?? ''), bullets: [], text: [] }
      continue
    }

    if (BULLET_PATTERN.test(line)) {
      if (!current) current = { header: [], bullets: [], text: [] }
      current.bullets.push(clean(line.replace(BULLET_PATTERN, '')))
      continue
    }

    // 无 # 号但整行像条目头（带时间段）时开启新条目
    if (DATE_RANGE_PATTERN.test(line) && !current?.text.length) {
      if (current) push(current)
      current = { header: splitFields(line), bullets: [], text: [] }
      continue
    }

    if (!current) current = { header: [], bullets: [], text: [] }
    current.text.push(clean(line))
  }

  if (current) push(current)
  return entries
}

function parseContacts(lines: string[]): { platform: string; value: string }[] {
  const contacts: { platform: string; value: string }[] = []

  for (const rawLine of lines) {
    const line = clean(rawLine.replace(BULLET_PATTERN, ''))
    if (!line) continue

    // 支持「邮箱：a@b.com」「Email: a@b.com」以及同一行内用 | 分隔的多个联系方式
    for (const part of line.split(/\s*[|｜]\s*/)) {
      const separatorIndex = part.search(/[:：]/)
      const label = separatorIndex >= 0 ? part.slice(0, separatorIndex).trim() : ''
      const value = separatorIndex >= 0 ? part.slice(separatorIndex + 1).trim() : part.trim()

      if (label) {
        const matched = CONTACT_KEYWORDS.find((item) =>
          item.keywords.some((keyword) => label.toLowerCase().includes(keyword))
        )
        contacts.push({ platform: matched?.platform ?? label, value })
        continue
      }

      const email = value.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
      if (email) {
        contacts.push({ platform: 'Email', value: email[0] })
        continue
      }
      const phone = value.match(/1[3-9]\d{9}/)
      if (phone) {
        contacts.push({ platform: 'Phone', value: phone[0] })
      }
    }
  }

  return contacts
}

/**
 * 把 Markdown / 纯文本简历解析成结构化数据。
 *
 * 只做启发式解析：章节靠关键词识别，条目靠 # 小标题、列表符号与时间段切分，
 * 因此解析结果需要调用方（Agent）再核对一遍。
 */
export function parseResumeFromText(text: string): ParsedResume {
  const warnings: string[] = []
  const data = createBlankResume()
  const lines = text.split(/\r?\n/)
  const buckets: Record<SectionName, string[]> = {
    summary: [],
    experiences: [],
    educations: [],
    skills: [],
    projects: [],
    contacts: [],
  }

  const preamble: string[] = []
  let currentSection: SectionName | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const heading = line.match(HEADING_PATTERN)

    if (heading) {
      const section = matchSection(heading[2] ?? '')
      if (section) {
        currentSection = section
        continue
      }

      // 一级标题通常是姓名
      if (heading[1]?.length === 1 && !data.personalInfo.name) {
        data.personalInfo.name = clean(heading[2] ?? '')
        continue
      }

      if (currentSection) {
        buckets[currentSection].push(line)
      } else {
        preamble.push(clean(heading[2] ?? ''))
      }
      continue
    }

    if (currentSection) {
      buckets[currentSection].push(line)
    } else {
      preamble.push(line)
    }
  }

  // 前置区域：姓名、求职意向、联系方式
  const leftover: string[] = []
  for (const rawLine of preamble) {
    const line = rawLine.trim()
    if (!line) continue

    const nameMatch = line.match(/^(?:姓名|name)\s*[:：]\s*(.+)$/i)
    if (nameMatch) {
      data.personalInfo.name = clean(nameMatch[1] ?? '')
      continue
    }

    const jobMatch = line.match(/^(?:求职意向|应聘职位|目标岗位|意向岗位|职位|岗位|job\s*title|position)\s*[:：]\s*(.+)$/i)
    if (jobMatch) {
      data.personalInfo.jobTitle = clean(jobMatch[1] ?? '')
      continue
    }

    const yearsMatch = line.match(/^(?:工作年限|经验|years?)\s*[:：]\s*(.+)$/i)
    if (yearsMatch) {
      data.personalInfo.workYears = clean(yearsMatch[1] ?? '')
      continue
    }

    const inlineContacts = parseContacts([line])
    if (inlineContacts.length > 0 && /[:：]/.test(line)) {
      data.contacts.push(
        ...inlineContacts.map((contact) => ({
          id: `import-contact-${data.contacts.length + 1}-${Math.random().toString(36).slice(2, 7)}`,
          ...contact,
        }))
      )
      continue
    }

    if (!data.personalInfo.name && leftover.length === 0 && line.length <= 20) {
      data.personalInfo.name = clean(line)
      continue
    }

    // 「前端工程师 | 3 年经验」这类信息行
    if (!data.personalInfo.jobTitle) {
      const fields = splitFields(line)
      const jobField = fields.find((field) => !DATE_RANGE_PATTERN.test(field) && !field.includes('@'))
      if (jobField) {
        data.personalInfo.jobTitle = jobField
        continue
      }
    }

    leftover.push(line)
  }

  if (buckets.summary.length === 0 && leftover.length > 0) {
    buckets.summary.push(...leftover)
  }

  data.selfIntroduction = buckets.summary
    .map((line) => clean(line.replace(BULLET_PATTERN, '')))
    .filter(Boolean)
    .join('\n')

  for (const entry of groupEntries(buckets.experiences)) {
    const headerFields = [...entry.header]
    const period = pickPeriod(headerFields) ?? pickPeriod(entry.text) ?? ''
    const rest = headerFields.filter((field) => field !== period)
    const company = rest[0] ?? ''
    const position = rest[1] ?? ''

    data.experiences.push({
      id: `import-exp-${data.experiences.length + 1}`,
      period,
      company,
      position,
      responsibilities: entry.bullets.length > 0 ? entry.bullets : entry.text,
    })
  }

  for (const entry of groupEntries(buckets.educations)) {
    const fields = [...entry.header, ...entry.bullets.flatMap((line) => splitFields(line))]
    const period = pickPeriod(fields) ?? ''
    const others = fields.filter((field) => field !== period)
    const school = others.find((field) => /(大学|学院|学校|中学|university|college|institute)/i.test(field)) ?? others[0] ?? ''
    const degree = others.find((field) => /(本科|硕士|博士|大专|高中|中专|bachelor|master|phd|doctor)/i.test(field)) ?? ''
    const major = others.find((field) => field !== school && field !== degree) ?? ''

    data.educations.push({
      id: `import-edu-${data.educations.length + 1}`,
      school,
      degree,
      major,
      period,
    })
  }

  for (const entry of groupEntries(buckets.projects)) {
    const headerFields = [...entry.header]
    const period = pickPeriod(headerFields) ?? ''
    const name = headerFields.find((field) => field !== period) ?? entry.text[0] ?? ''
    const role = headerFields.filter((field) => field !== period && field !== name)[0]
    const techLine = [...entry.bullets, ...entry.text].find((line) =>
      /^(技术栈|技术选型|technologies|tech stack|stack)\s*[:：]/i.test(line)
    )
    const technologies = techLine
      ? techLine
          .replace(/^(技术栈|技术选型|technologies|tech stack|stack)\s*[:：]\s*/i, '')
          .split(/[,，、/]/)
          .map((item) => item.trim())
          .filter(Boolean)
      : []
    const details = entry.bullets
      .filter((line) => line !== techLine)
      .map((line) => (line.startsWith('-') ? line : `- ${line}`))
      .join('\n')

    data.projects.push({
      id: `import-proj-${data.projects.length + 1}`,
      name,
      period,
      role,
      description: entry.text.filter((line) => line !== techLine).join(' '),
      details,
      technologies,
    })
  }

  for (const line of buckets.skills) {
    const cleaned = clean(line.replace(BULLET_PATTERN, ''))
    if (!cleaned) continue

    const matched = cleaned.match(/^(.+?)\s*[:：\-—]\s*(.+)$/) ?? cleaned.match(/^(.+?)\s*[（(](.+?)[)）]\s*$/)
    if (matched) {
      data.skills.push({
        id: `import-skill-${data.skills.length + 1}`,
        name: (matched[1] ?? '').trim(),
        description: (matched[2] ?? '').trim(),
      })
    } else {
      data.skills.push({
        id: `import-skill-${data.skills.length + 1}`,
        name: cleaned,
        description: '',
      })
    }
  }

  for (const contact of parseContacts(buckets.contacts)) {
    if (data.contacts.some((item) => item.platform === contact.platform && item.value === contact.value)) continue
    data.contacts.push({
      id: `import-contact-${data.contacts.length + 1}`,
      platform: contact.platform,
      value: contact.value,
    })
  }

  if (!data.personalInfo.name) warnings.push('未能识别姓名，请用 update_personal_info 补充')
  if (data.experiences.length === 0) warnings.push('未能识别工作经历章节')
  if (data.educations.length === 0) warnings.push('未能识别教育经历章节')
  if (data.selfIntroduction === '' && data.experiences.length === 0) {
    warnings.push('内容几乎没有被解析出来，建议改用 JSON 格式导入')
  }

  return { data, warnings }
}
