import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createInterview,
  deleteInterview,
  listApplications,
  listInterviews,
  patchInterview,
  type ApplicationListItemDto,
  type InterviewDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { Drawer } from '../components/Drawer'
import { AgentHandoff } from '../components/AgentHandoff'
import { useConfirm } from '../components/ConfirmDialog'
import { errorText, useToast } from '../components/Toast'

const KIND_LABELS: Record<string, string> = {
  phone: '电话面',
  tech: '技术面',
  manager: '主管面',
  hr: 'HR 面',
  cross: '交叉面',
  final: '终面',
}

const RESULT_LABELS: Record<string, string> = {
  pending: '待定',
  passed: '通过',
  failed: '未通过',
  cancelled: '已取消',
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function monthMatrix(year: number, month: number): Date[] {
  // 以周一为起始：js 的 getDay() 里周日是 0，这里换算成 0=周一
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
}

const PREP_LABELS: Record<string, string> = {
  none: '未准备',
  planned: '已排计划',
  ready: '已备好',
  done: '已完成',
}

const RATING_HINTS = ['', '答不上来', '勉强凑合', '及格', '不错', '很稳']

const EMPTY_FORM = {
  applicationId: '',
  round: '1',
  kind: 'tech',
  scheduledAt: '',
  durationMin: '60',
  format: 'video',
  location: '',
  notes: '',
  prepStatus: 'none',
  feedback: '',
  selfRating: '',
}

export default function Interviews() {
  const client = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<InterviewDto | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [params, setParams] = useSearchParams()
  // 从总览的「去复盘」跳过来时带 ?interview=<id>：直接展开那一场，少点一次
  const pendingOpen = params.get('interview')

  const interviews = useQuery({ queryKey: qk.interviews, queryFn: () => listInterviews() })
  const applications = useQuery({ queryKey: qk.applications, queryFn: () => listApplications({ limit: 200 }) })

  const appById = useMemo(() => {
    const map = new Map<string, ApplicationListItemDto>()
    for (const item of applications.data ?? []) map.set(item.id, item)
    return map
  }, [applications.data])

  const months = useMemo(() => monthMatrix(cursor.year, cursor.month), [cursor])
  const monthLabel = `${cursor.year} 年 ${cursor.month + 1} 月`

  const byDay = useMemo(() => {
    const map = new Map<string, InterviewDto[]>()
    for (const interview of interviews.data ?? []) {
      if (!interview.scheduledAt) continue
      const date = new Date(interview.scheduledAt)
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      const list = map.get(key)
      if (list) list.push(interview)
      else map.set(key, [interview])
    }
    return map
  }, [interviews.data])

  const monthList = useMemo(() => {
    return (interviews.data ?? [])
      .filter((interview) => {
        if (!interview.scheduledAt) return false
        const date = new Date(interview.scheduledAt)
        return date.getFullYear() === cursor.year && date.getMonth() === cursor.month
      })
      .sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''))
  }, [interviews.data, cursor])

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: qk.interviews })
    void client.invalidateQueries({ queryKey: qk.dashboard })
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        round: Number(form.round),
        kind: form.kind,
        scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
        durationMin: form.durationMin ? Number(form.durationMin) : null,
        format: form.format,
        location: form.location || null,
        notes: form.notes || null,
        prepStatus: form.prepStatus,
        feedback: form.feedback.trim() ? form.feedback : null,
        selfRating: form.selfRating ? Number(form.selfRating) : null,
      }
      return editing
        ? patchInterview(editing.id, payload)
        : createInterview({ applicationId: form.applicationId, ...payload })
    },
    onSuccess: () => {
      toast.push(editing ? '面试已更新' : '面试已安排', 'success')
      invalidate()
      setOpen(false)
    },
    onError: (error) => toast.push(`保存失败：${errorText(error)}`, 'error'),
  })

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => patchInterview(id, patch),
    onSuccess: () => {
      toast.push('已更新', 'success')
      invalidate()
    },
    onError: (error) => toast.push(`更新失败：${errorText(error)}`, 'error'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteInterview(id),
    onSuccess: () => {
      toast.push('已删除', 'success')
      invalidate()
      setOpen(false)
    },
    onError: (error) => toast.push(`删除失败：${errorText(error)}`, 'error'),
  })

  const handleDelete = async (interview: InterviewDto) => {
    const confirmed = await confirm({
      title: '删除这场面试？',
      description: `第 ${interview.round} 轮（${KIND_LABELS[interview.kind] ?? interview.kind}）连同复盘记录一起删除，无法恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (confirmed) remove.mutate(interview.id)
  }

  const openCreate = (day?: Date) => {
    setEditing(null)
    const base = day ?? new Date()
    const slot = new Date(base)
    slot.setHours(10, 0, 0, 0)
    setForm({ ...EMPTY_FORM, scheduledAt: toLocalInput(slot.toISOString()) })
    setOpen(true)
  }

  const openEdit = (interview: InterviewDto) => {
    setEditing(interview)
    setForm({
      applicationId: interview.applicationId,
      round: String(interview.round),
      kind: interview.kind,
      scheduledAt: toLocalInput(interview.scheduledAt),
      durationMin: interview.durationMin ? String(interview.durationMin) : '',
      format: interview.format ?? 'video',
      location: interview.location ?? '',
      notes: interview.notes ?? '',
      prepStatus: interview.prepStatus,
      feedback: interview.feedback ?? '',
      selfRating: interview.selfRating ? String(interview.selfRating) : '',
    })
    setOpen(true)
  }

  const autoOpened = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingOpen || autoOpened.current === pendingOpen) return
    const target = (interviews.data ?? []).find((item) => item.id === pendingOpen)
    if (!target) return
    autoOpened.current = pendingOpen
    openEdit(target)
    // 打开后立刻把参数抹掉：否则关掉抽屉刷新页面又弹回来
    const next = new URLSearchParams(params)
    next.delete('interview')
    setParams(next, { replace: true })
    // openEdit/params 每次渲染都是新引用，只以 pendingOpen 与数据到位为准
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpen, interviews.data])

  const shift = (delta: number) => {
    const next = new Date(cursor.year, cursor.month + delta, 1)
    setCursor({ year: next.getFullYear(), month: next.getMonth() })
  }

  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const activeApps = (applications.data ?? []).filter(
    (item) => !['rejected', 'ghosted', 'withdrawn', 'accepted'].includes(item.status),
  )

  return (
    <div>
      <PageHeader
        title="面试"
        description="左边日历看这个月的面试节奏，右边列表看每一场的细节。面完 3 天还没写复盘，总览的今日待办会提醒你。"
        actions={
          <>
            <Button onClick={() => shift(-1)}>上一月</Button>
            <span className="w-28 text-center text-xs text-stone-600">{monthLabel}</span>
            <Button onClick={() => shift(1)}>下一月</Button>
            <Button
              onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            >
              今天
            </Button>
            <Button variant="primary" onClick={() => openCreate()}>
              安排面试
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-3">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <div key={day} className="pb-1 text-center text-[10px] text-stone-400">
                {day}
              </div>
            ))}
            {months.map((day) => {
              const key = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
              const inMonth = day.getMonth() === cursor.month
              const items = byDay.get(key) ?? []
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => openCreate(day)}
                  className={[
                    'h-[74px] rounded-md border p-1 text-left transition-colors',
                    inMonth ? 'border-stone-200 bg-white hover:border-stone-300' : 'border-transparent bg-stone-50/50',
                    key === todayKey ? 'ring-1 ring-stone-900' : '',
                  ].join(' ')}
                >
                  <div className={`text-[10px] ${inMonth ? 'text-stone-500' : 'text-stone-300'}`}>{day.getDate()}</div>
                  <div className="mt-0.5 space-y-0.5">
                    {items.slice(0, 2).map((item) => (
                      <div
                        key={item.id}
                        onClick={(event) => {
                          event.stopPropagation()
                          openEdit(item)
                        }}
                        className="truncate rounded bg-amber-50 px-1 py-0.5 text-[9px] leading-tight text-amber-800"
                      >
                        {new Date(item.scheduledAt!).getHours()}:{pad(new Date(item.scheduledAt!).getMinutes())}{' '}
                        {appById.get(item.applicationId)?.companyName ?? ''}
                      </div>
                    ))}
                    {items.length > 2 ? (
                      <div className="text-[9px] text-stone-400">+{items.length - 2} 场</div>
                    ) : null}
                  </div>
                </button>
              )
            })}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-medium text-stone-900">本月面试</h3>
            <span className="text-[11px] text-stone-400">{monthList.length} 场</span>
          </div>
          {monthList.length === 0 ? (
            <EmptyState title="这个月没有面试" hint="点日历上任意一天就能安排；如果面试已经在路上，先去投递详情把状态推到「面试中」。" />
          ) : (
            <ul className="space-y-2">
              {monthList.map((interview) => {
                const app = appById.get(interview.applicationId)
                return (
                  <li key={interview.id} className="rounded-lg border border-stone-200 p-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <button type="button" onClick={() => openEdit(interview)} className="truncate text-xs font-medium text-stone-900 hover:underline">
                        {app?.companyName ?? '未知公司'} · {app?.jobTitle ?? '未知岗位'}
                      </button>
                      <span className="shrink-0 font-mono text-[10px] text-stone-400">
                        {interview.scheduledAt ? toLocalInput(interview.scheduledAt).replace('T', ' ') : '未定时间'}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-stone-500">
                      <span className="rounded bg-stone-100 px-1 py-0.5">第 {interview.round} 轮</span>
                      <span>{KIND_LABELS[interview.kind] ?? interview.kind}</span>
                      <span>·</span>
                      <span>{RESULT_LABELS[interview.result] ?? interview.result}</span>
                    </div>
                    <div className="mt-2 flex gap-1">
                      {(['pending', 'passed', 'failed'] as const).map((result) => (
                        <button
                          key={result}
                          type="button"
                          onClick={() => update.mutate({ id: interview.id, patch: { result } })}
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            interview.result === result
                              ? 'border-stone-400 bg-stone-100 text-stone-800'
                              : 'border-stone-200 text-stone-500 hover:bg-stone-50'
                          }`}
                        >
                          {RESULT_LABELS[result]}
                        </button>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? '编辑面试' : '安排面试'}
        subtitle="要改期就直接改时间；面完在下面的「复盘」里记下被问了什么、自己觉得答得怎么样"
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
                disabled={(!editing && !form.applicationId) || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {editing ? null : (
            <Field label="关联投递">
              <Select value={form.applicationId} onChange={(event) => setForm({ ...form, applicationId: event.target.value })}>
                <option value="">选择一条投递</option>
                {activeApps.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.companyName} · {item.jobTitle}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Field label="轮次">
              <Input
                value={form.round}
                onChange={(event) => setForm({ ...form, round: event.target.value.replace(/\D/g, '') })}
                inputMode="numeric"
              />
            </Field>
            <Field label="类型">
              <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="形式">
              <Select value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}>
                <option value="video">视频</option>
                <option value="onsite">现场</option>
                <option value="phone">电话</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="时间">
              <Input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })}
              />
            </Field>
            <Field label="时长（分钟）">
              <Input
                value={form.durationMin}
                onChange={(event) => setForm({ ...form, durationMin: event.target.value.replace(/\D/g, '') })}
                inputMode="numeric"
              />
            </Field>
          </div>
          <Field label="地点 / 会议链接">
            <Input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          </Field>
          <Field label="备注">
            <Textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>

          <div className="rounded-lg border border-stone-200 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-[11px] font-medium text-stone-700">复盘</h4>
              <span className="text-[10px] text-stone-400">面完 3 天内记，细节还在</span>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="准备状态">
                  <Select
                    value={form.prepStatus}
                    onChange={(event) => setForm({ ...form, prepStatus: event.target.value })}
                  >
                    {Object.entries(PREP_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="自我评分" hint={form.selfRating ? RATING_HINTS[Number(form.selfRating)] : '没把握就留空'}>
                  <div className="flex gap-1 pt-1">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        data-testid={`interview-rating-${value}`}
                        onClick={() =>
                          setForm({ ...form, selfRating: form.selfRating === String(value) ? '' : String(value) })
                        }
                        className={`h-7 w-7 rounded border text-[11px] transition-colors ${
                          form.selfRating === String(value)
                            ? 'border-stone-900 bg-stone-900 text-white'
                            : 'border-stone-200 bg-white text-stone-500 hover:border-stone-400'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <Field label="反馈 / 复盘" hint="被问了什么、哪句答崩了、下次怎么改。写具体一点，别只写「还行」。">
                <Textarea
                  rows={4}
                  data-testid="interview-feedback"
                  value={form.feedback}
                  onChange={(event) => setForm({ ...form, feedback: event.target.value })}
                />
              </Field>
              {editing ? (
                <Link
                  to={`/bank?interviewId=${editing.id}`}
                  className="inline-block text-[11px] text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
                >
                  去题库录这场被问到的题 →
                </Link>
              ) : null}
            </div>
          </div>

          {editing ? (
            <AgentHandoff
              skill="job-prep"
              title="让 Agent 出题"
              instruction={[
                '用 job-prep skill 帮我准备这场面试。',
                `interviewId: ${editing.id}`,
                `jobId: ${appById.get(editing.applicationId)?.jobId ?? '（未关联）'}`,
                '先 get_interview_context 取 JD + 简历证据 + 缺口，再一题一证据地出题；',
                '每题用 save_question 存下来（注明来自 job-prep），答完用 score_answer 记答案与三维评分。',
                '不要编造我没做过的项目；缺口就问，不要替我补全。',
              ].join('\n')}
              steps={[
                { label: '复制后粘到 Agent，按它给的题逐题回答' },
                { label: '回到这页点「去题库」录答案与自评', hint: '题库会自动筛到这一场' },
              ]}
              note="出题只用你这台电脑上的 JD、简历和投递记录，不会发到别的地方。"
              onDone={() => {
                invalidate()
                toast.push('已刷新', 'success')
              }}
            />
          ) : null}
        </div>
      </Drawer>
    </div>
  )
}
