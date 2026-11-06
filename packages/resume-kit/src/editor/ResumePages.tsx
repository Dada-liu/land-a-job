import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import type { ResumeData } from '../types/resume'
import { getTemplateById } from '../templates'
import { ResumePaper, RESUME_PAGE_PADDING } from './ResumePaper'

export const A4_WIDTH = 794
export const A4_HEIGHT = 1123
export const PAGE_GAP = 24
const PAGE_PADDING_Y = RESUME_PAGE_PADDING * 2
const PAGE_CONTENT_HEIGHT = A4_HEIGHT - PAGE_PADDING_Y
const PAGE_BREAK_SELECTOR = 'section > div, p, h1, h2, li, tr'

interface Pagination {
  contentHeight: number
  pageOffsets: number[]
}

/**
 * 分页算法（源项目原样保留）。
 *
 * 不用 CSS 分页的原因：简历需要「整块不被切断」，而浏览器分页只能靠 avoid-break 提示，
 * 长表格仍会从中间断开。这里按真实文本/图片的 bottom 边界切页，屏幕上看到什么，PDF 就是什么。
 */
function getPageOffsets(measurement: HTMLElement, contentHeight: number): number[] {
  const origin = measurement.getBoundingClientRect().top
  const boundaries = Array.from(
    measurement.querySelectorAll<HTMLElement>(PAGE_BREAK_SELECTOR),
    (element) => {
      const rect = element.getBoundingClientRect()
      return { top: rect.top - origin, width: rect.width }
    },
  )
    .filter(
      (boundary) => boundary.top > 0 && boundary.top < contentHeight && boundary.width >= A4_WIDTH * 0.4,
    )
    .map((boundary) => boundary.top)
    .sort((a, b) => a - b)
  const offsets = [0]

  while (offsets[offsets.length - 1]! + PAGE_CONTENT_HEIGHT < contentHeight) {
    const start = offsets[offsets.length - 1]!
    const idealEnd = start + PAGE_CONTENT_HEIGHT
    let nextOffset = idealEnd
    for (let index = boundaries.length - 1; index >= 0; index -= 1) {
      const boundary = boundaries[index]!
      if (boundary > start && boundary <= idealEnd) {
        nextOffset = boundary
        break
      }
    }
    offsets.push(nextOffset)
  }

  return offsets
}

export interface ResumePagesLayout {
  pageCount: number
  contentHeight: number
  /** 已缩放后的整体高度，供外层容器占位 */
  height: number
  width: number
}

export interface ResumePagesProps {
  data: ResumeData
  templateId: string
  zoom?: number
  /** 分页稳定后回调一次：无头导出靠它判断「可以截了」 */
  onLayout?: (layout: ResumePagesLayout) => void
}

/**
 * 简历纸面（只负责分页与渲染，不含缩放控件、不含灰底）。
 *
 * 屏幕预览与无头 PDF 导出都用这一个组件，避免出现「预览对、导出错版」这类
 * 只能在用户机器上复现的问题。
 */
export const ResumePages = forwardRef<HTMLDivElement, ResumePagesProps>(function ResumePages(
  { data, templateId, zoom = 1, onLayout },
  ref,
) {
  const template = getTemplateById(templateId)
  const measurementRef = useRef<HTMLDivElement>(null)
  const [pagination, setPagination] = useState<Pagination>({
    contentHeight: PAGE_CONTENT_HEIGHT,
    pageOffsets: [0],
  })
  const layoutRef = useRef(onLayout)
  layoutRef.current = onLayout

  const measureContent = useCallback(() => {
    const measurement = measurementRef.current
    if (!measurement) return

    const origin = measurement.getBoundingClientRect().top
    const range = document.createRange()
    const walker = document.createTreeWalker(measurement, NodeFilter.SHOW_TEXT)
    let contentHeight = PAGE_CONTENT_HEIGHT
    let textNode = walker.nextNode()

    while (textNode) {
      if (textNode.textContent?.trim()) {
        range.selectNodeContents(textNode)
        contentHeight = Math.max(contentHeight, range.getBoundingClientRect().bottom - origin)
      }
      textNode = walker.nextNode()
    }

    for (const image of measurement.querySelectorAll('img')) {
      contentHeight = Math.max(contentHeight, image.getBoundingClientRect().bottom - origin)
    }

    const pageOffsets = getPageOffsets(measurement, contentHeight)
    setPagination((current) => {
      const unchanged =
        current.contentHeight === contentHeight &&
        current.pageOffsets.length === pageOffsets.length &&
        current.pageOffsets.every((offset, index) => offset === pageOffsets[index])
      return unchanged ? current : { contentHeight, pageOffsets }
    })
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(measureContent)
    return () => cancelAnimationFrame(frame)
  }, [measureContent, data, template, pagination.contentHeight])

  // 字体、图片都会异步到位：再测一次，避免首屏按「字体未加载」的尺寸切页
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) measureContent()
    })
    return () => {
      cancelled = true
    }
  }, [measureContent])

  const pageCount = pagination.pageOffsets.length
  const height = pageCount * A4_HEIGHT + (pageCount - 1) * PAGE_GAP

  useEffect(() => {
    layoutRef.current?.({ pageCount, contentHeight: pagination.contentHeight, height, width: A4_WIDTH })
  }, [pageCount, pagination.contentHeight, height])

  if (!template) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        模板「{templateId}」不存在，请检查简历数据里的 templateId。
      </div>
    )
  }

  const TemplateComponent = template.component
  const bleedLayout = template.contentLayout === 'bleed'
  const frameStyle = bleedLayout
    ? ({ position: 'absolute', left: 0, width: A4_WIDTH, overflow: 'hidden' } as const)
    : ({ overflow: 'hidden' } as const)
  const canvasWidth = bleedLayout ? A4_WIDTH : undefined
  const canvasHeight = bleedLayout ? PAGE_CONTENT_HEIGHT : pagination.contentHeight

  return (
    <>
      {/* 离屏测量层：只用于算高度，不参与显示 */}
      <div aria-hidden="true" className="invisible pointer-events-none absolute -left-[10000px] top-0">
        <ResumePaper>
          <div style={{ ...frameStyle, height: PAGE_CONTENT_HEIGHT }}>
            <div
              ref={measurementRef}
              style={{ width: canvasWidth, height: canvasHeight, transform: 'translateY(0px)' }}
            >
              <TemplateComponent data={data} />
            </div>
          </div>
        </ResumePaper>
      </div>

      <div className="mx-auto" data-resume-stack style={{ width: A4_WIDTH * zoom, height: height * zoom }}>
        <div
          ref={ref}
          style={{ width: A4_WIDTH, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        >
          {pagination.pageOffsets.map((offset, pageIndex) => {
            const nextOffset = pagination.pageOffsets[pageIndex + 1] ?? pagination.contentHeight
            const viewportHeight = Math.min(PAGE_CONTENT_HEIGHT, Math.max(0, nextOffset - offset))

            return (
              <div
                key={pageIndex}
                data-resume-page
                style={{ height: A4_HEIGHT, marginBottom: pageIndex === pageCount - 1 ? 0 : PAGE_GAP }}
              >
                <ResumePaper>
                  <div data-resume-viewport style={{ ...frameStyle, height: viewportHeight }}>
                    <div
                      style={{
                        width: canvasWidth,
                        height: canvasHeight,
                        transform: `translateY(-${offset}px)`,
                      }}
                    >
                      <TemplateComponent data={data} />
                    </div>
                  </div>
                </ResumePaper>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
})
