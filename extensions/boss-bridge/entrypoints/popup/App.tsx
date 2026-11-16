import { useCallback, useEffect, useState } from 'react'
import { sendToBackground } from '../../src/lib/messages.js'
import type { RuntimeResponse, RuntimeStatus } from '../../src/lib/messages.js'
import type { StagedJob } from '../../src/lib/types.js'

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

/** 操作反馈统一走顶部浮层：底部两行提示用户根本扫不到（尤其 popup 已经很长时） */
type Toast = { kind: 'ok' | 'error'; text: string }

export function PopupApp() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [staged, setStaged] = useState<StagedJob[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [toast, setToast] = useState<Toast | null>(null)
  const [busy, setBusy] = useState(false)
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

  const ready = staged.filter((j) => j.state === 'ready')
  const replied = staged.filter((j) => j.state === 'replied')
  const tailored = staged.filter((j) => j.state === 'tailored')
  const uploaded = staged.filter((j) => j.state === 'uploaded')
  const sentJobs = staged.filter((j) => j.state === 'sent')
  /** 定制的前提是已落库（P2 建了 queued 投递），所以按钮只对 replied 生效 */
  const canTailor = replied.length > 0
  const drafts = ready.filter((j) => j.greetDraft)
  const allDrafts = drafts
    .map((j) => `【${j.brandName} · ${j.jobName}】\n${j.greetDraft}`)
    .join('\n\n')

  /** 回复之后才用得到的计数，折叠起来单独显示 */
  const progressTotal = replied.length + tailored.length + uploaded.length + sentJobs.length
  /** 下一步该点哪个：有回复就定制，有草稿就等回复，什么都没就先去监听 */
  const currentStep = uploaded.length > 0
    ? 4
    : replied.length > 0
      ? 3
      : drafts.length === 0
        ? (status?.capturing ? 2 : 1)
        : 0

  useEffect(() => {
    if (progressTotal > 0) setShowProgress(true)
  }, [progressTotal])

  async function copy(text: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setToast({ kind: 'ok', text: `已复制 ${text.length} 字` })
    } catch (e) {
      setToast({ kind: 'error', text: `复制失败：${(e as Error).message}` })
    }
  }

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
          <button
            className="icon"
            title="查看缓存岗位（可筛选）"
            aria-label="查看缓存岗位"
            onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('staging.html') })}
          >
            <ListIcon />
          </button>
          <button className="icon" title="刷新状态" aria-label="刷新状态" disabled={busy} onClick={() => void refresh()}>
            <RefreshIcon />
          </button>
          <button className="icon" title="设置" aria-label="设置" disabled={busy} onClick={() => void chrome.runtime.openOptionsPage()}>
            <GearIcon />
          </button>
        </div>
      </div>
      {/* 提示条正好落在副标题上：提示期间把它淡出，避免露出半截字 */}
      <p className={`sub top-sub${toast ? ' dimmed' : ''}`}>浏览 BOSS 时自动收集岗位。默认只生成招呼语草稿，不会替你发消息。</p>

      <div className="card">
        <div className="row">
          <span className="label">监听状态</span>
          <span className={`badge ${status?.capturing ? 'on' : ''}`}>
            {status?.capturing ? `监听中 · ${status.attachedTabCount ?? 1} 个页面` : '未开始'}
          </span>
        </div>
        <div className="row">
          <span className="label">发送方式</span>
          <span className={`badge ${status?.dryRun ? 'on' : 'warn'}`}>
            {status?.dryRun ? '只出草稿' : '可确认发送'}
          </span>
        </div>
        <div className="row"><span className="label">已收集岗位</span><span className="value">{status?.jobs ?? 0} 条</span></div>
        <div className="row" title="会话列表分页加载，点「检查新回复」会滚动到底把后续页读出来">
          <span className="label">已读取会话</span><span className="value">{status?.conversations ?? 0} 条</span>
        </div>
        <div className="row"><span className="label">可打招呼（HR 近期活跃）</span><span className="value">{status?.ready ?? 0} 条</span></div>
        <div className="row"><span className="label">待确认活跃度</span><span className="value">{status?.needsDetail ?? 0} 条</span></div>
        <div className="row"><span className="label">HR 不活跃（已跳过）</span><span className="value">{status?.filteredOut ?? 0} 条</span></div>

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
        {(status?.needsDetail ?? 0) > 0 && (
          <p className="sub">
            还有 {status?.needsDetail} 条岗位列表没给活跃度：点开详情页看看，或在设置里勾选「允许自动打开候选详情页」后再筛一次。
          </p>
        )}

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
                  title="按 HR 近期活跃度筛一遍，通过的岗位立即生成招呼语草稿"
                  disabled={busy}
                  onClick={() => act({ type: 'RUN_PIPELINE' }, '已筛选完成，草稿见下方')}
                >筛选并生成招呼语</button>
              </div>
            </div>
          </div>

          <div className={`step ${currentStep === 3 ? 'active' : ''}`}>
            <div className="rail"><span className="step-no" aria-hidden="true">3</span></div>
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

          <div className={`step ${currentStep === 4 ? 'active' : ''}`}>
            <div className="rail"><span className="step-no" aria-hidden="true">4</span></div>
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

      <h2>招呼语草稿（前 10 条）</h2>
      <div className="card list drafts">
        {ready.length === 0 && <p className="sub">暂无。先点「开始监听页面」并浏览岗位列表，再点「筛选并生成招呼语」。</p>}
        {ready.slice(0, 10).map((job) => (
          <div className="draft" key={job.key}>
            <div className="draft-head">
              <span className="draft-title">{job.brandName} · {job.jobName}</span>
              <button
                className="copy"
                disabled={!job.greetDraft}
                onClick={() => void copy(job.greetDraft ?? '')}
              >复制</button>
            </div>
            <p className={job.greetDraft ? 'draft-text' : 'draft-text empty'}>
              {job.greetDraft ?? '待生成（再点一次「筛选并生成招呼语」）'}
            </p>
          </div>
        ))}
      </div>
      {ready.length > 0 && (
        <div className="actions">
          <button className="btn" onClick={() => void copy(allDrafts)}>复制全部草稿（{drafts.length}）</button>
          <button
            className="btn"
            disabled={busy || drafts.length === 0}
            onClick={() => act({ type: 'CLEAR_DRAFTS' }, '草稿已清空，再点「筛选并生成招呼语」按当前模板重写')}
          >重生成草稿</button>
        </div>
      )}
      <p className="hint">复制后到 BOSS 聊天页粘贴发送。扩展不会替你点发送，最后一击永远是你。</p>

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
