import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { MIN_SAMPLE_SIZE } from '@land/core/funnel'
import {
  appendNote,
  changeStatus,
  getDashboard,
  getResumePerformance,
  patchApplication,
  type FollowupTaskDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Card, EmptyState, PageHeader, SectionTitle } from '../components/ui'
import { WeeklyTarget } from '../components/WeeklyTarget'
import { errorText, useToast } from '../components/Toast'

const KIND_LABELS: Record<FollowupTaskDto['kind'], string> = {
  no_reply: '催办',
  thanks_letter: '复盘',
  offer_deadline: '答复',
  stale: '清理',
}

/**
 * 待办不是「任务表」里的一行，而是规则现算出来的——所以「完成」不是一个状态位，
 * 而是**做一件让规则不再命中**的事：
 * - 无回音 → 记一条催办事件 + 把下次动作排到 3 天后（规则看到 future nextActionAt 就闭嘴）
 * - 停滞 → 改成「无回音」终态（终态不再产生待办）
 * - 复盘 / 答复 → 必须人真的写点东西或做决定，所以跳到对应页面，不假装一键完成
 */
const AUTO_COMPLETE = new Set<FollowupTaskDto['kind']>(['no_reply', 'stale'])

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

function pct(value: number | null): string {
  if (value === null) return '—'
  return `${Math.round(value * 100)}%`
}

export default function Dashboard() {
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const { data, status, error } = useQuery({ queryKey: qk.dashboard, queryFn: getDashboard })
  const performance = useQuery({ queryKey: qk.resumePerformance, queryFn: getResumePerformance })

  const complete = useMutation({
    mutationFn: async (task: FollowupTaskDto) => {
      if (task.kind === 'no_reply') {
        await appendNote(task.applicationId, '已催办（总览页标记完成）')
        return patchApplication(task.applicationId, { nextActionAt: inDays(3) })
      }
      return changeStatus(task.applicationId, {
        to: 'ghosted',
        note: `停滞 ${task.days} 天，标记为「无回音」以释放注意力`,
      })
    },
    onSuccess: () => {
      toast.push('已处理，这条待办不会再出现', 'success')
      void client.invalidateQueries({ queryKey: qk.dashboard })
      void client.invalidateQueries({ queryKey: qk.applications })
    },
    onError: (err) => toast.push(`处理失败：${errorText(err)}`, 'error'),
  })

  const act = (task: FollowupTaskDto) => {
    if (AUTO_COMPLETE.has(task.kind)) {
      complete.mutate(task)
      return
    }
    if (task.kind === 'thanks_letter') {
      navigate(`/interviews?interview=${task.targetId}`)
      return
    }
    navigate('/offers')
  }

  const actionLabel = (task: FollowupTaskDto): string => {
    if (task.kind === 'no_reply') return '完成'
    if (task.kind === 'stale') return '完成'
    if (task.kind === 'thanks_letter') return '去复盘'
    return '去决策'
  }

  if (status === 'pending') {
    return <div className="p-2 text-sm text-stone-400">读取中…</div>
  }

  if (status === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        指标读取失败：{errorText(error)}
      </div>
    )
  }

  if (!data) return null

  const { northStar, funnel, today, week, upcoming, totals, responseTime } = data
  const firstStage = funnel[0]?.reached ?? 0
  const empty = totals.applications === 0 && totals.jobs === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="总览"
        description="先看这周投了几份、有没有回音，再看今天该跟进谁。数字都是从你的记录当场算的，不是估的。"
        actions={
          <button
            type="button"
            onClick={() => navigate('/pipeline')}
            className="rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800"
          >
            打开投递看板
          </button>
        }
      />

      {empty ? (
        <Card className="p-4">
          <EmptyState
            title="库还是空的"
            hint="先建一个岗位：按 ⌘K 输入「字节 后端工程师 30-50k」就行；建好之后，这里的进度和待办会自动出现。"
            action={
              <button
                type="button"
                onClick={() => navigate('/jobs')}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50"
              >
                去岗位库
              </button>
            }
          />
        </Card>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[1.1fr_2fr]">
        <Card className="p-5">
          <div className="text-xs text-stone-500">{northStar.label}</div>
          <div className="mt-2 flex items-end gap-2">
            <span data-testid="north-star-value" className="text-4xl font-semibold tabular-nums text-stone-900">
              {northStar.value}
            </span>
            <WeeklyTarget target={northStar.target} />
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, (northStar.value / northStar.target) * 100)}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-stone-400">{northStar.hint}</div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center">
            <div>
              <div className="font-mono text-sm text-stone-900">{week.submitted}</div>
              <div className="text-[10px] text-stone-400">本周已投</div>
            </div>
            <div>
              <div className="font-mono text-sm text-stone-900">{week.newJobs}</div>
              <div className="text-[10px] text-stone-400">本周新增岗位</div>
            </div>
            <div>
              <div className="font-mono text-sm text-stone-900">{week.newApplications}</div>
              <div className="text-[10px] text-stone-400">本周新增投递</div>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-stone-100 pt-2.5 text-[11px]">
            <span className="text-stone-500">响应中位数</span>
            <span className="text-stone-900">
              <span data-testid="response-median" className="font-mono">
                {responseTime.medianDays === null ? '无样本' : `${responseTime.medianDays} 天`}
              </span>
              <span className="ml-1.5 text-[10px] text-stone-400">
                样本 {responseTime.sample}
                {responseTime.waiting > 0 ? ` · ${responseTime.waiting} 条还在等` : ''}
              </span>
            </span>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle extra={`样本 ${firstStage} 条已投`}>转化漏斗</SectionTitle>
          <div className="space-y-2">
            {funnel.map((step, index) => (
              <div key={step.stage} className="flex items-center gap-3" data-stage={step.stage}>
                <span className="w-16 shrink-0 text-[11px] text-stone-500">{step.label}</span>
                <span className="h-5 flex-1 overflow-hidden rounded bg-stone-50">
                  <span
                    className={`block h-full rounded ${index === 0 ? 'bg-stone-400' : 'bg-stone-800'}`}
                    style={{ width: `${firstStage === 0 ? 0 : Math.max(2, (step.reached / firstStage) * 100)}%` }}
                  />
                </span>
                <span
                  data-testid={`funnel-${step.stage}`}
                  className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-stone-900"
                >
                  {step.reached}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[10px] text-stone-400" title="相对上一阶段">
                  {pct(step.conversion)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-stone-400">
            算的是「走到过哪一步」：只要进过面试，就算过了一轮筛选，后来被拒也不会从漏斗里消失。
          </div>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <SectionTitle extra={today.length > 0 ? `${today.length} 条待处理` : '今天没有该做的事'}>
            今日待办
          </SectionTitle>
          {today.length === 0 ? (
            <div className="rounded-lg bg-stone-50 px-3.5 py-3 text-[11px] leading-relaxed text-stone-500">
              暂时没有要跟进的投递。这几种情况会出现在这里：投出去 7 天没回音、面完 3 天还没写复盘、Offer 还剩 2 天到期、同一个状态停留超过 30 天。
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {today.map((task) => (
                <li key={task.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                      task.priority === 'high'
                        ? 'bg-red-50 text-red-600'
                        : task.kind === 'stale'
                          ? 'bg-stone-100 text-stone-500'
                          : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {KIND_LABELS[task.kind]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/pipeline?application=${task.applicationId}`)}
                      className="text-left text-xs text-stone-900 hover:underline"
                    >
                      {task.title}
                    </button>
                    <div className="mt-0.5 text-[11px] leading-relaxed text-stone-500">{task.detail}</div>
                  </div>
                  <button
                    type="button"
                    data-testid={`task-${task.kind}`}
                    disabled={complete.isPending}
                    onClick={() => act(task)}
                    className="shrink-0 rounded border border-stone-300 bg-white px-2 py-1 text-[11px] text-stone-600 hover:bg-stone-50 disabled:text-stone-300"
                  >
                    {actionLabel(task)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionTitle>接下来</SectionTitle>
          <div className="space-y-2 text-xs">
            <button
              type="button"
              onClick={() => navigate('/interviews')}
              className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="text-stone-600">待进行的面试</span>
              <span className="font-mono text-stone-900">{upcoming.interviews}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/offers')}
              className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="text-stone-600">待答复的 Offer</span>
              <span className="font-mono text-stone-900">{upcoming.offersPending}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/jobs')}
              className="flex w-full items-center justify-between rounded-lg border border-stone-200 px-3 py-2 text-left hover:bg-stone-50"
            >
              <span className="text-stone-600">在库岗位</span>
              <span className="font-mono text-stone-900">{totals.jobs}</span>
            </button>
          </div>
          <div className="mt-4 border-t border-stone-100 pt-3 text-[11px] leading-relaxed text-stone-400">
            按 ⌘K 可以用一句话记下岗位；你在别处改动数据，这里开着的页面会自动更新。
          </div>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <Card className="p-5">
          <SectionTitle extra={`每版至少 ${MIN_SAMPLE_SIZE} 份样本才给转化率`}>简历版本胜率</SectionTitle>
          {performance.data && performance.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[11px]">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-[10px] text-stone-500">
                    <th className="py-1.5 pr-2 font-normal">简历</th>
                    <th className="py-1.5 pr-2 text-right font-normal">投递</th>
                    <th className="py-1.5 pr-2 text-right font-normal">进面</th>
                    <th className="py-1.5 pr-2 text-right font-normal">进面率</th>
                    <th className="py-1.5 text-right font-normal">Offer</th>
                  </tr>
                </thead>
                <tbody data-testid="resume-performance">
                  {performance.data.map((row) => (
                    <tr key={row.resumeId} className="border-b border-stone-100 last:border-0">
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/resumes/${row.resumeId}`)}
                          className="max-w-[220px] truncate text-left text-stone-800 hover:underline"
                        >
                          {row.resumeTitle}
                        </button>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono text-stone-600">{row.applied}</td>
                      <td className="py-1.5 pr-2 text-right font-mono text-stone-600">{row.interviewed}</td>
                      <td className="py-1.5 pr-2 text-right font-mono">
                        {row.enough ? (
                          <span className="text-stone-900">{pct(row.interviewRate)}</span>
                        ) : (
                          <span className="text-[10px] text-stone-400">样本不足</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono text-stone-600">{row.offered}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg bg-stone-50 px-3.5 py-3 text-[11px] leading-relaxed text-stone-500">
              还没有绑定简历的投递。投递时选一版简历，这里才能算「哪版更容易过筛」。
            </div>
          )}
          <div className="mt-3 text-[11px] leading-relaxed text-stone-400">
            「进面」算的是「走到过面试」：过了三面最后挂了也算进过——不然哪版简历好用会被低估。
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle>回音一般要等多久</SectionTitle>
          <div className="space-y-1.5 text-[11px] text-stone-600">
            <div className="flex items-baseline justify-between">
              <span className="text-stone-500">中位数</span>
              <span className="font-mono text-stone-900">
                {responseTime.medianDays === null ? '—' : `${responseTime.medianDays} 天`}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-stone-500">90 分位</span>
              <span className="font-mono text-stone-900">
                {responseTime.p90Days === null ? '—' : `${responseTime.p90Days} 天`}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-stone-500">还在等</span>
              <span className="font-mono text-stone-900">{responseTime.waiting} 条</span>
            </div>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[10px] leading-relaxed text-stone-400">
            {responseTime.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  )
}
