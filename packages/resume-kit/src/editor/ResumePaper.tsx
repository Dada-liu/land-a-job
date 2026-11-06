import { forwardRef, type ReactNode } from 'react'

interface ResumePaperProps {
  children: ReactNode
}

export const RESUME_PAGE_PADDING = 32

export const ResumePaper = forwardRef<HTMLDivElement, ResumePaperProps>(({ children }, ref) => {
  return (
    <div
      ref={ref}
      style={{ padding: RESUME_PAGE_PADDING }}
      className="bg-white w-[210mm] h-[297mm] shadow-lg text-sm relative overflow-hidden"
    >
      {children}
    </div>
  )
})
