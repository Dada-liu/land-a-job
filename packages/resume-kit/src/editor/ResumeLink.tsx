import type { ReactNode } from 'react'

interface ResumeLinkProps {
  href?: string
  accent?: boolean
  children: ReactNode
}

export function ResumeLink({ href, accent = false, children }: ResumeLinkProps) {
  if (!href) return <>{children}</>

  return (
    <a
      href={href}
      rel="noreferrer"
      target={/^https?:/i.test(href) ? '_blank' : undefined}
      className={accent ? 'text-stone-900 hover:underline' : 'hover:underline'}
    >
      {children}
    </a>
  )
}
