import type { Contact } from '../types/resume'
import { resolveContactHref } from '../utils/contactLink'
import { ResumeLink } from './ResumeLink'

export function ContactValue({ contact }: { contact: Contact }) {
  return (
    <ResumeLink href={resolveContactHref(contact)} accent={Boolean(contact.url?.trim())}>
      {contact.value}
    </ResumeLink>
  )
}
