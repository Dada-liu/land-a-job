import type { ReactNode } from 'react'

interface ResumeLinkProps {
  href?: string
  /**
   * 用户显式配置过链接（联系方式里的「链接」字段、项目的 URL）。
   * 只有这一类染成链接蓝：电话/微信这类虽然也是 `<a>`，但看着不像链接才自然。
   */
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
      className={accent ? 'text-blue-600 hover:underline' : 'hover:underline'}
    >
      {children}
    </a>
  )
}
