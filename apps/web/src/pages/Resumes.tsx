import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, FileText, Plus, Star, Trash2 } from 'lucide-react'
// 模板 id 与中文名来自 core（领域数据），列表页因此不必加载整个编辑器与 PDF 库
import {
  RESUME_TEMPLATE_HINTS,
  RESUME_TEMPLATE_LABELS,
  RESUME_TEMPLATES,
  resumeTemplateLabel,
  type ResumeTemplateId,
} from '@land/core/resume-templates'
import {
  createResume,
  deleteResume,
  duplicateResume,
  getResume,
  listResumes,
  patchResume,
  type ResumeDto,
} from '../lib/api'
import { diffResume } from '../lib/resumeDiff'
import { Drawer } from '../components/Drawer'
import { useConfirm } from '../components/ConfirmDialog'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function Resumes() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [items, setItems] = useState<ResumeDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [originFilter, setOriginFilter] = useState<'all' | 'ai' | 'manual'>('all')
  const [compare, setCompare] = useState<{ target: ResumeDto; base: ResumeDto } | null>(null)

  /**
   * ?create=1 是给 Skill 前置检查用的深链：库里一份简历都没有时，
   * Agent 打开本机浏览器直接跳到这里，用户看到的就是「新建简历」表单，不用再找按钮。
   * 不另开路由，历史 URL /resumes 与 E2E 都不受影响。
   */
  const [creating, setCreating] = useState(
    () => new URLSearchParams(window.location.search).get('create') === '1',
  )
  const [newTitle, setNewTitle] = useState('')
  const [newTemplate, setNewTemplate] = useState<ResumeTemplateId>(RESUME_TEMPLATES[0])

  const reload = useCallback(async () => {
    try {
      const list = await listResumes()
      setItems(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleCreate = async () => {
    const title = newTitle.trim()
    if (!title) return
    setBusy('create')
    try {
      const created = await createResume({ title, templateId: newTemplate })
      setCreating(false)
      setNewTitle('')
      navigate(`/resumes/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const openCompare = async (resume: ResumeDto) => {
    if (!resume.baseResumeId) return
    try {
      const base = await getResume(resume.baseResumeId)
      setCompare({ target: resume, base })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDuplicate = async (resume: ResumeDto) => {
    setBusy(resume.id)
    try {
      await duplicateResume(resume.id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const handleDefault = async (resume: ResumeDto) => {
    setBusy(resume.id)
    try {
      await patchResume(resume.id, { isDefault: true })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (resume: ResumeDto) => {
    const confirmed = await confirm({
      title: `删除简历「${resume.title}」？`,
      description:
        resume.kind === 'master'
          ? '母版删除后，指向它的定制版会失去来源。已被投递记录引用的简历服务端会拒绝删除。'
          : '删除后无法恢复；已被投递记录引用的简历服务端会拒绝删除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    setBusy(resume.id)
    try {
      await deleteResume(resume.id)
      await reload()
    } catch (e) {
      // 被投递引用的简历不能删：服务端返回 409，这里原样提示，别吞成「删除失败」
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const filtered = (items ?? []).filter((resume) => {
    if (originFilter === 'ai') return Boolean(resume.provenance)
    if (originFilter === 'manual') return !resume.provenance
    return true
  })
  const aiCount = (items ?? []).filter((resume) => Boolean(resume.provenance)).length

  return (
    <div className="space-y-6">
      <section className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">简历</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">
            母版放通用内容，投某个岗位前复制一份改一改。投递时选了哪一版，之后就能看出「哪版简历换来了面试」。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-2 text-sm text-white transition-colors hover:bg-stone-800"
        >
          <Plus className="h-4 w-4" />
          新建简历
        </button>
      </section>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      ) : null}

      {creating ? (
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h3 className="text-sm font-medium">新建简历</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') setCreating(false)
              }}
              placeholder="例如：前端工程师-母版"
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus:border-stone-400"
            />
            <button
              type="button"
              disabled={busy === 'create' || !newTitle.trim()}
              onClick={() => void handleCreate()}
              className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy === 'create' ? '创建中…' : '创建'}
            </button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {RESUME_TEMPLATES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setNewTemplate(id)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  newTemplate === id ? 'border-stone-900 bg-stone-50' : 'border-stone-200 hover:bg-stone-50'
                }`}
              >
                <div className="text-xs font-medium text-stone-800">{RESUME_TEMPLATE_LABELS[id]}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-stone-500">{RESUME_TEMPLATE_HINTS[id]}</div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {items === null ? null : (
        <section className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-stone-500">来源</span>
          {([
            ['all', `全部 ${items.length}`],
            ['ai', `AI 改过 ${aiCount}`],
            ['manual', `人工 ${items.length - aiCount}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              data-testid={`resume-filter-${key}`}
              onClick={() => setOriginFilter(key)}
              className={`rounded border px-2 py-1 transition-colors ${
                originFilter === key
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-stone-400">标着 AI 名字的版本是 Agent 改的，改了什么都能对比出来</span>
        </section>
      )}

      {items === null ? (
        <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-400">读取中…</div>
      ) : filtered.length === 0 ? (
        <section className="rounded-xl border border-dashed border-stone-300 bg-white/60 p-8 text-center">
          <FileText className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-3 text-sm text-stone-600">还没有简历</p>
          <p className="mt-1 text-xs text-stone-400">
            点右上「新建简历」开始；也可以从旧项目导入 JSON（编辑页右上角「导入」）。
          </p>
        </section>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2" data-testid="resume-grid">
          {filtered.map((resume) => (
            <article key={resume.id} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to={`/resumes/${resume.id}`}
                    className="block truncate text-sm font-medium text-stone-900 hover:underline"
                  >
                    {resume.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                    <span className="rounded bg-stone-100 px-1.5 py-0.5">{resumeTemplateLabel(resume.templateId)}</span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5">
                      {resume.kind === 'master' ? '母版' : '定制版'}
                    </span>
                    {resume.isDefault ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">默认</span>
                    ) : null}
                    {resume.provenance ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                        {String((resume.provenance as { skill?: string }).skill ?? 'AI 生成')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Link
                  to={`/resumes/${resume.id}`}
                  className="shrink-0 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50"
                >
                  编辑
                </Link>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
                <span className="text-[11px] text-stone-400">更新于 {formatDate(resume.updatedAt)}</span>
                <div className="flex items-center gap-1">
                  {resume.baseResumeId ? (
                    <button
                      type="button"
                      data-testid="resume-compare"
                      onClick={() => void openCompare(resume)}
                      className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] text-stone-500 hover:bg-stone-50"
                    >
                      对比母版
                    </button>
                  ) : null}
                  <button
                    type="button"
                    title="设为默认简历"
                    disabled={resume.isDefault || busy === resume.id}
                    onClick={() => void handleDefault(resume)}
                    className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-amber-600 disabled:opacity-30"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="复制一份"
                    disabled={busy === resume.id}
                    onClick={() => void handleDuplicate(resume)}
                    className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="删除"
                    data-testid={`resume-delete-${resume.id}`}
                    disabled={busy === resume.id}
                    onClick={() => void handleDelete(resume)}
                    className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <Drawer
        open={Boolean(compare)}
        onClose={() => setCompare(null)}
        title={compare ? `差异 · ${compare.target.title}` : '差异'}
        subtitle={compare ? `和母版「${compare.base.title}」比，只比内容，不比排版` : ''}
        width="w-[720px]"
      >
        {compare ? <ResumeDiffView target={compare.target} base={compare.base} /> : null}
      </Drawer>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-medium">换版式，不会丢内容</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-stone-600">
          编辑页右上角随时可以换模板：只换排版，正文一个字都不动。三套模板用的是同一份内容，A 模板写的切到 B 模板也还在。
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {RESUME_TEMPLATES.map((id) => (
            <span key={id} className="rounded-md border border-stone-200 px-2 py-1 text-[11px] text-stone-600">
              {RESUME_TEMPLATE_LABELS[id]}
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * 差异视图：只列叶子字段的变化。
 * 「改了 7 处，集中在摘要与项目」这种结论比「两版不同」有用得多。
 */
function ResumeDiffView({ target, base }: { target: ResumeDto; base: ResumeDto }) {
  const diff = diffResume(base.data, target.data)
  const provenance = target.provenance as { skill?: string; skillVersion?: string; model?: string } | null

  return (
    <div className="space-y-3" data-testid="resume-diff">
      <div className="rounded-lg bg-stone-50 px-3 py-2 text-[11px] leading-relaxed text-stone-600">
        {diff.entries.length === 0 ? (
          '与母版内容完全一致（只改了标题或模板）。'
        ) : (
          <>
            共 <span className="font-mono text-stone-900">{diff.entries.length + diff.truncated}</span> 处差异
            {diff.sections.length > 0 ? `，集中在 ${diff.sections.join(' / ')}` : ''}
          </>
        )}
        {provenance?.skill ? (
          <div className="mt-1 text-[10px] text-stone-400">
            这一版是 Agent（{provenance.skill} {provenance.skillVersion}
            {provenance.model ? ` · ${provenance.model}` : ''}）帮你改的，母版是你自己写的。
          </div>
        ) : null}
      </div>

      {diff.entries.map((entry) => (
        <div key={entry.path} className="rounded border border-stone-200">
          <div className="border-b border-stone-100 bg-stone-50 px-2 py-1 font-mono text-[10px] text-stone-500">
            {entry.path}
          </div>
          <div className="grid gap-2 p-2 sm:grid-cols-2">
            <div>
              <div className="mb-0.5 text-[10px] text-stone-400">母版</div>
              <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-stone-500">
                {entry.before || '（空）'}
              </p>
            </div>
            <div>
              <div className="mb-0.5 text-[10px] text-stone-400">当前版本</div>
              <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-stone-900">
                {entry.after || '（空）'}
              </p>
            </div>
          </div>
        </div>
      ))}

      {diff.truncated > 0 ? (
        <div className="text-[10px] text-stone-400">还有 {diff.truncated} 处差异未列出（差异面板不是编辑器，先看主要改动）。</div>
      ) : null}
    </div>
  )
}
