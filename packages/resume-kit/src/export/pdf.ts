import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'
import type { ResumeData } from '../types/resume'

interface PdfLink {
  href: string
  x: number
  y: number
  width: number
  height: number
}

function collectPageLinks(page: HTMLElement): PdfLink[] {
  const pageRect = page.getBoundingClientRect()
  const viewport = page.querySelector<HTMLElement>('[data-resume-viewport]')
  const clipRect = viewport?.getBoundingClientRect()
  const left = Math.max(pageRect.left, clipRect?.left ?? pageRect.left)
  const top = Math.max(pageRect.top, clipRect?.top ?? pageRect.top)
  const right = Math.min(pageRect.right, clipRect?.right ?? pageRect.right)
  const bottom = Math.min(pageRect.bottom, clipRect?.bottom ?? pageRect.bottom)
  const links: PdfLink[] = []

  for (const anchor of page.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const rawHref = anchor.getAttribute('href')?.trim()
    if (!rawHref || rawHref.startsWith('#')) continue

    for (const rect of anchor.getClientRects()) {
      const x0 = Math.max(rect.left, left)
      const y0 = Math.max(rect.top, top)
      const x1 = Math.min(rect.right, right)
      const y1 = Math.min(rect.bottom, bottom)
      if (x1 - x0 < 0.5 || y1 - y0 < 0.5) continue

      links.push({
        href: anchor.href,
        x: x0 - pageRect.left,
        y: y0 - pageRect.top,
        width: x1 - x0,
        height: y1 - y0,
      })
    }
  }

  return links
}

/**
 * jsPDF 写 URI 注释时不带 /NewWindow，部分阅读器会因此在同一标签页里打开链接。
 * 这里在输出阶段给每个 URI 动作补上 /NewWindow true。
 */
function markUriActionsAsNewWindow(pdf: jsPDF) {
  const internal = pdf.internal as unknown as { write: (...args: unknown[]) => unknown }
  const originalWrite = internal.write.bind(internal)
  internal.write = (...args: unknown[]) => {
    const [chunk, ...rest] = args
    const next =
      typeof chunk === 'string' && chunk.includes('/Subtype /Link') && chunk.includes('/S /URI')
        ? chunk.replace(/\) >> >>$/, ') /NewWindow true >> >>')
        : chunk
    return originalWrite(next, ...rest)
  }
}

export interface ExportPdfOptions {
  filename?: string
  /** false 时返回 base64 而不是触发下载（供服务端/MCP 落文件用） */
  download?: boolean
}

export interface ExportPdfResult {
  filename: string
  base64?: string
}

/**
 * 把「页栈」元素导出为 A4 PDF。
 *
 * 元素里若存在 [data-resume-page]，按页逐张转图，保证与屏幕上看到的分页完全一致；
 * 否则整块作为一页导出。链接坐标按页面尺寸等比换算，PDF 里仍可点击。
 */
export async function exportResumePdf(
  element: HTMLElement,
  options: ExportPdfOptions = {},
): Promise<ExportPdfResult> {
  const { filename = 'resume.pdf', download = true } = options
  const pageElements = element.querySelectorAll<HTMLElement>('[data-resume-page]')
  const hasPages = pageElements.length > 0
  const sourcePages = hasPages ? Array.from(pageElements) : [element]
  const snapshot = document.createElement('div')
  snapshot.setAttribute('aria-hidden', 'true')
  Object.assign(snapshot.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: `${Math.max(...sourcePages.map((page) => page.offsetWidth))}px`,
    pointerEvents: 'none',
    background: '#ffffff',
  })
  const pages = sourcePages.map((source) => {
    const clone = source.cloneNode(true) as HTMLElement
    if (!hasPages) {
      clone.style.transform = 'none'
      clone.style.transformOrigin = 'top left'
    }
    snapshot.appendChild(clone)
    return clone
  })
  document.body.appendChild(snapshot)

  const pageRects = pages.map((page) => page.getBoundingClientRect())
  const linksByPage = pages.map(collectPageLinks)

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pdfWidth = pdf.internal.pageSize.getWidth()
  const pdfHeight = pdf.internal.pageSize.getHeight()
  markUriActionsAsNewWindow(pdf)

  try {
    for (const [index, page] of pages.entries()) {
      const dataUrl = await toPng(page, { quality: 1, pixelRatio: 2, backgroundColor: '#ffffff' })
      if (index > 0) pdf.addPage()
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight)

      const { width: pageWidth, height: pageHeight } = pageRects[index]!
      const scaleX = pdfWidth / pageWidth
      const scaleY = pdfHeight / pageHeight
      for (const link of linksByPage[index]!) {
        pdf.link(link.x * scaleX, link.y * scaleY, link.width * scaleX, link.height * scaleY, {
          url: link.href,
        })
      }
    }
  } finally {
    snapshot.remove()
  }

  if (download) {
    pdf.save(filename)
    return { filename }
  }

  const dataUri = pdf.output('datauristring')
  return { filename, base64: dataUri.slice(dataUri.indexOf(',') + 1) }
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '')
}

/** 文件名口径：姓名_岗位_简历标题_日期，避免下载目录里一堆 resume.pdf */
export function buildResumeFileName(
  data: ResumeData,
  resumeTitle: string,
  date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const parts = [data.personalInfo.name || '简历', data.personalInfo.jobTitle || '岗位', resumeTitle || '简历', stamp]
  return `${parts.map(sanitizeFilenamePart).filter(Boolean).join('_')}.pdf`
}
