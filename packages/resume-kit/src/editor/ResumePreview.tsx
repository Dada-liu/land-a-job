import { forwardRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import type { ResumeData } from '../types/resume'
import { ResumePages } from './ResumePages'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

export interface ResumePreviewProps {
  data: ResumeData
  templateId: string
  /** 画布外的附注，例如「保存中」或页数 */
  footer?: string
}

/**
 * 屏幕预览：缩放控件 + 灰底滚动区，纸面本身由 ResumePages 提供。
 * ref 指向「页栈」根节点，导出 PDF 时直接把它交给 exportResumePdf。
 */
export const ResumePreview = forwardRef<HTMLDivElement, ResumePreviewProps>(function ResumePreview(
  { data, templateId, footer },
  ref,
) {
  const [zoom, setZoom] = useState(1)

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="absolute left-2 top-2 z-20 flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-1 shadow-sm">
        <button
          type="button"
          aria-label="缩小简历"
          title="缩小简历"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom((current) => Math.max(MIN_ZOOM, Number((current - ZOOM_STEP).toFixed(1))))}
          className="rounded p-1.5 text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ZoomOut aria-hidden="true" className="h-4 w-4" />
        </button>
        <span aria-live="polite" className="w-10 text-center text-xs text-stone-600">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="放大简历"
          title="放大简历"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom((current) => Math.min(MAX_ZOOM, Number((current + ZOOM_STEP).toFixed(1))))}
          className="rounded p-1.5 text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ZoomIn aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {footer ? (
        <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-stone-200 bg-white/95 px-3 py-1 text-[11px] text-stone-500 shadow-sm">
          {footer}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-stone-200 p-2 pb-16 sm:p-4 sm:pb-20 lg:p-8 lg:pb-24">
        <div className="w-max min-w-full">
          <ResumePages ref={ref} data={data} templateId={templateId} zoom={zoom} />
        </div>
      </div>
    </div>
  )
})
