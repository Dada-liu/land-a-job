import { useEffect, useState } from 'react'
import { normalizeResumeData, ResumePages, type ResumeData } from '@land/resume-kit'
import { getResume, type ResumeDto } from '../lib/api'

declare global {
  interface Window {
    /** 无头导出据此判断「分页已稳定，可以截图/打印了」 */
    __landResumeReady?: boolean
  }
}

/**
 * 打印专用页面（`/resumes/:id?print=1`）。
 *
 * 存在的理由：无头导出（P2-6）需要一个「没有侧栏、没有缩放、纸面即页面」的地址。
 * 它复用 ResumePages，因此与编辑页的分页结果完全一致——不会出现预览 2 页、
 * 导出 PDF 却 3 页的错位。
 */
export default function ResumePrint({ id }: { id: string }) {
  const [resume, setResume] = useState<ResumeDto | null>(null)
  const [data, setData] = useState<ResumeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await getResume(id)
        if (cancelled) return
        setResume(loaded)
        setData(normalizeResumeData(loaded.data))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    document.body.style.background = '#ffffff'
    return () => {
      document.body.style.background = ''
    }
  }, [])

  if (error) {
    return <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#b91c1c' }}>{error}</div>
  }

  if (!data || !resume) {
    return <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#78716c' }}>正在渲染简历…</div>
  }

  return (
    <div className="print-mode" data-page-count={pageCount}>
      <ResumePages
        data={data}
        templateId={resume.templateId}
        onLayout={(layout) => {
          setPageCount(layout.pageCount)
          // 等一帧再放行：确保分页后的 DOM 已经布局完成
          requestAnimationFrame(() => {
            window.__landResumeReady = true
            document.documentElement.dataset.resumeReady = 'true'
          })
        }}
      />
    </div>
  )
}
