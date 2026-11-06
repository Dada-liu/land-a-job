import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Menu, X } from 'lucide-react'
import { useShortcuts } from './hooks/useShortcuts'
import { SkillBar } from './components/SkillBar'
import { useHealth } from './hooks/useHealth'
import { useRealtime } from './hooks/useRealtime'
import { useInvalidateFromWs } from './lib/queries'
import { GITHUB_URL } from './lib/links'
import { PRIMARY_NAV, primaryNavFor, settingsTabFor } from './lib/navigation'
import { SettingsTabs } from './components/SettingsTabs'
import Dashboard from './pages/Dashboard'
import Bank from './pages/Bank'
import Companies from './pages/Companies'
import Interviews from './pages/Interviews'
import JobDetail from './pages/JobDetail'
import Jobs from './pages/Jobs'
import Offers from './pages/Offers'
import Settings from './pages/Settings'
import Pipeline from './pages/Pipeline'
import NotFound from './pages/NotFound'
import Resumes from './pages/Resumes'
import { CommandPalette } from './components/CommandPalette'

// 编辑页带着 resume-kit（内含 jsPDF / html-to-image，约 500KB），按路由懒加载：
// 只看总览或列表的人不该为此付出首屏时间。
const ResumeEditor = lazy(() => import('./pages/ResumeEditor'))

/**
 * GitHub 标记：lucide 1.x 移除了品牌图标，这里内联一份官方 mark。
 * 只是一个路径，不值得为它引一整个品牌图标包。
 */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38V13.5c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function StatusPill({ status }: { status: 'loading' | 'online' | 'offline' }) {
  const map = {
    loading: { dot: 'bg-stone-300', text: '启动中', color: 'text-stone-500' },
    // 「服务正常」听起来像在线服务；这个进程就在本机，说「后台正在运行」更准确
    online: { dot: 'bg-emerald-500', text: '后台正在运行', color: 'text-emerald-700' },
    offline: { dot: 'bg-red-500', text: '后台未运行', color: 'text-red-600' },
  }[status]

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${map.dot}`} />
      <span className={map.color}>{map.text}</span>
    </span>
  )
}

export default function App() {
  const health = useHealth()
  const invalidateFromWs = useInvalidateFromWs()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // WS 失效通知 → react-query 精确失效对应查询键：
  // Agent 通过 MCP 改数据后，页面不需要刷新就能看到新数字。
  const onInvalidate = useCallback(
    (keys: string[]) => {
      invalidateFromWs(keys)
      health.refresh()
    },
    [invalidateFromWs, health.refresh],
  )
  const realtime = useRealtime(onInvalidate)
  const location = useLocation()

  // WS 连上后重取一次：否则「实时通道」会一直显示 0 个连接（首屏探测时页面还没连上）
  useEffect(() => {
    if (realtime === 'open') health.refresh()
  }, [realtime, health.refresh])

  /**
   * 页面可能是在后端还没起来时被打开的，那一刻所有查询都失败了。
   * 健康检查从「不可达」回到「正常」时把查询全部作废重取，
   * 让页面自己恢复——不然只能硬刷新，而「刷新也没用」正是最初那个报错最难受的地方。
   */
  const client = useQueryClient()
  const wasOffline = useRef(false)
  useEffect(() => {
    if (health.status === 'offline') {
      wasOffline.current = true
      return
    }
    if (health.status === 'online' && wasOffline.current) {
      wasOffline.current = false
      void client.invalidateQueries()
    }
  }, [health.status, client])

  // 全局 ⌘K / Ctrl+K：录入与跳转都不需要鼠标
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [navOpen, setNavOpen] = useState(false)
  const navigate = useNavigate()

  // g 开头的两键序列：不需要鼠标就能在页面间跳；n 直接开录入。
  // g c / g r / g b 现在指向「设置」下的二级页，URL 与快捷键都保持不变。
  useShortcuts({
    n: () => setPaletteOpen(true),
    'g d': () => navigate('/'),
    'g p': () => navigate('/pipeline'),
    'g j': () => navigate('/jobs'),
    'g c': () => navigate('/companies'),
    'g i': () => navigate('/interviews'),
    'g r': () => navigate('/resumes'),
    'g o': () => navigate('/offers'),
    'g b': () => navigate('/bank'),
    'g s': () => navigate('/settings'),
  })

  // 换页时收起移动端抽屉，否则点完还要再点一次关闭
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  const current = primaryNavFor(location.pathname)
  // 设置分区的四个页面（含简历编辑器）都归到侧栏「设置」这一项下
  const activeTab = settingsTabFor(location.pathname)
  // 编辑页要占满整个内容区（左预览右编辑）；看板要横向滚动，也不能被 max-w 限制
  const fullBleed = /^\/resumes\/[^/]+$/.test(location.pathname) || location.pathname === '/pipeline'

  return (
    <div className="flex h-full">
      {/* 移动端：侧栏是浮层，点遮罩关闭；桌面端（lg 以上）恢复常驻 */}
      {navOpen ? (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-stone-900/30 lg:hidden"
        />
      ) : null}
      <aside
        data-testid="sidebar"
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-56 shrink-0 flex-col border-r border-stone-200 bg-white transition-transform',
          'lg:static lg:z-auto lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-stone-900 text-sm font-semibold text-white">
                LJ
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">Land a Job</div>
                <div className="text-[11px] text-stone-500">求职流水线</div>
              </div>
            </div>
            {/* 抽屉展开后汉堡按钮被侧栏盖住，必须有一个自己的关闭按钮 */}
            <button
              type="button"
              data-testid="nav-close"
              aria-label="关闭导航"
              onClick={() => setNavOpen(false)}
              className="-mr-1 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700 lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.key}
              to={item.to}
              end={item.end}
              data-testid={`nav-${item.key}`}
              className={({ isActive }) =>
                [
                  'mb-0.5 flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                  // 设置分区里的任何二级页都让一级「设置」保持高亮
                  isActive || (item.key === 'settings' && Boolean(activeTab))
                    ? 'bg-stone-100 font-medium text-stone-900'
                    : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900',
                ].join(' ')
              }
            >
              <span>{item.label}</span>
              {item.phase ? <span className="text-[10px] font-normal text-stone-400">{item.phase}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-stone-200 px-4 py-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="mb-2.5 flex w-full items-center justify-between rounded-md border border-stone-200 px-2.5 py-1.5 text-[11px] text-stone-500 hover:bg-stone-50"
          >
            <span>快速录入 / 搜索</span>
            <kbd className="rounded bg-stone-100 px-1 font-mono text-[10px] text-stone-500">⌘K</kbd>
          </button>
          <SkillBar />
          <p className="mt-2.5 text-[10px] leading-relaxed text-stone-400">
            AI 在 Agent 里跑，本应用不调用模型。
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-stone-200 bg-white/80 px-3 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-baseline gap-2 sm:gap-3">
            <button
              type="button"
              data-testid="nav-toggle"
              aria-label={navOpen ? '关闭导航' : '打开导航'}
              onClick={() => setNavOpen((open) => !open)}
              className="-ml-1 shrink-0 rounded p-1.5 text-stone-500 hover:bg-stone-100 lg:hidden"
            >
              {navOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
            <h1 className="truncate text-sm font-medium text-stone-900">
              {/* 设置分区里的每页都标出所属二级 tab；二级 tab 名已经与「设置」不同，不会出现「设置 · 设置」 */}
              {activeTab ? `设置 · ${activeTab.label}` : (current?.label ?? '页面不存在')}
            </h1>
            <span className="hidden text-xs text-stone-400 sm:inline">
              {health.status === 'online' && health.data
                ? `v${health.data.version} · port ${health.data.port}`
                : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 实时通道（WebSocket）只用于另一端的增量刷新，用户不需要知道它叫什么，所以不做状态展示 */}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="github-link"
              title="到 GitHub 看源码、提 issue，或点个 star"
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900"
            >
              <GithubMark className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden whitespace-nowrap md:inline">如果对你有帮助，点个 star 吧</span>
            </a>
            <StatusPill status={health.status} />
          </div>
        </header>

        <main className={fullBleed ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6 sm:py-6'}>
          <div className={fullBleed ? 'h-full' : 'mx-auto max-w-6xl'}>
            {/* 二级 tab 只在设置分区的列表页出现：编辑器是 fullBleed，塞条会挤掉预览区 */}
            {activeTab && !fullBleed ? <SettingsTabs /> : null}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pipeline" element={<Pipeline />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              {/* 独立投递助手页已下线；旧链接落到岗位库，从行内「直接投递」弹窗进入 */}
              <Route path="/apply" element={<Navigate to="/jobs" replace />} />
              <Route path="/companies" element={<Companies />} />
              <Route path="/interviews" element={<Interviews />} />
              <Route path="/resumes" element={<Resumes />} />
              <Route
                path="/resumes/:id"
                element={
                  <Suspense fallback={<div className="p-6 text-sm text-stone-400">加载编辑器…</div>}>
                    <ResumeEditor />
                  </Suspense>
                }
              />
              <Route path="/offers" element={<Offers />} />
              <Route path="/bank" element={<Bank />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
