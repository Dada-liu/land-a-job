/**
 * 领域包：纯逻辑，零 I/O。
 *
 * 依赖只有一个：zod（契约校验）。这是刻意保留的唯一运行时依赖——
 * 校验规则必须与调用方共享，手写校验一定会与 DDL 漂移。
 *
 * 约束（PRD D2）：本包及其依赖不得引入任何 LLM SDK。
 * 校验方式：grep -rE "openai|@anthropic-ai|langchain" packages/core/package.json
 */

export const VERSION = '0.1.0'

/** MCP / Web / 日志共用的服务标识，用于端口探测时判断「是不是自己人」 */
export const SERVICE_NAME = 'land-a-job'

/** 数据目录内的相对路径约定 */
export const DATA_LAYOUT = {
  db: 'land.db',
  portFile: '.port',
  tokenFile: '.token',
  browserProfile: 'browser-profile',
  files: 'files',
  snapshots: 'snapshots',
  logs: 'logs',
} as const

export type DataLayout = typeof DATA_LAYOUT

export * from './application.js'
export * from './resume-templates.js'
export * from './skills.js'
export * from './offer.js'
export * from './tax.js'
export * from './fit.js'
export * from './tailor.js'
export * from './funnel.js'
export * from './followup.js'
export * from './settings.js'
export * from './schema/index.js'
