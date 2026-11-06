import type { Contact } from '../types/resume'
import { toAbsoluteUrl } from './url'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i
const PHONE_PLATFORM_PATTERN = /(tel|phone|mobile|电话|手机)/i

export function resolveContactHref(contact: Contact): string | undefined {
  const explicitUrl = toAbsoluteUrl(contact.url ?? '')
  if (explicitUrl) return explicitUrl

  const value = contact.value.trim()
  if (!value) return undefined
  if (EMAIL_PATTERN.test(value)) return `mailto:${value}`
  if (/^https?:\/\//i.test(value)) return value
  if (/^www\./i.test(value) || DOMAIN_PATTERN.test(value)) return toAbsoluteUrl(value)

  const digits = value.replace(/\D/g, '')
  if (PHONE_PLATFORM_PATTERN.test(contact.platform) && digits.length >= 7 && !value.includes('*')) {
    return `tel:${value.replace(/[^\d+]/g, '')}`
  }

  return undefined
}
