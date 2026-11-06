/**
 * 表结构与 API 字段的映射表（唯一来源）。
 *
 * 为什么不用 ORM：本地单用户、SQL 全在手写，一张小表就能把「哪个 API 字段对应哪列」
 * 说清楚；ORM 反而让「部分唯一索引」「软删过滤」这些关键语义变得不可见。
 *
 * 漂移防护：apps/server/test/schema.test.ts 会用 PRAGMA table_info 逐列比对，
 * DDL 加了列却忘了在这里登记 → 测试直接红。
 */

export type TableName =
  | 'company'
  | 'job'
  | 'resume'
  | 'application'
  | 'applicationEvent'
  | 'interview'
  | 'question'
  | 'offer'
  | 'task'
  | 'settings'

export interface TableSpec {
  table: string
  /** 有 deleted_at 的表走软删；没有的只能硬删 */
  softDelete: boolean
  /** API 字段名，空格分隔；默认列名 = 驼峰转下划线 */
  fields: string
  /** 列名与字段名不一致的例外（多为 *_json 后缀） */
  overrides?: Record<string, string>
  /** 存 JSON 文本的字段：出库解析、入库序列化 */
  json?: readonly string[]
  /** SQLite 用 0/1 存的布尔字段 */
  bool?: readonly string[]
  /** 出库时转数字的字段（better-sqlite3 对 INTEGER 已返回 number，REAL 也是） */
  numeric?: readonly string[]
}

const SNAKE = /[A-Z]/g
export const toColumn = (key: string): string => key.replace(SNAKE, (c) => `_${c.toLowerCase()}`)

export const TABLES: Record<TableName, TableSpec> = {
  company: {
    table: 'company',
    softDelete: true,
    fields:
      'id name website industry size city priority applyEntry notes createdAt updatedAt deletedAt',
  },
  job: {
    table: 'job',
    softDelete: true,
    fields:
      'id companyId title jdText jdUrl jdSnapshot jdSource channel city salaryMin salaryMax level keywords fitScore fitReasons fitSource status priority notes createdAt updatedAt deletedAt',
    overrides: { keywords: 'keywords_json', fitReasons: 'fit_reasons_json' },
    json: ['keywords', 'fitReasons'],
  },
  resume: {
    table: 'resume',
    softDelete: true,
    fields:
      'id title kind templateId data baseResumeId jobId isDefault provenance createdAt updatedAt deletedAt',
    overrides: { data: 'data_json', provenance: 'provenance_json' },
    json: ['data', 'provenance'],
    bool: ['isDefault'],
  },
  application: {
    table: 'application',
    softDelete: true,
    fields:
      'id jobId resumeId status channel appliedAt statusAt contact nextActionAt evidence confidence notes createdAt updatedAt deletedAt',
    overrides: { evidence: 'evidence_json' },
    json: ['evidence'],
  },
  applicationEvent: {
    table: 'application_event',
    softDelete: false,
    fields: 'id applicationId type fromStatus toStatus payload actor source at',
    overrides: { payload: 'payload_json' },
    json: ['payload'],
  },
  interview: {
    table: 'interview',
    softDelete: false,
    fields:
      'id applicationId round kind scheduledAt durationMin format interviewer location prepStatus feedback selfRating result notes createdAt updatedAt',
  },
  question: {
    table: 'question',
    softDelete: false,
    fields:
      'id interviewId jobId category question intent linkedItem myAnswer score improvement origin provenance createdAt',
    overrides: { score: 'score_json', provenance: 'provenance_json' },
    json: ['score', 'provenance'],
  },
  offer: {
    table: 'offer',
    softDelete: false,
    fields:
      'id applicationId companyName level city baseMonthly monthsPerYear perfMonths signon equityShares equityStrike equityFmv vestYears cliffMonths housingFund subsidyMonthly deadline status assumptions decisionNote createdAt updatedAt',
    overrides: { assumptions: 'assumptions_json' },
    json: ['assumptions'],
  },
  task: {
    table: 'task',
    softDelete: false,
    fields: 'id type title dueAt applicationId doneAt createdAt',
  },
  settings: {
    table: 'settings',
    softDelete: false,
    fields: 'key value',
  },
}

/** 由代码生成、不允许客户端写入的字段 */
export const MANAGED_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'deletedAt', 'statusAt'])

export function fieldList(spec: TableSpec): string[] {
  return spec.fields.split(/\s+/).filter(Boolean)
}

export function columnOf(spec: TableSpec, key: string): string {
  return spec.overrides?.[key] ?? toColumn(key)
}

/** 供 SQL 拼接用：'name, industry, ...' */
export function columnList(spec: TableSpec): string {
  return fieldList(spec)
    .map((k) => columnOf(spec, k))
    .join(', ')
}
