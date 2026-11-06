/** JD 采集层公开入口 */
export { collectJd, type CollectOptions } from './pipeline.js'
export { saveJdSnapshot } from './snapshot.js'
export {
  canonicalJdUrl,
  classifyUrl,
  safeCanonicalJdUrl,
  normalizeHost,
  pasteHint,
  sourceWarnings,
} from './sources.js'
export { robotsAllowsPath } from './robots.js'
export {
  htmlFragmentToText,
  htmlToReadableText,
  sanitizeText,
  normalizeWhitespace,
  escapeHtml,
  MIN_TEXT_LENGTH,
  type ReadablePage,
} from './html.js'
export { parseGreenhouseUrl, parseLeverUrl, ATS_PROVIDERS } from './ats.js'
export { parseFeishuUrl, isFeishuHost } from './feishu.js'
export { parseBeisenItalentUrl, parseBeisenWecruitUrl } from './beisen.js'
export type {
  JdCollection,
  JdFetchContext,
  JdFetchResult,
  JdProvider,
  JdSourceInfo,
  JdSourceKind,
  JdStructured,
} from './types.js'
