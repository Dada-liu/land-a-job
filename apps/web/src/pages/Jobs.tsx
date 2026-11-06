import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createJob, listCompanies, listJobs, type JobSummaryDto } from '../lib/api'
import { qk } from '../lib/queries'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { Drawer } from '../components/Drawer'
import { ApplyDialog } from '../components/ApplyDialog'
import { QueueDialog } from '../components/QueueDialog'
import { FitBar, FitScore } from '../components/FitScore'
import { errorText, useToast } from '../components/Toast'

function salary(value: { salaryMin: number | null; salaryMax: number | null }): string {
  if (!value.salaryMin && !value.salaryMax) return '—'
  const fmt = (n: number | null) => (n === null ? '?' : String(Math.round(n / 1000)))
  return `${fmt(value.salaryMin)}-${fmt(value.salaryMax)}K`
}

/** 列表里一眼看出这份 JD 是怎么进来的；NULL 是重构前的历史数据 */
const JD_SOURCE_SHORT: Record<string, string> = {
  feishu: '飞书招聘',
  beisen: '北森云',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  http: '网页提取',
  browser: '浏览器采集',
  paste: '人工粘贴',
}

function jdSourceBadge(value: string | null): string {
  return value ? (JD_SOURCE_SHORT[value] ?? value) : 'JD 未标注来源'
}

export default function Jobs() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('companyId') ?? ''
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'fit' | 'priority' | 'updated'>('fit')
  const [minFit, setMinFit] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [queueTarget, setQueueTarget] = useState<JobSummaryDto | null>(null)
  const [directApplyTarget, setDirectApplyTarget] = useState<JobSummaryDto | null>(null)
  const [form, setForm] = useState({ companyId: '', title: '', jdUrl: '', city: '', salaryMin: '', salaryMax: '', level: '', jdText: '' })

  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()

  const companies = useQuery({ queryKey: [...qk.companies, 'all'], queryFn: () => listCompanies({ limit: 200 }) })
  const jobs = useQuery({
    queryKey: qk.jobs({ companyId, q: search, status, sort, minFit }),
    queryFn: () =>
      listJobs({
        companyId: companyId || undefined,
        q: search || undefined,
        status: status || undefined,
        sort,
        minFit: minFit > 0 ? minFit : undefined,
        withApplication: true,
      }),
  })

  const companyName = useMemo(
    () => companies.data?.find((company) => company.id === companyId)?.name,
    [companies.data, companyId],
  )

  const saveJob = useMutation({
    mutationFn: () =>
      createJob({
        companyId: form.companyId,
        title: form.title,
        jdUrl: form.jdUrl || null,
        city: form.city || null,
        level: form.level || null,
        salaryMin: form.salaryMin ? Number(form.salaryMin) * 1000 : null,
        salaryMax: form.salaryMax ? Number(form.salaryMax) * 1000 : null,
        jdText: form.jdText || null,
      }),
    onSuccess: (job) => {
      toast.push('岗位已创建', 'success')
      void client.invalidateQueries({ queryKey: ['jobs'] })
      void client.invalidateQueries({ queryKey: qk.dashboard })
      setCreateOpen(false)
      setForm({ companyId: '', title: '', jdUrl: '', city: '', salaryMin: '', salaryMax: '', level: '', jdText: '' })
      navigate(`/jobs/${job.id}`)
    },
    onError: (error) => toast.push(`创建失败：${errorText(error)}`, 'error'),
  })

  const rows = jobs.data ?? []

  return (
    <div>
      <PageHeader
        title="岗位库"
        description="先投哪家？看「匹配度」：分数高的排前面，点分数能看到它为什么高、为什么低。分数低不代表没戏，但你要能说出差在哪。"
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setForm((prev) => ({ ...prev, companyId: companyId || companies.data?.[0]?.id || '' }))
              setCreateOpen(true)
            }}
          >
            新建岗位
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <Select
          value={companyId}
          onChange={(event) => {
            const next = new URLSearchParams(params)
            if (event.target.value) next.set('companyId', event.target.value)
            else next.delete('companyId')
            setParams(next, { replace: true })
          }}
          className="w-40"
          aria-label="按公司筛选"
        >
          <option value="">全部公司</option>
          {(companies.data ?? []).map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} className="w-28" aria-label="按状态筛选">
          <option value="">全部状态</option>
          <option value="open">在招</option>
          <option value="paused">暂停</option>
          <option value="closed">已关闭</option>
        </Select>
        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as 'fit' | 'priority' | 'updated')}
          className="w-32"
          aria-label="排序"
        >
          <option value="fit">按匹配度</option>
          <option value="priority">按优先级</option>
          <option value="updated">按最近更新</option>
        </Select>
        <Select value={minFit} onChange={(event) => setMinFit(Number(event.target.value))} className="w-32" aria-label="最低分">
          <option value={0}>不限分数</option>
          <option value={60}>匹配度 ≥ 60</option>
          <option value={75}>匹配度 ≥ 75</option>
        </Select>
        {companyName ? (
          <span className="rounded bg-stone-100 px-2 py-1 text-stone-600">公司：{companyName}</span>
        ) : null}
        <span className="ml-auto text-stone-400">共 {rows.length} 个岗位</span>
      </div>

      {/* 搜索框放在筛选行下面：筛选决定「看哪一批」，搜索是在这一批里再找具体那条 */}
      <div className="mb-3">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索岗位、公司、关键词或 JD 正文"
          aria-label="搜索岗位"
          className="w-full"
        />
      </div>

      {jobs.status === 'error' ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{errorText(jobs.error)}</div>
      ) : null}

      {jobs.status === 'pending' ? (
        <Card className="p-4 text-xs text-stone-500">加载岗位…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            title="没有符合条件的岗位"
            hint="没有想投的？按 ⌘K 输入「公司 岗位 30-50k」一句话就能建一个。已有岗位进详情页贴上 JD，就能算出匹配度。"
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          {/* 窄屏横向滚动：七列挤进 390px 会变成「一字一列」，比滚一下难看得多 */}
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-stone-200 bg-stone-50/60 text-[11px] text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">公司 · 岗位</th>
                <th className="px-3 py-2 font-medium">匹配度</th>
                <th className="px-3 py-2 font-medium">城市</th>
                <th className="px-3 py-2 font-medium">薪资</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium text-center">投递</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((job) => (
                <tr key={job.id} className="hover:bg-stone-50/60">
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => navigate(`/jobs/${job.id}`)} className="text-left">
                      <div data-testid="job-row-title" className="font-medium text-stone-900 hover:underline">{job.title}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
                        <span>{job.companyName ?? '未知公司'}</span>
                        <span className="rounded bg-stone-100 px-1 text-[10px] text-stone-500" data-testid="job-jd-source">
                          {jdSourceBadge(job.jdSource)}
                        </span>
                      </div>
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <FitScore score={job.fitScore} factors={job.fitReasons} compact />
                      <FitBar score={job.fitScore} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{job.city ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-stone-600">{salary(job)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] ${
                        job.status === 'open'
                          ? 'bg-emerald-50 text-emerald-700'
                          : job.status === 'paused'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-stone-100 text-stone-500'
                      }`}
                    >
                      {job.status === 'open' ? '在招' : job.status === 'paused' ? '暂停' : '已关闭'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {job.applicationId ? (
                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => navigate(`/pipeline?application=${job.applicationId}`)}
                          className="text-[11px] text-emerald-700 underline-offset-2 hover:underline"
                        >
                          在看板
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-1.5">
                        <Button variant="secondary" data-testid={`queue-apply-${job.id}`} onClick={() => setQueueTarget(job)}>
                          进入待投
                        </Button>
                        <Button variant="primary" data-testid={`direct-apply-${job.id}`} onClick={() => setDirectApplyTarget(job)}>
                          直接投递
                        </Button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Button variant="ghost" onClick={() => navigate(`/jobs/${job.id}`)}>
                      详情
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* 新建岗位 */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="新建岗位"
        subtitle="JD 正文可以先空着；贴上正文之后，才算得出匹配度"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)}>取消</Button>
            <Button
              variant="primary"
              disabled={!form.companyId || form.title.trim().length === 0 || saveJob.isPending}
              onClick={() => saveJob.mutate()}
            >
              {saveJob.isPending ? '创建中…' : '创建'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="公司">
            <Select value={form.companyId} onChange={(event) => setForm({ ...form, companyId: event.target.value })}>
              <option value="">选择公司</option>
              {(companies.data ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="岗位名称">
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="城市">
              <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
            <Field label="月薪下限 (K)">
              <Input
                value={form.salaryMin}
                onChange={(event) => setForm({ ...form, salaryMin: event.target.value.replace(/\D/g, '') })}
                inputMode="numeric"
              />
            </Field>
            <Field label="月薪上限 (K)">
              <Input
                value={form.salaryMax}
                onChange={(event) => setForm({ ...form, salaryMax: event.target.value.replace(/\D/g, '') })}
                inputMode="numeric"
              />
            </Field>
          </div>
          <Field label="JD 链接">
            <Input value={form.jdUrl} onChange={(event) => setForm({ ...form, jdUrl: event.target.value })} placeholder="https://" />
          </Field>
          <Field label="JD 正文" hint="把招聘要求整段粘进来；关键词和匹配度都是从这段文字里算的">
            <Textarea rows={8} value={form.jdText} onChange={(event) => setForm({ ...form, jdText: event.target.value })} />
          </Field>
        </div>
      </Drawer>

      {/* 进入待投与详情页共用 QueueDialog：字段、文案、queued 落点只有一份 */}
      {queueTarget ? <QueueDialog job={queueTarget} onClose={() => setQueueTarget(null)} /> : null}

      {/* 直接投递：岗位库这一行的投递助手，岗位/链接/渠道默认带入 */}
      {directApplyTarget ? (
        <ApplyDialog job={directApplyTarget} onClose={() => setDirectApplyTarget(null)} />
      ) : null}
    </div>
  )
}
