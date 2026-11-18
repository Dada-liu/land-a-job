import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_FILTER,
  STATE_LABELS,
  STATE_ORDER,
  applyFilter,
  countByState,
  touchedAt,
} from '../../src/lib/filter.js'
import type { ActivityFilter, SortKey, StagedFilter } from '../../src/lib/filter.js'
import { sendToBackground } from '../../src/lib/messages.js'
import type { RuntimeResponse, RuntimeStatus } from '../../src/lib/messages.js'
import type { ConversationSnapshot, StagedJob, StageState } from '../../src/lib/types.js'

const ACTIVITY_OPTIONS: { key: ActivityFilter; label: string }[] = [
  { key: 'all', label: '活跃度不限' },
  { key: 'online', label: '在线' },
  { key: 'desc', label: '有活跃描述' },
  { key: 'unknown', label: '未知' },
]

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '最近动作' },
  { key: 'company', label: '公司名' },
  { key: 'state', label: '流程阶段' },
]

function timeLabel(ms?: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 刷新按钮里的转圈图标：只在手动点刷新期间挂出来，转完由组件撤掉 */
function SpinIcon() {
  return (
    <svg className="spin-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

function activityLabel(job: StagedJob): string {
  if (job.bossActive?.desc) return job.bossActive.desc
  if (job.bossActive?.online === true) return '在线'
  if (job.bossActive?.online === false) return '不在线'
  return '未知'
}

export function StagingApp() {
  const [jobs, setJobs] = useState<StagedJob[]>([])
  const [chats, setChats] = useState<ConversationSnapshot[]>([])
  const [view, setView] = useState<'jobs' | 'chats'>('jobs')
  const [chatQuery, setChatQuery] = useState('')
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  const [filter, setFilter] = useState<StagedFilter>(DEFAULT_FILTER)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [staged, s, c] = await Promise.all([
        sendToBackground<RuntimeResponse>({ type: 'GET_STAGED' }),
        sendToBackground<RuntimeResponse>({ type: 'GET_STATUS' }),
        sendToBackground<RuntimeResponse>({ type: 'GET_CONVERSATIONS' }),
      ])
      if (staged.ok && staged.staged) setJobs(staged.staged)
      else if (!staged.ok) setError(staged.error)
      if (s.ok && s.status) setStatus(s.status)
      if (c.ok && c.conversations) setChats(c.conversations)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 点刷新才转：本地读取几十毫秒就完了，补足最短时长才看得出在转，转完立刻收起 */
  const MIN_SPIN = 500
  const manualRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    const startedAt = Date.now()
    try {
      await load()
    } finally {
      const left = MIN_SPIN - (Date.now() - startedAt)
      if (left > 0) await new Promise((resolve) => setTimeout(resolve, left))
      setRefreshing(false)
    }
  }, [load, refreshing])

  /** 切回这个标签页时自动刷新：抓取在后台进行，页面不该停在旧数据上 */
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const counts = useMemo(() => countByState(jobs), [jobs])
  const visible = useMemo(() => applyFilter(jobs, filter), [jobs, filter])
  const peerChats = useMemo(() => chats
    .filter((c) => c.status === 0 && c.fromId === c.uid)
    .sort((a, b) => b.lastTS - a.lastTS), [chats])
  const visibleChats = useMemo(() => chats
    .filter((c) => !chatQuery.trim() || `${c.brandName ?? ''} ${c.lastMsg ?? ''}`.includes(chatQuery.trim()))
    .sort((a, b) => b.lastTS - a.lastTS), [chats, chatQuery])

  const stateChips: (StageState | 'all')[] = [
    'all',
    ...STATE_ORDER.filter((s) => (counts[s] ?? 0) > 0),
  ]

  function patch(next: Partial<StagedFilter>) {
    setFilter((prev) => ({ ...prev, ...next }))
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`已复制${label}`)
      setTimeout(() => setNotice(''), 2000)
    } catch (e) {
      setError(`复制失败：${(e as Error).message}`)
    }
  }

  const synced = jobs.filter((j) => j.landSync).length

  return (
    <div className="pagewrap">
      <div className="rowhead">
        <div>
          <h1 style={{ margin: 0, fontSize: 18 }}>缓存岗位</h1>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            共 {jobs.length} 条 · 已写入 land-a-job {synced} 条 · 只存在扩展本地，不发消息、不改线上数据
            {status?.capturing ? ` · 正在监听 ${status.attachedTabCount ?? 1} 个页面` : ' · 未开始监听'}
          </p>
        </div>
        <div className="actions" style={{ margin: 0 }}>
          <button
            className="btn refresh"
            disabled={loading}
            aria-busy={refreshing || undefined}
            onClick={() => void manualRefresh()}
          >
            {refreshing && <SpinIcon />}
            刷新
          </button>
        </div>
      </div>

      <div className="viewtabs">
        <button className={view === 'jobs' ? 'on' : ''} onClick={() => setView('jobs')}>
          缓存岗位 <span className="n">{jobs.length}</span>
        </button>
        <button className={view === 'chats' ? 'on' : ''} onClick={() => setView('chats')}>
          已读到的消息 <span className="n">{chats.length}</span>
        </button>
        <span className="sub">
          {view === 'chats'
            ? `其中 ${peerChats.length} 条最后发言来自对方；会话列表分页加载，少于 BOSS 页面总数时去 popup 点「检查新回复」`
            : `共 ${peerChats.length} 条会话里对方最后发言`}
        </span>
      </div>

      {view === 'jobs' && (
        <>
      <div className="toolbar">
        <input
          className="search"
          type="text"
          value={filter.q}
          placeholder="搜索公司 / 岗位 / 城市 / 薪资 / 备注"
          onChange={(e) => patch({ q: e.target.value })}
        />
        <div className="chips" style={{ marginLeft: 'auto' }}>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`chip ${filter.sort === opt.key ? 'on' : ''}`}
              onClick={() => patch({ sort: opt.key })}
            >按{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 0 }}>
        <div className="chips">
          {stateChips.map((s) => (
            <button
              key={s}
              className={`chip ${filter.state === s ? 'on' : ''}`}
              onClick={() => patch({ state: s })}
            >
              {s === 'all' ? '全部' : STATE_LABELS[s]}
              <span className="n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 0 }}>
        <div className="chips">
          {ACTIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`chip ${filter.activity === opt.key ? 'on' : ''}`}
              onClick={() => patch({ activity: opt.key })}
            >{opt.label}</button>
          ))}
        </div>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={filter.hasJd} onChange={(e) => patch({ hasJd: e.target.checked })} />
          <span>已读到 JD</span>
        </label>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={filter.drafted} onChange={(e) => patch({ drafted: e.target.checked })} />
          <span>已有招呼语</span>
        </label>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={filter.synced} onChange={(e) => patch({ synced: e.target.checked })} />
          <span>已写入 land-a-job</span>
        </label>
      </div>

      {error && <p className="error">{error}</p>}

      <table className="table">
        <colgroup>
          <col style={{ width: 92 }} />
          <col style={{ width: 132 }} />
          <col />
          <col style={{ width: 92 }} />
          <col style={{ width: 116 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 100 }} />
        </colgroup>
        <thead>
          <tr>
            <th>状态</th>
            <th>公司</th>
            <th>岗位</th>
            <th>城市</th>
            <th>薪资</th>
            <th>HR 活跃</th>
            <th>JD</th>
            <th>land-a-job</th>
            <th>最近动作</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr>
              <td colSpan={9} className="empty">
                {jobs.length === 0 ? '还没有缓存。先到 popup 点「开始监听页面」并浏览岗位列表。' : '没有符合当前筛选条件的记录。'}
              </td>
            </tr>
          )}
          {visible.map((job) => {
            const open = openKey === job.key
            return (
              <Fragment key={job.key}>
                <tr
                  className={`trow ${open ? 'open' : ''}`}
                  onClick={() => setOpenKey(open ? null : job.key)}
                >
                  <td><span className={`pill ${job.state}`}>{STATE_LABELS[job.state]}</span></td>
                  <td className="brand">{job.brandName}</td>
                  <td className="title">{job.jobName}</td>
                  <td className="nowrap">{job.city ?? '—'}</td>
                  <td className="num">{job.salaryDesc ?? '—'}</td>
                  <td className="nowrap">{activityLabel(job)}</td>
                  <td className="num">{job.jdText ? `${job.jdText.length} 字` : '—'}</td>
                  <td className="num">{job.landSync ? '已写入' : '—'}</td>
                  <td className="num">{timeLabel(touchedAt(job))}</td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={9}>
                      <div className="detail">
                        <section>
                          <h3>操作</h3>
                          <p>
                            <a href={job.url} target="_blank" rel="noreferrer">打开 BOSS 岗位页</a>
                            {job.jdText && (
                              <> · <button className="linklike" onClick={() => void copy(job.jdText!, ' JD 正文')}>复制 JD</button></>
                            )}
                            {job.greetDraft && (
                              <> · <button className="linklike" onClick={() => void copy(job.greetDraft!, '招呼语')}>复制招呼语</button></>
                            )}
                          </p>
                          <h3 style={{ marginTop: 8 }}>备注</h3>
                          <p>{job.notes ?? '—'}</p>
                        </section>
                        <section>
                          <h3>进度</h3>
                          <p>
                            抓取 {timeLabel(job.capturedAt)}<br />
                            打招呼 {timeLabel(job.greetedAt)} · 定制版发出 {timeLabel(job.greetSentAt)}<br />
                            回复 {timeLabel(job.repliedAt)}<br />
                            上传附件 {timeLabel(job.uploadedAt)} · 发出 {timeLabel(job.sentAt)}
                          </p>
                          {job.landSync && (
                            <>
                              <h3 style={{ marginTop: 8 }}>land-a-job</h3>
                              <p>
                                jobId {job.landSync.jobId}<br />
                                applicationId {job.landSync.applicationId}
                                {job.landSync.fitScore !== undefined && job.landSync.fitScore !== null && <> · 匹配度 {job.landSync.fitScore}</>}
                              </p>
                            </>
                          )}
                          {job.resumeExport && (
                            <>
                              <h3 style={{ marginTop: 8 }}>定制简历</h3>
                              <p>{job.resumeExport.fileName} · {Math.round(job.resumeExport.bytes / 1024)}KB</p>
                            </>
                          )}
                          {job.attachmentName && (
                            <p>附件名：{job.attachmentName}</p>
                          )}
                        </section>
                        <section>
                          <h3>招呼语草稿</h3>
                          <pre>{job.greetDraft ?? '未生成'}</pre>
                        </section>
                        <section>
                          <h3>JD 正文{job.jdText ? `（${job.jdText.length} 字）` : ''}</h3>
                          <pre>{job.jdText ?? '还没读到详情页'}</pre>
                        </section>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
        </>
      )}

      {view === 'chats' && (
        <>
          <div className="toolbar">
            <input
              className="search"
              type="text"
              value={chatQuery}
              placeholder="搜索公司 / 消息摘要"
              onChange={(e) => setChatQuery(e.target.value)}
            />
            <span className="sub">按最后一条消息时间倒序 · 共 {visibleChats.length} 条</span>
          </div>
          <table className="table">
            <colgroup>
              <col style={{ width: 180 }} />
              <col style={{ width: 104 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col />
              <col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr>
                <th>公司</th>
                <th>最后发言</th>
                <th>消息状态</th>
                <th>时间</th>
                <th>消息摘要</th>
                <th>会话键</th>
              </tr>
            </thead>
            <tbody>
              {visibleChats.length === 0 && (
                <tr><td colSpan={6} className="empty">还没读到会话响应。去 popup 点「检查新回复」。</td></tr>
              )}
              {visibleChats.map((c) => {
                const peer = c.status === 0 && c.fromId === c.uid
                return (
                  <tr key={`${c.uid}:${c.jobId ?? 0}:${c.msgId}`}>
                    <td className="brand">{c.brandName ?? '—'}</td>
                    <td><span className={`pill ${peer ? 'ready' : 'needs_detail'}`}>{peer ? '对方' : '我方'}</span></td>
                    <td className="num">{c.status ?? '—'}</td>
                    <td className="num">{timeLabel(c.lastTS)}</td>
                    <td className="title">{c.lastMsg || '—'}</td>
                    <td className="num">{c.uid}:{c.jobId ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {notice && <p className="ok">{notice}</p>}
      <p className="hint">
        这里看到的都是扩展暂存区里的数据。「已写入 land-a-job」表示公司回复后已经建好岗位与投递；其余记录不会上传。
      </p>
    </div>
  )
}
