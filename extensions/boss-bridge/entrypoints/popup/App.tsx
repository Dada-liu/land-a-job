import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { sendToBackground } from '../../src/lib/messages.js'
import type { RuntimeResponse, RuntimeStatus } from '../../src/lib/messages.js'
import type { StagedJob } from '../../src/lib/types.js'
import type { AutoSettings } from '../../src/lib/orchestrator.js'

/** 阶段说人话：实现词（scan / greet / send）不露到界面上 */
const PHASE_LABEL: Record<string, string> = {
  idle: '待命',
  scan: '读岗位详情',
  greet: '打招呼',
  send: '发消息',
}

const AUTO_SWITCHES: readonly [keyof AutoSettings & ('scan' | 'scanDetail' | 'greet' | 'sendGreeting' | 'sendResume'), string][] = [
  ['scan', '自动翻页'],
  ['scanDetail', '自动读详情'],
  ['greet', '自动打招呼'],
  ['sendGreeting', '自动发定制语'],
  ['sendResume', '自动发简历'],
]

/** 图标只用内联 SVG：扩展不引图标库，少一个依赖也少一份体积 */
function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

/** 悬停多久才出提示：太快会跟着鼠标乱闪，原生 title 的 ~1s 又显得迟钝 */
const TIP_DELAY = 480

/**
 * 图标按钮：提示自绘，不用原生 `title`。
 * 原生 title 的延迟与样式都由浏览器决定，popup 里还会被窗口边缘裁掉；自绘才能控节奏。
 */
function IconButton({
  tip, disabled, spinning, onClick, children,
}: {
  tip: string
  disabled?: boolean
  spinning?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  /** hover 后延迟显示；移开立刻收起（收起不需要等） */
  const schedule = () => {
    clear()
    timer.current = setTimeout(() => setShown(true), TIP_DELAY)
  }
  /** 键盘 Tab 过来时直接给提示，别再让用户等半秒 */
  const showNow = () => {
    clear()
    setShown(true)
  }
  const hide = () => {
    clear()
    setShown(false)
  }
  useEffect(() => clear, [])

  return (
    <button
      type="button"
      className={`icon${spinning ? ' spin' : ''}`}
      aria-label={tip}
      aria-busy={spinning || undefined}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={schedule}
      onMouseLeave={hide}
      onFocus={showNow}
      onBlur={hide}
    >
      {children}
      <span className={`tip${shown ? ' on' : ''}`} role="tooltip" aria-hidden="true">{tip}</span>
    </button>
  )
}

/** 操作反馈统一走顶部浮层：底部两行提示用户根本扫不到（尤其 popup 已经很长时） */
type Toast = { kind: 'ok' | 'error'; text: string }

export function PopupApp() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [staged, setStaged] = useState<StagedJob[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showProgress, setShowProgress] = useState(false)

  const refresh = useCallback(async () => {
    const [s, j, l] = await Promise.all([
      sendToBackground<RuntimeResponse>({ type: 'GET_STATUS' }),
      sendToBackground<RuntimeResponse>({ type: 'GET_STAGED' }),
      sendToBackground<RuntimeResponse>({ type: 'GET_LOGS' }),
    ])
    if (s.ok && s.status) setStatus(s.status)
    if (j.ok && j.staged) setStaged(j.staged)
    if (l.ok && l.logs) setLogs(l.logs)
    if (!s.ok) setToast({ kind: 'error', text: s.error })
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  /** 点刷新按钮时转起来；本地读取通常几十毫秒就完了，补足最短时长才看得出在转 */
  const MIN_SPIN = 620
  const manualRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    const startedAt = Date.now()
    try {
      await refresh()
    } finally {
      const left = MIN_SPIN - (Date.now() - startedAt)
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left))
      setRefreshing(false)
    }
  }, [refresh, refreshing])

  /** 3.2 秒自动收起；点一下也能立刻关掉 */
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  async function act(request: Parameters<typeof sendToBackground>[0], success: string) {
    setBusy(true)
    setToast(null)
    try {
      const res = await sendToBackground<RuntimeResponse>(request)
      setToast(res.ok ? { kind: 'ok', text: success } : { kind: 'error', text: res.error })
      await refresh()
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  /** 单开关只发一个字段：后台按 patch 合并，避免整份设置被旧值覆盖 */
  async function toggleAuto(patch: Partial<AutoSettings>) {
    setBusy(true)
    setToast(null)
    try {
      await sendToBackground({ type: 'SET_AUTO_SETTINGS', auto: patch })
      await refresh()
    } catch (e) {
      setToast({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  /** 全自动的实时状态；未开启时也带上（显示"未开启"而不是整块消失） */
  const auto = status?.auto

  const replied = staged.filter((j) => j.state === 'replied')
  const tailored = staged.filter((j) => j.state === 'tailored')
  const uploaded = staged.filter((j) => j.state === 'uploaded')
  const sentJobs = staged.filter((j) => j.state === 'sent')
  /** 定制的前提是已落库（P2 建了 queued 投递），所以按钮只对 replied 生效 */
  const canTailor = replied.length > 0

  /** 回复之后才用得到的计数，折叠起来单独显示 */
  const progressTotal = replied.length + tailored.length + uploaded.length + sentJobs.length
  /** 下一步该点哪个：有回复就定制，都上传了就等发简历 */
  const currentStep = uploaded.length > 0 ? 3 : replied.length > 0 ? 2 : 1

  useEffect(() => {
    if (progressTotal > 0) setShowProgress(true)
  }, [progressTotal])

  return (
    <div className="wrap">
      {toast && (
        <div className="toast-stack" role="status" aria-live="polite">
          <button
            type="button"
            className={`toast ${toast.kind}`}
            title="点击关闭"
            onClick={() => setToast(null)}
          >
            <span className="toast-text">{toast.text}</span>
          </button>
        </div>
      )}
      <div className="head">
        <h1>land-a-job · BOSS 桥接</h1>
        <div className="head-actions">
          <IconButton
            tip="查看缓存岗位"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('staging.html') })}
          >
            <ListIcon />
          </IconButton>
          <IconButton
            tip="刷新状态"
            disabled={busy}
            spinning={refreshing}
            onClick={() => void manualRefresh()}
          >
            <RefreshIcon />
          </IconButton>
          <IconButton tip="设置" disabled={busy} onClick={() => void chrome.runtime.openOptionsPage()}>
            <GearIcon />
          </IconButton>
        </div>
      </div>
      {/* 提示条正好落在副标题上：提示期间把它淡出，避免露出半截字 */}
      <p className={`sub top-sub${toast ? ' dimmed' : ''}`}>默认只翻页、不碰发送；打开下面的「全自动」才会替你打招呼，勾了「自动发定制语」才会按设置里的模板发第二条。</p>

      {auto && (
        <div className="card auto">
          <div className="row">
            <span className="label">全自动</span>
            <span className={`badge ${auto.enabled ? 'on' : ''}`}>
              {auto.enabled ? PHASE_LABEL[auto.phase] ?? '运行中' : '未开启'}
            </span>
          </div>
          <div className="row">
            <span className="label">今日</span>
            <span className="value">
              读详情 {auto.scannedToday}/{auto.limits.scan} · 招呼 {auto.greetedToday}/{auto.limits.greet} · 消息 {auto.sentToday}/{auto.limits.send}
            </span>
          </div>
          {/* 待机原因比上一步动作更新鲜：先显示它，否则"翻了一屏"会一直挂在那里把原因盖住 */}
          <p className="sub auto-note">{auto.waitReason ?? auto.lastStepText ?? '尚未执行任何动作'}</p>

          <div className="actions">
            <button className="btn primary" disabled={busy || auto.enabled} onClick={() => void act({ type: 'START_AUTO' }, '已开启全自动，每分钟推进一个动作')}>
              开始全自动
            </button>
            <button className="btn" disabled={busy || !auto.enabled} onClick={() => void act({ type: 'STOP_AUTO' }, '已暂停全自动')}>
              暂停
            </button>
          </div>

          <div className="auto-switches">
            {AUTO_SWITCHES.map(([key, label]) => (
              <label className="check" key={key}>
                <input
                  type="checkbox"
                  checked={auto.switches[key]}
                  disabled={busy}
                  onChange={(e) => void toggleAuto({ [key]: e.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="hint">
            只在你已经打开的岗位搜索页上动作，{auto.windowLabel} 之外自动停。
            写动作（打招呼 / 发消息 / 发简历）默认关闭，开之前先想清楚风险。
          </p>
        </div>
      )}

      <div className="card">
        <div className="row">
          <span className="label">监听状态</span>
          <span className={`badge ${status?.capturing ? 'on' : ''}`}>
            {status?.capturing ? `监听中 · ${status.attachedTabCount ?? 1} 个页面` : '未开始'}
          </span>
        </div>
        <div className="row" title="只影响「筛选并生成招呼语」这条流水线；会不会真的发消息由下面的自动化开关决定">
          <span className="label">流水线发送</span>
          <span className={`badge ${status?.dryRun ? 'on' : 'warn'}`}>
            {status?.dryRun ? '只出草稿' : '可确认发送'}
          </span>
        </div>
        <div className="row"><span className="label">已收集岗位</span><span className="value">{status?.jobs ?? 0} 条</span></div>
        <div className="row"><span className="label">可打招呼（HR 近期活跃）</span><span className="value">{status?.ready ?? 0} 条</span></div>
        <div className="row" title="在 BOSS 页面上点过「立即沟通」的公司；开启「自动发定制语」后，扩展按设置里的模板给这些公司发第二条">
          <span className="label">已打招呼</span><span className="value">{status?.greeted ?? 0} 条</span>
        </div>

        {/* 后面四行是「投出去之后」才用得到的，折起来把前面几行的注意力让出来 */}
        <button className="disclosure" aria-expanded={showProgress} onClick={() => setShowProgress((v) => !v)}>
          <span>后续进度{progressTotal > 0 ? ` · ${progressTotal} 条在推进` : ''}</span>
          <span className={`chev ${showProgress ? 'open' : ''}`} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>
        {showProgress && (
          <div className="fold-body">
            <div className="row"><span className="label">招聘方已回复</span><span className="value">{status?.replied ?? 0} 条</span></div>
            <div className="row"><span className="label">已写入 land-a-job（待投递）</span><span className="value">{status?.synced ?? 0} 条</span></div>
            <div className="row"><span className="label">已生成定制简历</span><span className="value">{status?.tailored ?? 0} 条</span></div>
            <div className="row"><span className="label">简历已上传到 BOSS</span><span className="value">{status?.uploaded ?? 0} 条</span></div>
            <div className="row"><span className="label">已发出简历（已投递）</span><span className="value">{status?.sent ?? 0} 条</span></div>
          </div>
        )}

        {status?.rateLimitTripped && <p className="error">已触发 BOSS 频率保护，自动停机。确认安全后点「解除保护」继续。</p>}
        {status?.lastError && <p className="error">{status.lastError}</p>}

        <div className="steps">
          <div className={`step ${currentStep === 1 ? 'active' : ''}`}>
            <div className="rail"><span className="step-no" aria-hidden="true">1</span></div>
            <div className="step-body">
              <div className="actions">
                <button className="btn primary" disabled={busy || status?.capturing} onClick={() => act({ type: 'START_CAPTURE' }, '已开始监听，正常浏览岗位列表即可')}>开始监听页面</button>
                <button className="btn" disabled={busy || !status?.capturing} onClick={() => act({ type: 'STOP_CAPTURE' }, '已停止监听')}>停止监听</button>
                <button
                  className="btn"
                  title="让会话页重新拉一次消息列表：BOSS 是单页应用，页面一直挂着就不会刷新列表"
                  disabled={busy}
                  onClick={() => act({ type: 'CHECK_REPLIES' }, '已开始检查，几秒后回来看「招聘方已回复」')}
                >检查新回复</button>
              </div>
            </div>
          </div>

          <div className={`step ${currentStep === 2 ? 'active' : ''}`}>
            <div className="rail"><span className="step-no" aria-hidden="true">2</span></div>
            <div className="step-body">
              <div className="actions">
                <button
                  className="btn"
                  title="按岗位 JD 生成一版对应简历，并导出 PDF"
                  disabled={busy || !canTailor}
                  onClick={() => act({ type: 'RUN_TAILOR', keys: replied.map((j) => j.key) }, '已按 JD 定制并导出 PDF')}
                >按 JD 定制简历（{replied.length}）</button>
                <button
                  className="btn"
                  title="把导出的 PDF 放进 BOSS 的附件库，上传由 BOSS 页面自己完成"
                  disabled={busy || tailored.length === 0}
                  onClick={() => act({ type: 'RUN_UPLOAD', keys: tailored.map((j) => j.key) }, '已提交上传，请到附件页确认')}
                >上传简历到 BOSS（{tailored.length}）</button>
              </div>
            </div>
          </div>

          <div className={`step ${currentStep === 3 ? 'active' : ''}`}>
            <div className="rail"><span className="step-no" aria-hidden="true">3</span></div>
            <div className="step-body">
              <div className="actions">
                <button
                  className="btn"
                  title="定位到对方已回复的那个会话，并检查「发简历」按钮是否可用"
                  disabled={busy || uploaded.length === 0}
                  onClick={() => act({ type: 'RUN_OPEN_CHAT', keys: uploaded.map((j) => j.key) }, '已打开对应会话，请自己确认后发送')}
                >打开聊天窗口（{uploaded.length}）</button>
              </div>
            </div>
          </div>
        </div>
        {status?.rateLimitTripped && (
          <div className="actions">
            <button className="btn" onClick={() => act({ type: 'RESET_LIMITER' }, '已解除保护')}>解除保护</button>
          </div>
        )}
      </div>

      {replied.length > 0 && (
        <>
          <h2>招聘方已回复（{replied.length}）</h2>
          <div className="card list">
            {replied.map((job) => (
              <div className="item" key={job.key}>
                <span>{job.brandName} · {job.jobName}</span>
                <span className="state" title={job.landSync ? `jobId=${job.landSync.jobId} / applicationId=${job.landSync.applicationId}` : ''}>
                  {job.landSync ? '已同步 · 待投递' : '待同步'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {tailored.length > 0 && (
        <>
          <h2>已定制简历（{tailored.length}）</h2>
          <div className="card list">
            {tailored.map((job) => (
              <div className="item" key={job.key}>
                <span>{job.brandName} · {job.jobName}</span>
                <span className="state" title={job.resumeExport ? `${job.resumeExport.fileName} · ${Math.round(job.resumeExport.bytes / 1024)}KB` : ''}>
                  {job.resumeExport ? `PDF ${Math.round(job.resumeExport.bytes / 1024)}KB` : '已定制'}
                </span>
              </div>
            ))}
          </div>
          <p className="hint">点「打开聊天窗口」会定位到对方已回复的那个会话；发送前请自己选好附件。</p>
        </>
      )}

      <h2>运行日志</h2>
      <div className="card logs">
        {logs.length === 0 ? '（暂无）' : logs.slice(-12).reverse().map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
      </div>
    </div>
  )
}
