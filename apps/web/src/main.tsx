import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { queryClient } from './lib/queryClient'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import { I18nProvider } from './i18n'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('找不到 #root 挂载点')

/**
 * 打印页与编辑页同属「重资产」（resume-kit + jsPDF + html-to-image），
 * 一律动态导入：主包只留总览/列表这类轻页面。
 */
const ResumePrint = lazy(() => import('./pages/ResumePrint'))

/**
 * 打印页走独立入口：不挂侧栏与顶栏，纸面就是页面本身。
 * 无头 Chrome 打开 `/resumes/:id?print=1` 后直接 page.pdf()，版式与编辑器里看到的一致。
 */
const params = new URLSearchParams(window.location.search)
const printMatch = /^\/resumes\/([^/]+)$/.exec(window.location.pathname)
const isPrintMode = params.get('print') === '1' && Boolean(printMatch?.[1])

createRoot(root).render(
  <StrictMode>
    {isPrintMode ? (
      <I18nProvider>
        <Suspense fallback={null}>
          <ResumePrint id={printMatch?.[1] ?? ''} />
        </Suspense>
      </I18nProvider>
    ) : (
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ConfirmProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ConfirmProvider>
          </ToastProvider>
        </QueryClientProvider>
      </I18nProvider>
    )}
  </StrictMode>,
)
