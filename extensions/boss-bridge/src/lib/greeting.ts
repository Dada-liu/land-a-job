import { sanitizeUntrustedText } from './parsers.js'
import type { StagedJob } from './types.js'

/** Boss 首条消息有字数限制，默认控制在 200 字以内。 */
export const GREETING_MAX_LENGTH = 200

/**
 * 0-token 模板招呼语：只做槽位填充，不编造经历。
 * highlights 必须来自用户在 options 里填的、简历里确实存在的关键词。
 */
export function buildGreeting(
  template: string,
  job: Pick<StagedJob, 'jobName' | 'brandName' | 'salaryDesc'>,
  highlights: readonly string[] = [],
  maxLength = GREETING_MAX_LENGTH,
): string {
  const highlightText = highlights.length
    ? `我在${highlights.slice(0, 3).join('、')}方面有相关经验。`
    : ''
  const filled = template
    .replaceAll('{jobName}', job.jobName ?? '')
    .replaceAll('{brandName}', job.brandName ?? '')
    .replaceAll('{salaryDesc}', job.salaryDesc ?? '')
    .replaceAll('{highlights}', highlightText)
  const clean = sanitizeUntrustedText(filled)
    .replace(/\s{2,}/g, ' ')
    .trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean
}
