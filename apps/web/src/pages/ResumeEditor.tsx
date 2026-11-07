import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileJson, PanelRightClose, PanelRightOpen, Upload } from 'lucide-react'
import {
  buildResumeFileName,
  EDITOR_MODULES,
  EditorPanel,
  exportResumePdf,
  normalizeResumeData,
  ResumeEditorProvider,
  ResumePreview,
  templateCatalog,
  templateName,
  type ResumeData,
} from '@land/resume-kit'
import {
  ApiError,
  getResume,
  patchResume,
  type ResumeDto,
  type ResumePatchInput,
} from '../lib/api'
import { Select } from '../components/ui'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

const SAVE_DEBOUNCE_MS = 500

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '未修改',
  dirty: '待保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  conflict: '有冲突',
}

const SAVE_COLOR: Record<SaveState, string> = {
  idle: 'text-stone-400',
  dirty: 'text-amber-600',
  saving: 'text-stone-500',
  saved: 'text-emerald-600',
  error: 'text-red-600',
  conflict: 'text-red-600',
}

function hasContent(data: ResumeData): boolean {
  return Boolean(
    data.personalInfo.name.trim() ||
      data.personalInfo.jobTitle.trim() ||
      data.selfIntroduction.trim() ||
      data.experiences.length ||
      data.educations.length ||
      data.skills.length ||
      data.projects.length ||
      data.contacts.length,
  )
}

export default function ResumeEditor() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const [resume, setResume] = useState<ResumeDto | null>(null)
  const [draft, setDraft] = useState<ResumeData | null>(null)
  const [title, setTitle] = useState('')
  const [activeEditor, setActiveEditor] = useState<string | null>('personalInfo')
  const [panelOpen, setPanelOpen] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const previewRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const updatedAtRef = useRef<string>('')
  const pendingRef = useRef<ResumeData | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  /** 冲突未解决前停止自动保存：否则每次按键都会再撞一次 409 */
  const blockedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await getResume(id)
        if (cancelled) return
        setResume(loaded)
        setTitle(loaded.title)
        setDraft(normalizeResumeData(loaded.data))
        updatedAtRef.current = loaded.updatedAt
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const runSave = useCallback(
    async (data: ResumeData, options: { force?: boolean; extra?: ResumePatchInput } = {}) => {
      setSaveState('saving')
      try {
        const body: ResumePatchInput = { data, ...options.extra }
        // force 用于「用户确认用我的版本覆盖」：不带 expectedUpdatedAt，服务端就不再判过期
        if (!options.force) body.expectedUpdatedAt = updatedAtRef.current
        const updated = await patchResume(id, body)
        updatedAtRef.current = updated.updatedAt
        blockedRef.current = false
        setSaveState('saved')
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
        setMessage(null)
      } catch (e) {
        if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
          blockedRef.current = true
          setSaveState('conflict')
          return
        }
        setSaveState('error')
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [id],
  )

  const scheduleSave = useCallback(
    (data: ResumeData) => {
      pendingRef.current = data
      if (blockedRef.current) return
      setSaveState('dirty')
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        const next = pendingRef.current
        pendingRef.current = null
        if (next) void runSave(next)
      }, SAVE_DEBOUNCE_MS)
    },
    [runSave],
  )

  const handleChange = useCallback(
    (next: ResumeData) => {
      setDraft(next)
      scheduleSave(next)
    },
    [scheduleSave],
  )

  // 离开页面前把未落盘的改动发出去：500ms 防抖窗口内点返回，内容不该丢
  useEffect(() => {
    return () => {
      window.clearTimeout(timerRef.current)
      const pending = pendingRef.current
      if (pending && !blockedRef.current) void runSave(pending)
    }
  }, [runSave])

  useEffect(() => {
    if (!draft) return
    const handler = (event: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') event.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [draft, saveState])

  const handleTemplateChange = async (templateId: string) => {
    if (!resume) return
    setResume({ ...resume, templateId })
    try {
      const updated = await patchResume(id, { templateId, expectedUpdatedAt: updatedAtRef.current })
      updatedAtRef.current = updated.updatedAt
      setMessage(null)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleTitleCommit = async () => {
    const next = title.trim()
    if (!resume || !next || next === resume.title) return
    try {
      const updated = await patchResume(id, { title: next, expectedUpdatedAt: updatedAtRef.current })
      updatedAtRef.current = updated.updatedAt
      setResume(updated)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  const handleExportPdf = async () => {
    if (!previewRef.current || !draft) return
    setExporting(true)
    try {
      await exportResumePdf(previewRef.current, { filename: buildResumeFileName(draft, title) })
    } catch (e) {
      setMessage(`PDF 导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportJson = () => {
    if (!draft) return
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${title || '简历'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImportJson = async (file: File) => {
    const text = await file.text()
    try {
      const parsed = normalizeResumeData(JSON.parse(text))
      if (!hasContent(parsed) && !window.confirm('这个文件里没有可识别的简历内容，仍要导入吗？')) return
      setDraft(parsed)
      await runSave(parsed)
      setMessage(`已导入 ${file.name}`)
    } catch {
      setMessage('导入失败：不是合法的 JSON，或结构无法识别')
    }
  }

  const resolveConflictReload = async () => {
    const latest = await getResume(id)
    setResume(latest)
    setTitle(latest.title)
    setDraft(normalizeResumeData(latest.data))
    updatedAtRef.current = latest.updatedAt
    blockedRef.current = false
    pendingRef.current = null
    setSaveState('idle')
    setMessage('已载入服务端最新版本')
  }

  const resolveConflictOverwrite = async () => {
    if (!draft) return
    blockedRef.current = false
    await runSave(draft, { force: true })
    setMessage('已用当前版本覆盖')
  }

  if (loadError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          无法打开简历：{loadError}
        </div>
        <Link to="/resumes" className="mt-3 inline-block text-sm text-stone-600 underline">
          返回简历列表
        </Link>
      </div>
    )
  }

  if (!draft || !resume) {
    return <div className="p-6 text-sm text-stone-400">读取简历…</div>
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/resumes')}
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            title="返回简历列表"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void handleTitleCommit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="w-52 rounded-md border border-transparent px-2 py-1 text-sm font-medium text-stone-900 hover:border-stone-200 focus:border-stone-900 focus:outline-none"
          />
          <span className="hidden items-center gap-1 text-[11px] text-stone-400 sm:flex">
            <span className={`${SAVE_COLOR[saveState]}`}>{SAVE_LABEL[saveState]}</span>
            {saveState === 'saved' && savedAt ? <span className="text-stone-300">· {savedAt}</span> : null}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            value={resume.templateId}
            onChange={(e) => void handleTemplateChange(e.target.value)}
            className="w-44"
            data-testid="resume-template"
            aria-label="版式"
            title={`当前版式：${templateName(resume.templateId)}；切换只换排版，不动内容`}
            options={templateCatalog.map((template) => ({ value: template.id, label: template.name }))}
          />

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleImportJson(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 hover:text-stone-900"
          >
            <Upload className="h-3.5 w-3.5" />
            导入
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50 hover:text-stone-900"
          >
            <FileJson className="h-3.5 w-3.5" />
            JSON
          </button>
          <button
            type="button"
            onClick={() => void handleExportPdf()}
            disabled={exporting}
            className="inline-flex items-center gap-1 rounded-md bg-stone-900 px-2.5 py-1 text-xs text-white hover:bg-stone-800 disabled:cursor-wait disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? '导出中…' : '导出 PDF'}
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            title={panelOpen ? '收起编辑区' : '打开编辑区'}
          >
            {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {saveState === 'conflict' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span>
            这份简历已被其他会话（例如 Agent 通过 MCP）改过，自动保存已暂停。
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void resolveConflictReload()}
              className="rounded bg-white px-2 py-1 text-amber-800 ring-1 ring-amber-300"
            >
              载入服务端版本
            </button>
            <button
              type="button"
              onClick={() => void resolveConflictOverwrite()}
              className="rounded bg-amber-700 px-2 py-1 text-white"
            >
              用我的版本覆盖
            </button>
          </span>
        </div>
      ) : null}

      {message ? (
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs text-stone-600">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="text-stone-400 hover:text-stone-900">
            关闭
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <ResumeEditorProvider
          value={draft}
          onChange={handleChange}
          activeEditor={activeEditor}
          onActiveEditorChange={setActiveEditor}
        >
          <ResumePreview
            ref={previewRef}
            data={draft}
            templateId={resume.templateId}
            footer={saveState === 'saving' ? '正在保存…' : undefined}
          />
          {panelOpen ? (
            <div className="hidden shrink-0 md:block">
              <EditorPanel
                modules={EDITOR_MODULES}
                activeEditor={activeEditor}
                onToggle={setActiveEditor}
              />
            </div>
          ) : null}
        </ResumeEditorProvider>
      </div>
    </div>
  )
}
