/**
 * Zod schema 全量定义（P1-3）。
 *
 * 为什么放 core 而不是 server：MCP 工具的参数校验、Web 端的表单校验、
 * 服务端的请求校验必须是同一套规则，否则「MCP 能写进去、页面打开就崩」。
 */
export * from './common.js'
export * from './company.js'
export * from './job.js'
export * from './resume.js'
export * from './application.js'
export * from './interview.js'
export * from './question.js'
export * from './offer.js'
export * from './settings.js'
