import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Copy, CopyPlus, FileText, Plus, Star, Trash2 } from 'lucide-react'
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
// 只取纯数据模块：走 index 会把编辑器与 PDF 库一起拉进首屏
import { sampleResumeData } from '@land/resume-kit/sample-resume'
import { diffResume } from '../lib/resumeDiff'
import { Drawer } from '../components/Drawer'
import { Tooltip } from '../components/ui'
import { useConfirm } from '../components/ConfirmDialog'
import { errorText, useToast } from '../components/Toast'
import { useT } from '../i18n'

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function Resumes() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const toast = useToast()
  const t = useT()
  const [items, setItems] = useState<ResumeDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [originFilter, setOriginFilter] = useState<'all' | 'ai' | 'manual'>('all')
  /**
   * 哪几个母版下面已经被展开。只记「用户点过」的组，没点过的走默认值：
   * 全部视图默认收起（一屏先看清有几个母版），筛来源时默认展开（否则筛完只看到一行母版、以为没命中）。
   */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
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
  /**
   * 默认填一份示例内容：空白简历进编辑器只剩一张白纸，新用户看不出这套模板有哪几块。
   * 想从零写的人取消勾选即可，所以这不是强制行为。
   */
  const [withSample, setWithSample] = useState(true)

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
      const created = await createResume({
        title,
        templateId: newTemplate,
        ...(withSample ? { data: sampleResumeData() } : {}),
      })
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

  /**
   * 复制简历名（不是复制整份简历）：写 Agent 指令、对比记录时常要指名「用 XX 这一版」，
   * 名字长了手打容易错。剪贴板不可用时明确提示手动选中，不做静默失败。
   */
  const copyName = async (resume: ResumeDto) => {
    try {
      await navigator.clipboard.writeText(resume.title)
      toast.push(t('已复制简历名'), 'success')
    } catch {
      toast.push(t('复制失败，请手动选择复制'), 'error')
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
      toast.push(`已删除简历「${resume.title}」`, 'success')
    } catch (e) {
      // 被投递引用的简历不能删：服务端返回 409。这属于整页级的结论，
      // 走全局提示（页面顶部），别塞进列表上方的内嵌提示里（会看起来像某张卡片的错误）。
      toast.push(errorText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const aiCount = (items ?? []).filter((resume) => Boolean(resume.provenance)).length
  const filterActive = originFilter !== 'all'

  const matches = (resume: ResumeDto) => {
    if (originFilter === 'ai') return Boolean(resume.provenance)
    if (originFilter === 'manual') return !resume.provenance
    return true
  }

  /**
   * 分组只看关系，不看时间：谁把谁当母版，已经写在 baseResumeId 上。
   * 只有 kind='master' 能当爹——历史数据里存在「定制版指向定制版」，
   * 多级嵌套会让中间那一行从顶层消失，看到的是「简历凭空少了」。
   */
  const byId = new Map((items ?? []).map((resume) => [resume.id, resume]))
  const childrenOf = new Map<string, ResumeDto[]>()
  const rootRows: ResumeDto[] = []
  for (const resume of items ?? []) {
    const base = resume.baseResumeId ? byId.get(resume.baseResumeId) : undefined
    if (base && base.kind === 'master' && base.id !== resume.id) {
      const bucket = childrenOf.get(base.id)
      if (bucket) bucket.push(resume)
      else childrenOf.set(base.id, [resume])
    } else {
      rootRows.push(resume)
    }
  }
  // 母版自己没命中筛选、但名下有命中的定制版时，这一行仍要出来，否则「AI 改过」会全军覆没
  const visibleRows = rootRows.filter(
    (root) => matches(root) || (childrenOf.get(root.id) ?? []).some(matches),
  )

  const isOpen = (id: string) => openGroups[id] ?? filterActive
  const toggleGroup = (id: string) => setOpenGroups((prev) => ({ ...prev, [id]: !isOpen(id) }))

  /** 卡片样式与分组前逐字相同：母版和定制版用的是同一张卡，只改外面的排布 */
  const renderCard = (resume: ResumeDto) => (
    <article key={resume.id} className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* 名字独占一行截断，复制按钮跟在后面且不参与截断（shrink-0） */}
          <div className="flex min-w-0 items-center gap-1">
            <Link
              to={`/resumes/${resume.id}`}
              className="min-w-0 truncate text-sm font-medium text-stone-900 hover:underline"
            >
              {resume.title}
            </Link>
            {/* 用自绘 Tooltip 而不是 title：原生提示延迟 1 秒且鼠标一动就消失 */}
            <Tooltip label={t('复制简历名')}>
              <button
                type="button"
                aria-label={t('复制简历名')}
                data-testid={`resume-copy-name-${resume.id}`}
                onClick={() => void copyName(resume)}
                className="shrink-0 rounded p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
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
          <Tooltip label={t('设为默认简历')}>
            <button
              type="button"
              aria-label={t('设为默认简历')}
              disabled={resume.isDefault || busy === resume.id}
              onClick={() => void handleDefault(resume)}
              className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-amber-600 disabled:opacity-30"
            >
              <Star className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          {/* 图标换成 CopyPlus：上面那颗「复制简历名」已经是两块矩形，同款图标会认错 */}
          <Tooltip label={t('复制一份')}>
            <button
              type="button"
              aria-label={t('复制一份')}
              disabled={busy === resume.id}
              onClick={() => void handleDuplicate(resume)}
              className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
            >
              <CopyPlus className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
          <Tooltip label={t('删除')}>
            <button
              type="button"
              aria-label={t('删除')}
              data-testid={`resume-delete-${resume.id}`}
              disabled={busy === resume.id}
              onClick={() => void handleDelete(resume)}
              className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600 disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>
    </article>
  )

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
          <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={withSample}
              onChange={(e) => setWithSample(e.target.checked)}
              className="h-3.5 w-3.5 accent-stone-900"
            />
            先填一份示例内容，看清每块长什么样
          </label>
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
      ) : visibleRows.length === 0 ? (
        <section className="rounded-xl border border-dashed border-stone-300 bg-white/60 p-8 text-center">
          <FileText className="mx-auto h-6 w-6 text-stone-300" />
          <p className="mt-3 text-sm text-stone-600">{filterActive ? '没有符合条件的简历' : '还没有简历'}</p>
          <p className="mt-1 text-xs text-stone-400">
            {filterActive
              ? '点「全部」看看全部简历；也可能是这些版本来自另一种来源（AI 改过 / 人工）。'
              : '点右上「新建简历」开始；也可以从旧项目导入 JSON（编辑页右上角「导入」）。'}
          </p>
        </section>
      ) : (
        // 一个母版独占一行，它名下的定制版收在这一行下面
        <section className="space-y-6" data-testid="resume-grid">
          {visibleRows.map((root) => {
            const children = (childrenOf.get(root.id) ?? []).filter(matches)
            const open = isOpen(root.id)

            // 母版本身没命中筛选、只有名下的定制版命中：把命中的平铺出来，
            // 不给一行「母版卡 + 展开按钮」——那颗按钮点开只会是空
            if (!matches(root)) {
              return (
                <div key={root.id} className="grid gap-3 sm:grid-cols-2">
                  {children.map(renderCard)}
                </div>
              )
            }

            return (
              <div key={root.id}>
                {renderCard(root)}
                {children.length > 0 ? (
                  // 贴着它上面那张卡：与外层「组间距 24px」拉开，才看得出这颗按钮属于谁
                  <div className="mt-2 flex items-center">
                    <button
                      type="button"
                      data-testid={`resume-group-toggle-${root.id}`}
                      aria-expanded={open}
                      onClick={() => toggleGroup(root.id)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
                    >
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {open ? t('收起定制版') : t('展开 {n} 个定制版', { n: children.length })}
                    </button>
                  </div>
                ) : null}
                {open && children.length > 0 ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid={`resume-group-${root.id}`}>
                    {children.map(renderCard)}
                  </div>
                ) : null}
              </div>
            )
          })}
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
