const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ABSOLUTE_URL_PATTERN = /^(https?|mailto|tel):/i

export function toAbsoluteUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (EMAIL_PATTERN.test(trimmed)) return `mailto:${trimmed}`
  if (ABSOLUTE_URL_PATTERN.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return `https://${trimmed}`
}
