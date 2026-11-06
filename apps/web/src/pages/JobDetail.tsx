import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  fetchJd,
  getJob,
  getTailorPlan,
  importJd,
  listApplications,
  patchJob,
  scoreJob,
  type ApplicationListItemDto,
  type JdCollectionDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { Drawer } from '../components/Drawer'
import { ApplyDialog } from '../components/ApplyDialog'
import { QueueDialog } from '../components/QueueDialog'
import { FitScore, FitBar } from '../components/FitScore'
import { StatusBadge } from '../components/StatusBadge'
import { AgentHandoff } from '../components/AgentHandoff'
import { errorText, useToast } from '../components/Toast'

function money(value: number | null): string {
  return value === null ? '—' : `${Math.round(value / 1000)}K`
}

/** 采集来源落库后刷新页面仍能看到，不依赖本次操作的临时状态 */
const JD_SOURCE_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse 官方接口',
  lever: 'Lever 官方接口',
  feishu: '飞书招聘官方接口',
  beisen: '北森云官方接口',
  http: '网页正文提取',
  browser: 'Agent 浏览器读取',
  paste: '人工粘贴',
}

function jdSourceLabel(value: string | null): string {
  return value ? (JD_SOURCE_LABELS[value] ?? value) : '来源未记录'
}

/** 抓取失败的 details 里带按来源定制的下一步， toast 太短，这里单独展示 */
function jdHint(error: unknown): string {
  const base = errorText(error)
  const details = (error as { details?: { hint?: string } } | null)?.details
  if (details?.hint && !base.includes(details.hint)) return `${base}\n${details.hint}`
  return base
}

export default function JobDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const [editOpen, setEditOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [directApplyOpen, setDirectApplyOpen] = useState(false)
  const [tailorOpen, setTailorOpen] = useState(false)
  const [form, setForm] = useState({ title: '', status: 'open', priority: 3, city: '', salaryMin: '', salaryMax: '', jdText: '', jdUrl: '' })
  const [collection, setCollection] = useState<JdCollectionDto | null>(null)
  const [jdNotice, setJdNotice] = useState<{ kind: 'error'; text: string } | null>(null)

  const job = useQuery({ queryKey: qk.job(id), queryFn: () => getJob(id), enabled: Boolean(id) })
  const applications = useQuery({
    queryKey: [...qk.applications, 'job', id],
    queryFn: () => listApplications({ limit: 50 }),
    enabled: Boolean(id),
  })

  const related: ApplicationListItemDto[] = (applications.data ?? []).filter((item) => item.jobId === id)
  const active = related.find((item) => !['rejected', 'ghosted', 'withdrawn', 'accepted'].includes(item.status))

  const save = useMutation({
    mutationFn: async () => {
      const saved = await patchJob(id, {
        title: form.title,
        status: form.status,
        priority: form.priority,
        city: form.city || null,
        salaryMin: form.salaryMin ? Number(form.salaryMin) * 1000 : null,
        salaryMax: form.salaryMax ? Number(form.salaryMax) * 1000 : null,
        jdText: form.jdText || null,
        jdUrl: form.jdUrl || null,
      })
      // 粘贴正文与自动抓取等价：同样清洗、抽关键词/城市/薪资、落快照。
      // 以前编辑框保存只写文本，用户还得再点一次「抓取 JD」才有关键词。
      const previous = job.data?.jdText ?? ''
      if (form.jdText && form.jdText !== previous) {
        setCollection(await importJd(id, form.jdText, form.jdUrl || undefined))
        setJdNotice(null)
      }
      return saved
    },
    onSuccess: () => {
      toast.push('岗位已更新', 'success')
      void client.invalidateQueries({ queryKey: qk.job(id) })
      void client.invalidateQueries({ queryKey: ['jobs'] })
      setEditOpen(false)
    },
    onError: (error) => toast.push(`保存失败：${errorText(error)}`, 'error'),
  })

  /** 抓取 JD：拿不到正文时按来源给出可操作的降级指引，不做「再试一次」的假动作 */
  const grabJd = useMutation({
    mutationFn: () => fetchJd(id),
    onSuccess: (payload) => {
      setCollection(payload)
      setJdNotice(null)
      toast.push(
        `已抓取 ${payload.job.jdText?.length ?? 0} 字，抽出 ${payload.job.keywords?.length ?? 0} 个关键词（${payload.source.label}）`,
        'success',
      )
      void client.invalidateQueries({ queryKey: qk.job(id) })
      void client.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (error) => {
      setJdNotice({ kind: 'error', text: jdHint(error) })
      toast.push(`抓取失败：${errorText(error)}`, 'error')
    },
  })

  const score = useMutation({
    mutationFn: () => scoreJob(id),
    onSuccess: (payload) => {
      toast.push(`匹配度已重算：${payload.fit.score} 分`, 'success')
      void client.invalidateQueries({ queryKey: qk.job(id) })
      void client.invalidateQueries({ queryKey: ['jobs'] })
    },
    onError: (error) => toast.push(`重算失败：${errorText(error)}`, 'error'),
  })

  const tailor = useQuery({
    queryKey: ['tailor-plan', id],
    queryFn: () => getTailorPlan(id),
    enabled: tailorOpen,
  })

  if (job.status === 'pending') return <div className="text-sm text-stone-400">读取中…</div>
  if (job.status === 'error' || !job.data) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{errorText(job.error)}</div>
  }

  const data = job.data

  const openEdit = () => {
    setForm({
      title: data.title,
      status: data.status,
      priority: data.priority,
      city: data.city ?? '',
      salaryMin: data.salaryMin ? String(data.salaryMin / 1000) : '',
      salaryMax: data.salaryMax ? String(data.salaryMax / 1000) : '',
      jdText: data.jdText ?? '',
      jdUrl: data.jdUrl ?? '',
    })
    setEditOpen(true)
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-[11px] text-stone-400">
        <button type="button" onClick={() => navigate('/jobs')} className="hover:text-stone-700">
          岗位库
        </button>
        <span>/</span>
        <span className="text-stone-600">{data.companyName ?? '未知公司'}</span>
      </div>

      <PageHeader
        title={data.title}
        description={`${data.companyName ?? '未知公司'} · ${data.city ?? '城市未填'} · ${money(data.salaryMin)}-${money(data.salaryMax)} · ${data.channel === 'official' ? '官网' : data.channel === 'referral' ? '内推' : data.channel === 'platform' ? '招聘平台' : '其他'}`}
        actions={
          <>
            {data.jdUrl ? (
              <a
                href={data.jdUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
              >
                打开招聘页
              </a>
            ) : null}
            <Button onClick={() => grabJd.mutate()} disabled={grabJd.isPending} data-testid="job-fetch-jd">
              {grabJd.isPending ? '抓取中…' : '抓取 JD'}
            </Button>
            <Button onClick={() => score.mutate()} disabled={score.isPending} data-testid="job-score">
              {score.isPending ? '计算中…' : '重算匹配度'}
            </Button>
            <Button onClick={() => setTailorOpen(true)} data-testid="job-tailor">
              定制建议
            </Button>
            <Button onClick={openEdit}>编辑</Button>
            {active ? (
              <Button variant="secondary" onClick={() => navigate(`/pipeline?application=${active.id}`)}>
                在看板中打开
              </Button>
            ) : (
              <Button variant="secondary" data-testid="job-detail-queue" onClick={() => setQueueOpen(true)}>
                进入待投
              </Button>
            )}
            {/* 已有投递时也能用：服务端会复用活跃投递，只补一次截图存证 */}
            <Button variant="primary" data-testid="job-detail-direct" onClick={() => setDirectApplyOpen(true)}>
              直接投递
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-medium text-stone-900">JD 正文</h3>
            <span className="text-[11px] text-stone-400">
              {data.jdText ? `${data.jdText.length} 字` : '未录入'} · {jdSourceLabel(data.jdSource)}
            </span>
          </div>
          {data.jdText ? (
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3.5 font-sans text-[12.5px] leading-relaxed text-stone-700">
              {data.jdText}
            </pre>
          ) : (
            <div className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-[11px] leading-relaxed text-stone-400">
              还没有 JD 正文。点「编辑」粘贴全文，或点「抓取 JD」——两种入口都会自动抽关键词、城市与薪资。
            </div>
          )}

          {collection ? (
            <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3 text-[11px] leading-relaxed text-stone-500">
              <div>
                这份 JD 哪来的：{collection.source.label}（{collection.provider === 'paste' ? '你自己粘的' : '从招聘页抓的'}，{collection.source.trusted ? '域名核对过' : '域名没核对'}）
              </div>
              <div>
                从正文里读出来的：{collection.signals.years ? `${collection.signals.years.min}-${collection.signals.years.max} 年经验` : '年限没写'} ·{' '}
                {collection.signals.education ?? '学历没写'} · {collection.signals.cities.join('、') || '城市没写'} ·{' '}
                {collection.signals.salary
                  ? `${money(collection.signals.salary.min)}-${money(collection.signals.salary.max)}`
                  : '薪资没写'}
              </div>
              {collection.warnings.length > 0 ? (
                <ul className="space-y-0.5 text-amber-700">
                  {collection.warnings.map((warning, index) => (
                    <li key={index}>· {warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {jdNotice ? (
            <div className="mt-3 whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">
              {jdNotice.text}
            </div>
          ) : null}
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-stone-900">匹配度</h3>
              <FitScore score={data.fitScore} factors={data.fitReasons} />
            </div>
            <FitBar score={data.fitScore} />
            <div className="mt-3 space-y-1.5">
              {(data.fitReasons ?? []).length === 0 ? (
                <div className="text-[11px] text-stone-400">还没算过。点上面的「重算匹配度」，会拿简历和这段 JD 逐项比一遍。</div>
              ) : (
                (data.fitReasons ?? []).map((reason, index) => (
                  <div key={index} className="text-[11px] leading-relaxed text-stone-600">
                    · {reason}
                  </div>
                ))
              )}
            </div>
            {data.fitScore === null ? null : (
              <div className="mt-3 border-t border-stone-100 pt-2 text-[10px] text-stone-400">
                来源：{data.fitSource === 'rule' ? '按简历自动算' : data.fitSource === 'agent' ? 'Agent 调整过' : '手动填的'}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="mb-2 text-sm font-medium text-stone-900">关键词</h3>
            {(data.keywords ?? []).length === 0 ? (
              <div className="text-[11px] text-stone-400">未抽取</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {(data.keywords ?? []).map((keyword) => (
                  <span key={keyword} className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-600">
                    {keyword}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {related.length > 0 ? (
            <Card className="p-5">
              <h3 className="mb-2 text-sm font-medium text-stone-900">投递记录</h3>
              <div className="space-y-2">
                {related.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(`/pipeline?application=${item.id}`)}
                    className="flex w-full items-center justify-between rounded border border-stone-200 px-2.5 py-1.5 text-left hover:bg-stone-50"
                  >
                    <StatusBadge status={item.status} />
                    <span className="text-[10px] text-stone-400">停留 {item.daysInStatus ?? 0} 天</span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <Drawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑岗位"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditOpen(false)}>取消</Button>
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="岗位名称">
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="状态">
              <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="open">在招</option>
                <option value="paused">暂停</option>
                <option value="closed">已关闭</option>
              </Select>
            </Field>
            <Field label="优先级">
              <Select value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    P{n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="城市">
              <Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="月薪下限 (K)">
              <Input
                value={form.salaryMin}
                onChange={(event) => setForm({ ...form, salaryMin: event.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label="月薪上限 (K)">
              <Input
                value={form.salaryMax}
                onChange={(event) => setForm({ ...form, salaryMax: event.target.value.replace(/\D/g, '') })}
              />
            </Field>
          </div>
          <Field label="JD 链接">
            <Input value={form.jdUrl} onChange={(event) => setForm({ ...form, jdUrl: event.target.value })} />
          </Field>
          <Field label="JD 正文">
            <Textarea rows={12} value={form.jdText} onChange={(event) => setForm({ ...form, jdText: event.target.value })} />
          </Field>
        </div>
      </Drawer>

      {/* 进入待投：与岗位库列表共用同一个 QueueDialog，字段与文案只有一份 */}
      {queueOpen ? <QueueDialog job={data} onClose={() => setQueueOpen(false)} /> : null}
      {/* 直接投递：这一岗的投递助手，默认带入岗位链接与渠道 */}
      {directApplyOpen ? <ApplyDialog job={data} onClose={() => setDirectApplyOpen(false)} /> : null}

      {/* 定制建议：规则给"该突出什么"，改写由 Agent 侧的 resume-tailor Skill 完成 */}
      <Drawer
        open={tailorOpen}
        onClose={() => setTailorOpen(false)}
        title={`定制建议 · ${data.title}`}
        subtitle="这页只给建议、不改简历。要动手改，把下面这段指令复制到你的 Agent 里执行"
        width="w-[600px]"
      >
        {tailor.status === 'pending' ? (
          <div className="text-xs text-stone-400">计算中…</div>
        ) : tailor.status === 'error' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {errorText(tailor.error)}
          </div>
        ) : tailor.data ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-stone-50 p-3">
              <div className="text-[11px] text-stone-500">JD 里的技术词，简历能对上多少</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-semibold tabular-nums text-stone-900">
                  {Math.round(tailor.data.plan.match.ratio * 100)}%
                </span>
                <span className="text-[11px] text-stone-400">
                  {tailor.data.plan.match.matched}/{tailor.data.plan.match.jdTech} 个词在简历里有证据
                </span>
              </div>
              <div className="mt-1 text-[11px] text-stone-500">基础简历：{tailor.data.resumeTitle}</div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-medium text-stone-600">简历开头的自我描述里，建议提这些词（都来自你真实做过的项目）</div>
              <div className="flex flex-wrap gap-1">
                {tailor.data.plan.summaryHints.length === 0 ? (
                  <span className="text-[11px] text-stone-400">没有可突出的词</span>
                ) : (
                  tailor.data.plan.summaryHints.map((hint) => (
                    <span key={hint} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">
                      {hint}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-medium text-stone-600">建议调整顺序</div>
              <div className="text-[11px] leading-relaxed text-stone-600">
                项目：{tailor.data.plan.reorderProjects.join(' → ') || '—'}
                <br />
                技能：{tailor.data.plan.reorderSkills.join(' → ') || '—'}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-medium text-stone-600">简历里还缺什么（{tailor.data.plan.gap.length}）</div>
              <div className="space-y-1.5">
                {tailor.data.plan.gap.length === 0 ? (
                  <div className="text-[11px] text-emerald-700">JD 提到的技术词在简历里都有证据。</div>
                ) : (
                  tailor.data.plan.gap.map((gap) => (
                    <div key={gap.keyword} className="rounded border border-stone-200 p-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-stone-800">{gap.keyword}</span>
                        <span
                          className={`rounded px-1 text-[9px] ${
                            gap.severity === 'blocking'
                              ? 'bg-red-50 text-red-600'
                              : gap.severity === 'important'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-stone-100 text-stone-500'
                          }`}
                        >
                          {gap.severity === 'blocking' ? '硬缺口' : gap.severity === 'important' ? '重要' : '加分'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] leading-relaxed text-stone-500">{gap.suggestion}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-medium text-stone-600">不能改的东西</div>
              <ul className="space-y-0.5 text-[11px] text-stone-500">
                {tailor.data.plan.constraints.map((constraint) => (
                  <li key={constraint}>· {constraint}</li>
                ))}
              </ul>
              <div className="mt-1.5 text-[10px] leading-relaxed text-stone-400">
                这几项是事实：改了就是编，系统也会拦下来。能改的只有措辞、顺序和重点。
              </div>
            </div>

            <AgentHandoff
              skill="resume-tailor"
              instruction={tailor.data.instruction}
              steps={[
                { label: '选一条指令复制，粘到 Agent 里执行', hint: '会生成这一岗的定制版' },
                { label: '改完回到「简历」页，和母版比一下改了哪', hint: '一个字段一个字段列出来' },
                { label: '写回时系统会检查有没有编造经历、公司或时间' },
              ]}
              note="这个应用不去调 AI、也不存 API Key。指令里已经带好岗位和缺口，Agent 不用再问你要背景。"
              onDone={() => {
                void client.invalidateQueries({ queryKey: qk.resumes })
                toast.push('已刷新简历列表', 'success')
              }}
            />
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}
