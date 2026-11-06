import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createQuestion,
  deleteQuestion,
  listApplications,
  listInterviews,
  listJobs,
  listQuestions,
  patchQuestion,
  type AnswerScoreDto,
  type ApplicationListItemDto,
  type QuestionDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { Drawer } from '../components/Drawer'
import { useConfirm } from '../components/ConfirmDialog'
import { errorText, useToast } from '../components/Toast'

const CATEGORY_LABELS: Record<string, string> = {
  tech: '技术',
  project: '项目',
  behavior: '行为',
  risk: '风险追问',
  company: '公司了解',
  other: '其他',
}

const ORIGIN_LABELS: Record<string, string> = {
  generated: 'AI 生成',
  manual: '人工录入',
  imported: '导入',
}

const SCORE_DIMENSIONS = [
  { key: 'content', label: '内容', hint: '有没有答到点上、有没有具体事实' },
  { key: 'structure', label: '结构', hint: '是否分层清晰、有结论先行' },
  { key: 'delivery', label: '表达', hint: '节奏、语速、有没有口头禅' },
] as const

/** 题库条目的「上下文」：题目本身只存 jobId/interviewId，公司与轮次靠关联推出来 */
interface QuestionMeta {
  company: string | null
  jobTitle: string | null
  round: number | null
}

const RADAR_SIZE = 108
const RADAR_CENTER = RADAR_SIZE / 2
const RADAR_RADIUS = 38

function radarPoint(index: number, ratio: number): [number, number] {
  const angle = ((-90 + index * 120) * Math.PI) / 180
  return [
    RADAR_CENTER + Math.cos(angle) * RADAR_RADIUS * ratio,
    RADAR_CENTER + Math.sin(angle) * RADAR_RADIUS * ratio,
  ]
}

function polygon(ratios: number[]): string {
  return ratios.map((ratio, index) => radarPoint(index, ratio).join(',')).join(' ')
}

/**
 * 三维评分雷达。
 *
 * 用雷达而不是三个进度条：这三项之间会互相拉扯（内容满分但表达 2 分是典型的「会做不会讲」），
 * 三角形一瘪就看得出来。缺评的那一维按 0 画但在下面标「未评」，不假装有分。
 */
function AnswerRadar({ score }: { score: AnswerScoreDto | null }) {
  const values = SCORE_DIMENSIONS.map((dimension) => score?.[dimension.key] ?? 0)
  const ratios = values.map((value) => Math.max(0, Math.min(5, value)) / 5)
  const rated = score ? SCORE_DIMENSIONS.filter((dimension) => typeof score[dimension.key] === 'number').length : 0

  return (
    <svg
      width={RADAR_SIZE}
      height={RADAR_SIZE}
      viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`}
      data-testid="answer-radar"
      data-values={values.join(',')}
      role="img"
      aria-label={`内容 ${values[0]}、结构 ${values[1]}、表达 ${values[2]}`}
    >
      {[1, 0.66, 0.33].map((ratio) => (
        <polygon
          key={ratio}
          points={polygon([ratio, ratio, ratio])}
          fill="none"
          stroke="#e7e5e4"
          strokeWidth={1}
        />
      ))}
      {SCORE_DIMENSIONS.map((dimension, index) => {
        const [x, y] = radarPoint(index, 1)
        return <line key={dimension.key} x1={RADAR_CENTER} y1={RADAR_CENTER} x2={x} y2={y} stroke="#e7e5e4" strokeWidth={1} />
      })}
      <polygon
        points={polygon(ratios)}
        fill={rated > 0 ? 'rgba(28,25,23,0.14)' : 'none'}
        stroke={rated > 0 ? '#1c1917' : '#d6d3d1'}
        strokeWidth={1.5}
      />
      {SCORE_DIMENSIONS.map((dimension, index) => {
        const [x, y] = radarPoint(index, 1.28)
        const value = score?.[dimension.key]
        return (
          <text
            key={dimension.key}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill={typeof value === 'number' ? '#44403c' : '#a8a29e'}
          >
            {typeof value === 'number' ? `${dimension.label} ${value}` : dimension.label}
          </text>
        )
      })}
    </svg>
  )
}

const EMPTY_FORM = {
  category: 'tech',
  question: '',
  intent: '',
  linkedItem: '',
  myAnswer: '',
  improvement: '',
  content: '',
  structure: '',
  delivery: '',
}

export default function Bank() {
  const client = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [company, setCompany] = useState('')
  const [round, setRound] = useState('')
  const [category, setCategory] = useState('')
  const [origin, setOrigin] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<QuestionDto | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const interviewFilter = params.get('interviewId') ?? ''

  const questions = useQuery({ queryKey: qk.questions, queryFn: () => listQuestions({ limit: 200 }) })
  const interviews = useQuery({ queryKey: qk.interviews, queryFn: () => listInterviews() })
  const applications = useQuery({ queryKey: qk.applications, queryFn: () => listApplications({ limit: 200 }) })
  const jobs = useQuery({ queryKey: qk.jobs({ limit: 200 }), queryFn: () => listJobs({ limit: 200 }) })

  const appById = useMemo(() => {
    const map = new Map<string, ApplicationListItemDto>()
    for (const item of applications.data ?? []) map.set(item.id, item)
    return map
  }, [applications.data])

  const metaById = useMemo(() => {
    const map = new Map<string, QuestionMeta>()
    const jobById = new Map((jobs.data ?? []).map((job) => [job.id, job]))
    const interviewById = new Map((interviews.data ?? []).map((interview) => [interview.id, interview]))

    for (const question of questions.data ?? []) {
      const interview = question.interviewId ? interviewById.get(question.interviewId) : undefined
      const app = interview ? appById.get(interview.applicationId) : undefined
      const job = question.jobId ? jobById.get(question.jobId) : app?.jobId ? jobById.get(app.jobId) : undefined
      map.set(question.id, {
        company: app?.companyName ?? job?.companyName ?? null,
        jobTitle: app?.jobTitle ?? job?.title ?? null,
        round: interview?.round ?? null,
      })
    }
    return map
  }, [questions.data, interviews.data, jobs.data, appById])

  const companyOptions = useMemo(() => {
    const names = new Set<string>()
    // 筛选器只列出「题库里真有的公司」，不把整个公司库塞进下拉
    for (const question of questions.data ?? []) {
      const name = metaById.get(question.id)?.company
      if (name) names.add(name)
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [questions.data, metaById])

  const roundOptions = useMemo(() => {
    const rounds = new Set<number>()
    for (const question of questions.data ?? []) {
      const value = metaById.get(question.id)?.round
      if (typeof value === 'number') rounds.add(value)
    }
    return [...rounds].sort((a, b) => a - b)
  }, [questions.data, metaById])

  const filtered = useMemo(() => {
    return (questions.data ?? []).filter((question) => {
      const meta = metaById.get(question.id)
      if (interviewFilter && question.interviewId !== interviewFilter) return false
      if (company && meta?.company !== company) return false
      if (round && String(meta?.round ?? '') !== round) return false
      if (category && question.category !== category) return false
      if (origin && question.origin !== origin) return false
      return true
    })
  }, [questions.data, metaById, interviewFilter, company, round, category, origin])

  const stats = useMemo(() => {
    let answered = 0
    let scoreSum = 0
    let scoreCount = 0
    let improved = 0
    for (const question of filtered) {
      if (question.myAnswer && question.myAnswer.trim().length > 0) answered += 1
      if (question.improvement && question.improvement.trim().length > 0) improved += 1
      for (const dimension of SCORE_DIMENSIONS) {
        const value = question.score?.[dimension.key]
        if (typeof value === 'number') {
          scoreSum += value
          scoreCount += 1
        }
      }
    }
    return {
      total: filtered.length,
      answered,
      improved,
      avg: scoreCount > 0 ? scoreSum / scoreCount : null,
    }
  }, [filtered])

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: qk.questions })
  }

  const save = useMutation({
    mutationFn: () => {
      const score: AnswerScoreDto = {}
      for (const dimension of SCORE_DIMENSIONS) {
        const raw = form[dimension.key]
        if (raw) score[dimension.key] = Number(raw)
      }
      const payload = {
        category: form.category,
        question: form.question.trim(),
        intent: form.intent || null,
        linkedItem: form.linkedItem || null,
        myAnswer: form.myAnswer || null,
        improvement: form.improvement || null,
        score: Object.keys(score).length > 0 ? score : null,
      }
      if (editing) return patchQuestion(editing.id, payload)
      // 人工录入不带 provenance：这是 Web 上手动写的题，不是 Agent 产出的
      return createQuestion({ ...payload, origin: 'manual', interviewId: interviewFilter || null })
    },
    onSuccess: () => {
      toast.push(editing ? '题目已更新' : '题目已加入题库', 'success')
      invalidate()
      setOpen(false)
    },
    onError: (error) => toast.push(`保存失败：${errorText(error)}`, 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteQuestion(id),
    onSuccess: () => {
      toast.push('已删除', 'success')
      invalidate()
      setOpen(false)
    },
    onError: (error) => toast.push(`删除失败：${errorText(error)}`, 'error'),
  })

  const handleDelete = async (question: QuestionDto) => {
    const confirmed = await confirm({
      title: '删除这道题？',
      description: `「${question.question.slice(0, 60)}${question.question.length > 60 ? '…' : ''}」连同你的答案与评分一起删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (confirmed) remove.mutate(question.id)
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  const openEdit = (question: QuestionDto) => {
    setEditing(question)
    setForm({
      category: question.category,
      question: question.question,
      intent: question.intent ?? '',
      linkedItem: question.linkedItem ?? '',
      myAnswer: question.myAnswer ?? '',
      improvement: question.improvement ?? '',
      content: question.score?.content ? String(question.score.content) : '',
      structure: question.score?.structure ? String(question.score.structure) : '',
      delivery: question.score?.delivery ? String(question.score.delivery) : '',
    })
    setOpen(true)
  }

  const clearInterviewFilter = () => {
    const next = new URLSearchParams(params)
    next.delete('interviewId')
    setParams(next)
  }

  if (questions.status === 'pending') return <div className="p-2 text-sm text-stone-400">读取中…</div>
  if (questions.status === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        题库读取失败：{errorText(questions.error)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="题库"
        description="每次被问到的题都记在这，并标上它考的是你哪段经历。面完当天就写答案和评分——隔三天基本只剩下「好像问过」。"
        actions={
          <Button variant="primary" data-testid="bank-new" onClick={openCreate}>
            手动加题
          </Button>
        }
      />

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-600">公司</span>
            <Select
              data-testid="bank-filter-company"
              className="w-40"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            >
              <option value="">全部公司</option>
              {companyOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-600">轮次</span>
            <Select
              data-testid="bank-filter-round"
              className="w-28"
              value={round}
              onChange={(event) => setRound(event.target.value)}
            >
              <option value="">全部轮次</option>
              {roundOptions.map((value) => (
                <option key={value} value={String(value)}>
                  第 {value} 轮
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-600">类别</span>
            <Select className="w-32" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">全部类别</option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-stone-600">来源</span>
            <Select className="w-32" value={origin} onChange={(event) => setOrigin(event.target.value)}>
              <option value="">全部来源</option>
              {Object.entries(ORIGIN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          {interviewFilter ? (
            <Button onClick={clearInterviewFilter}>只看本场面试 ✕</Button>
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-[11px] text-stone-500" data-testid="bank-stats">
            <span>
              共 <span className="font-mono text-stone-900">{stats.total}</span> 题
            </span>
            <span>
              已答 <span className="font-mono text-stone-900">{stats.answered}</span>
            </span>
            <span>
              已写改进 <span className="font-mono text-stone-900">{stats.improved}</span>
            </span>
            <span>
              平均分{' '}
              <span className="font-mono text-stone-900" data-testid="bank-avg-score">
                {stats.avg === null ? '—' : stats.avg.toFixed(1)}
              </span>
            </span>
          </div>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            title={questions.data?.length ? '这些条件下没有题' : '题库还是空的'}
            hint={
              questions.data?.length
                ? '换个筛选条件试试；也可以直接手动加题。'
                : '让 Agent 用 job-prep Skill 按 JD 和简历出一套题（会写回这台电脑），面完再来这页补答案和评分。'
            }
            action={
              <Button variant="primary" onClick={openCreate}>
                手动加题
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((question) => {
            const meta = metaById.get(question.id)
            const answered = Boolean(question.myAnswer && question.myAnswer.trim().length > 0)
            return (
              <Card key={question.id} className="p-4" data-testid="bank-item" data-question-id={question.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">
                        {CATEGORY_LABELS[question.category] ?? question.category}
                      </span>
                      {meta?.round ? (
                        <span className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-600">第 {meta.round} 轮</span>
                      ) : null}
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          question.origin === 'generated' ? 'bg-amber-50 text-amber-700' : 'bg-stone-100 text-stone-500'
                        }`}
                        title={
                          question.provenance
                            ? `${question.provenance.skill} ${question.provenance.skillVersion}${question.provenance.model ? ` · ${question.provenance.model}` : ''}`
                            : '人工录入'
                        }
                      >
                        {ORIGIN_LABELS[question.origin] ?? question.origin}
                      </span>
                      {answered ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">已答</span>
                      ) : (
                        <span className="rounded bg-stone-50 px-1.5 py-0.5 text-stone-400">未答</span>
                      )}
                    </div>
                    <p className="text-xs font-medium leading-relaxed text-stone-900">{question.question}</p>
                    <div className="mt-1 text-[10px] text-stone-400">
                      {[meta?.company, meta?.jobTitle, question.linkedItem].filter(Boolean).join(' · ') || '未关联公司与岗位'}
                    </div>
                  </div>
                  <AnswerRadar score={question.score} />
                </div>

                {question.intent ? (
                  <p className="mt-2 rounded bg-stone-50 px-2 py-1.5 text-[11px] leading-relaxed text-stone-600">
                    考点：{question.intent}
                  </p>
                ) : null}

                {answered ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-stone-500 hover:text-stone-700">我的答案</summary>
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-stone-600">{question.myAnswer}</p>
                  </details>
                ) : null}

                {question.improvement ? (
                  <p className="mt-2 border-l-2 border-amber-300 pl-2 text-[11px] leading-relaxed text-stone-600">
                    改进：{question.improvement}
                  </p>
                ) : null}

                <div className="mt-2.5 flex gap-1.5">
                  <Button data-testid="bank-edit" onClick={() => openEdit(question)}>
                    {answered ? '改答案 / 评分' : '录答案 / 评分'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? '编辑题目' : '手动加题'}
        subtitle="每项给 1–5 分，只能填整数；没把握就空着，瞎打分比空着更糟"
        footer={
          <div className="flex items-center justify-between">
            <div>
              {editing ? (
                <Button variant="danger" onClick={() => void handleDelete(editing)}>
                  删除
                </Button>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button
                variant="primary"
                data-testid="bank-save"
                disabled={form.question.trim().length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="类别">
              <Select
                data-testid="bank-category"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="考的是哪段经历 / 哪条 JD 要求" hint="留空就等于承认「不知道这题到底在考什么」">
              <Input
                data-testid="bank-linked-item"
                value={form.linkedItem}
                onChange={(event) => setForm({ ...form, linkedItem: event.target.value })}
              />
            </Field>
          </div>
          <Field label="题目">
            <Textarea
              rows={2}
              data-testid="bank-question"
              value={form.question}
              onChange={(event) => setForm({ ...form, question: event.target.value })}
            />
          </Field>
          <Field label="考点（面试官想确认什么）">
            <Input value={form.intent} onChange={(event) => setForm({ ...form, intent: event.target.value })} />
          </Field>
          <Field label="我的答案">
            <Textarea
              rows={4}
              data-testid="bank-answer"
              value={form.myAnswer}
              onChange={(event) => setForm({ ...form, myAnswer: event.target.value })}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            {SCORE_DIMENSIONS.map((dimension) => (
              <Field key={dimension.key} label={dimension.label} hint={dimension.hint}>
                <Select
                  data-testid={`bank-score-${dimension.key}`}
                  value={form[dimension.key]}
                  onChange={(event) => setForm({ ...form, [dimension.key]: event.target.value })}
                >
                  <option value="">未评</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <Field label="改进（具体到「哪一句该怎么说」）">
            <Textarea
              rows={3}
              data-testid="bank-improvement"
              value={form.improvement}
              onChange={(event) => setForm({ ...form, improvement: event.target.value })}
            />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
