import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { STATUS_LABELS, nextStatuses, type Status } from '@land/core/application'
import {
  changeStatus,
  listApplications,
  listJobs,
  type ApplicationListItemDto,
  type JobSummaryDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Button, Card, EmptyState, PageHeader } from '../components/ui'
import { ApplicationDrawer } from '../components/ApplicationDrawer'
import { errorText, useToast } from '../components/Toast'
import { useT } from '../i18n'

/**
 * 看板列：只放「还在推进」的状态；终态不参与拖拽，避免误操作把记录挪进黑洞。
 *
 * 「线索」列已下线：服务端不会产出 lead 投递（新建一律 queued），这一列长期是空的，
 * 白占一屏宽度。历史 lead 记录也不再出现在看板上（见下方的 closed 过滤）。
 */
const COLUMNS: { status: string; label: string; hint?: string }[] = [
  { status: 'queued', label: '待投' },
  { status: 'applied', label: '已投递' },
  { status: 'screening', label: '筛选中' },
  { status: 'assessment', label: '笔试/作业' },
  { status: 'interview', label: '面试中' },
  { status: 'offer', label: 'Offer' },
]

function daysLabel(days: number | undefined): string {
  if (days === undefined) return ''
  return days === 0 ? '今天' : '{days} 天'
}

/**
 * 卡片里的链接要自己截住指针/点击/按键事件：
 * 卡片本身是拖拽源，还兼着「点开抽屉」。不拦的话按下去会起拖拽、点一下又顺手把抽屉打开，
 * 用户看到的会是「新开了岗位页，同时底下还压着一层抽屉」。
 */
const swallow = (event: { stopPropagation: () => void }) => event.stopPropagation()

function AppCard({
  app,
  fit,
  onOpen,
}: {
  app: ApplicationListItemDto
  fit: number | null
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: app.id })
  const t = useT()
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 }
    : undefined

  // 岗位详情、简历编辑都按新开页跳：看板上正在拖/正在看的那一屏不能丢
  const jobHref = `/jobs/${app.jobId}`
  const resumeHref = app.resumeId ? `/resumes/${app.resumeId}` : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-app-id={app.id}
      data-app-status={app.status}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(event) => {
        // 焦点在内嵌链接上时回车归链接，别再顺带把抽屉打开
        if (event.key === 'Enter' && event.target === event.currentTarget) onOpen()
      }}
      role="button"
      tabIndex={0}
      className={[
        'group cursor-grab touch-none rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-left shadow-sm transition-shadow active:cursor-grabbing hover:shadow',
        isDragging ? 'opacity-40' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span className="truncate text-[11px] text-stone-500">{app.companyName ?? t('未知公司')}</span>
        {resumeHref ? (
          <a
            href={resumeHref}
            target="_blank"
            rel="noreferrer"
            title={t('打开简历')}
            aria-label={t('打开简历')}
            onPointerDown={swallow}
            onClick={swallow}
            onKeyDown={swallow}
            className="shrink-0 rounded bg-emerald-50 px-1 text-[9px] text-emerald-700 underline-offset-2 transition-colors hover:bg-emerald-100 hover:text-emerald-800 hover:underline"
          >
            {t('有简历')}
          </a>
        ) : (
          <span className="shrink-0 rounded bg-amber-50 px-1 text-[9px] text-amber-700" title={t('未关联简历，不算有效投递')}>
            {t('缺简历')}
          </span>
        )}
      </div>
      <div className="group/title mt-0.5 flex items-start gap-1">
        <div className="line-clamp-2 min-w-0 flex-1 text-xs font-medium leading-snug text-stone-900">
          {app.jobTitle ?? t('未知岗位')}
        </div>
        {/* 悬停岗位名才显形：常态留出同样的位置，出现时不把标题挤到换行 */}
        <a
          href={jobHref}
          target="_blank"
          rel="noreferrer"
          title={t('打开岗位')}
          aria-label={t('打开岗位')}
          onPointerDown={swallow}
          onClick={swallow}
          onKeyDown={swallow}
          className="mt-px shrink-0 rounded p-0.5 text-stone-400 opacity-0 transition-opacity hover:bg-stone-100 hover:text-stone-900 focus-visible:opacity-100 group-hover/title:opacity-100"
        >
          <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-stone-400">
        <span className="font-mono" title={t('岗位匹配度')}>
          {fit === null ? t('匹配度 —') : t('匹配度 {score}', { score: fit })}
        </span>
        <span>{t(daysLabel(app.daysInStatus), { days: app.daysInStatus ?? 0 })}</span>
      </div>
    </div>
  )
}

function Column({
  status,
  label,
  items,
  fits,
  onOpen,
}: {
  status: string
  label: string
  items: ApplicationListItemDto[]
  fits: Map<string, number | null>
  onOpen: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const t = useT()
  return (
    <div className="flex w-[220px] shrink-0 flex-col">
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <span className="text-xs font-medium text-stone-700">{t(label)}</span>
        <span className="font-mono text-[10px] text-stone-400">{items.length}</span>
      </div>
      <div
        ref={setNodeRef}
        data-column={status}
        className={`min-h-[120px] flex-1 space-y-1.5 rounded-lg border p-1.5 transition-colors ${
          isOver ? 'border-stone-400 bg-stone-100' : 'border-stone-200 bg-stone-50/60'
        }`}
      >
        {items.map((app) => (
          <AppCard key={app.id} app={app} fit={fits.get(app.jobId) ?? null} onOpen={() => onOpen(app.id)} />
        ))}
        {items.length === 0 ? (
          <div className="px-1 py-6 text-center text-[10px] text-stone-300">{t('拖到这里')}</div>
        ) : null}
      </div>
    </div>
  )
}

export default function Pipeline() {
  const [params, setParams] = useSearchParams()
  const [showClosed, setShowClosed] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const client = useQueryClient()
  const toast = useToast()
  // 传感器必须无条件调用：放到 JSX 的某个分支里就违反了 hooks 规则
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const appKey = useMemo(() => ['applications', 'pipeline', showClosed] as const, [showClosed])

  // limit 上限是 200（服务端 zListQuery 卡死），看板一次拿满即可；
  // 超过 200 条活跃投递时说明该清理了，不是该分页了
  const applications = useQuery({ queryKey: appKey, queryFn: () => listApplications({ limit: 200 }) })
  const jobs = useQuery({
    queryKey: ['jobs', 'pipeline-fits'],
    queryFn: () => listJobs({ limit: 200, withApplication: true }),
  })

  const fits = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const job of (jobs.data ?? []) as JobSummaryDto[]) map.set(job.id, job.fitScore)
    return map
  }, [jobs.data])

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => changeStatus(id, { to }),
    onMutate: async ({ id, to }) => {
      // 乐观更新：拖拽必须"立刻到位"，否则手感像卡住
      await client.cancelQueries({ queryKey: appKey })
      const previous = client.getQueryData<ApplicationListItemDto[]>(appKey)
      client.setQueryData<ApplicationListItemDto[]>(appKey, (old = []) =>
        old.map((item) =>
          item.id === id
            ? { ...item, status: to, statusAt: new Date().toISOString(), daysInStatus: 0, nextStatuses: [...nextStatuses(to as Status)] }
            : item,
        ),
      )
      return { previous }
    },
    onError: (error, _variables, context) => {
      // 失败必须回滚，否则页面显示的状态与库里不一致，用户会以为已经推进了
      if (context?.previous) client.setQueryData(appKey, context.previous)
      toast.push(`推进失败：${errorText(error)}`, 'error')
    },
    onSuccess: (result) => {
      toast.push(`已推进到「${STATUS_LABELS[result.to as Status] ?? result.to}」`, 'success')
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: appKey })
      void client.invalidateQueries({ queryKey: qk.dashboard })
      void client.invalidateQueries({ queryKey: ['applications'] })
    },
  })

  const rows = applications.data ?? []
  const activeApp = rows.find((item) => item.id === activeId) ?? null

  const grouped = useMemo(() => {
    const map = new Map<string, ApplicationListItemDto[]>()
    for (const column of COLUMNS) map.set(column.status, [])
    for (const item of rows) {
      const bucket = map.get(item.status)
      if (bucket) bucket.push(item)
    }
    return map
  }, [rows])

  // 「已结束」只收终态；lead 属于列已下线的那一档，不能混进来假装是已结束
  const closed = rows.filter(
    (item) => item.status !== 'lead' && !COLUMNS.some((column) => column.status === item.status),
  )

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const id = String(event.active.id)
    const target = event.over ? String(event.over.id) : null
    if (!target) return

    const app = rows.find((item) => item.id === id)
    if (!app || app.status === target) return

    const allowed = app.nextStatuses ?? [...nextStatuses(app.status as Status)]
    if (!allowed.includes(target)) {
      toast.push(
        `不能从「${STATUS_LABELS[app.status as Status] ?? app.status}」直接到「${STATUS_LABELS[target as Status] ?? target}」；允许：${
          allowed.map((status) => STATUS_LABELS[status as Status] ?? status).join('、') || '无（终态）'
        }`,
        'error',
      )
      return
    }
    move.mutate({ id, to: target })
  }

  const openId = params.get('application')
  const openDrawer = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('application', id)
    setParams(next, { replace: true })
  }
  const closeDrawer = () => {
    const next = new URLSearchParams(params)
    next.delete('application')
    setParams(next, { replace: true })
  }

  return (
    <div className="flex h-full flex-col px-4 py-4 sm:px-6 sm:py-6">
      <PageHeader
        title="投递看板"
        description="把卡片拖到右边那一列，就算往下推进了一步。跳步（比如从待投直接到 Offer）会被拦下，并告诉你这一步能去哪。"
        descriptionClassName="max-w-none"
        actions={
          <>
            <Button onClick={() => setShowClosed((value) => !value)}>
              {showClosed ? '隐藏已结束' : `显示已结束${closed.length > 0 ? ` (${closed.length})` : ''}`}
            </Button>
          </>
        }
      />

      {applications.status === 'error' ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errorText(applications.error)}
        </div>
      ) : null}

      {applications.status === 'pending' ? (
        <Card className="p-4 text-xs text-stone-500">加载看板…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            title="看板还是空的"
            hint="先去岗位库挑一个岗位：点「进入待投」排队，或点「直接投递」当场投。投一次这里就多一张卡，之后每一步变化都会记在这张卡的时间线里。"
          />
        </Card>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="min-h-0 flex-1 overflow-x-auto pb-2">
            <div className="flex min-h-full gap-3">
              {COLUMNS.map((column) => (
                <Column
                  key={column.status}
                  status={column.status}
                  label={column.label}
                  items={grouped.get(column.status) ?? []}
                  fits={fits}
                  onOpen={openDrawer}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeApp ? (
              <div className="w-[200px] rounded-lg border border-stone-300 bg-white px-2.5 py-2 shadow-lg">
                <div className="text-[11px] text-stone-500">{activeApp.companyName}</div>
                <div className="mt-0.5 text-xs font-medium text-stone-900">{activeApp.jobTitle}</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* 点开「显示已结束」但一条都没有时也要出这块：否则按钮像没生效，
          用户会以为点击丢了，而不是「确实还没有已结束的投递」 */}
      {showClosed ? (
        <div className="mt-3 rounded-lg border border-stone-200 bg-white p-3">
          <div className="mb-2 text-[11px] font-medium text-stone-600">已结束（不参与拖拽）</div>
          {closed.length === 0 ? (
            <div
              data-testid="closed-empty"
              className="rounded border border-dashed border-stone-200 px-3 py-4 text-center text-[11px] text-stone-400"
            >
              还没有已结束的投递。撤回、被拒、已入职、已失联的投递会收在这里，不参与拖拽。
            </div>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {closed.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openDrawer(item.id)}
                  className="flex items-center justify-between rounded border border-stone-200 px-2 py-1.5 text-left hover:bg-stone-50"
                >
                  <span className="truncate text-[11px] text-stone-700">
                    {item.companyName} · {item.jobTitle}
                  </span>
                  <span className="ml-2 shrink-0 text-[10px] text-stone-400">
                    {STATUS_LABELS[item.status as Status] ?? item.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <ApplicationDrawer
        applicationId={openId}
        onClose={closeDrawer}
      />
    </div>
  )
}
