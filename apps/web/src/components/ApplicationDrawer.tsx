import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { STATUS_LABELS, type Status } from '@land/core/application'
import {
  appendNote,
  changeStatus,
  getApplication,
  getTimeline,
  listResumes,
  patchApplication,
  type ApplicationEventDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Drawer } from './Drawer'
import { StatusBadge } from './StatusBadge'
import { Button, Select, Textarea } from './ui'
import { errorText, useToast } from './Toast'

/** 事件流里只展示这些；未知类型降级成原始 type，不为预览去猜语义 */
const EVENT_LABELS: Record<string, string> = {
  created: '创建',
  status_changed: '状态变更',
  note: '备注',
  resume_linked: '关联简历',
  interview_scheduled: '安排面试',
  offer_received: '收到 offer',
  deleted: '删除',
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function eventNote(event: ApplicationEventDto): string | null {
  const payload = event.payload as { note?: string | null; forced?: boolean } | null
  if (payload?.note) return payload.note
  if (payload?.forced) return '（跳步改的，已记录）'
  return null
}

export function ApplicationDrawer({
  applicationId,
  onClose,
}: {
  applicationId: string | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [pendingStatus, setPendingStatus] = useState('')

  const detail = useQuery({
    queryKey: applicationId ? qk.application(applicationId) : ['application', 'none'],
    queryFn: () => getApplication(applicationId!),
    enabled: Boolean(applicationId),
  })
  const timeline = useQuery({
    queryKey: applicationId ? qk.timeline(applicationId) : ['timeline', 'none'],
    queryFn: () => getTimeline(applicationId!),
    enabled: Boolean(applicationId),
  })
  const resumes = useQuery({ queryKey: qk.resumes, queryFn: () => listResumes() })

  useEffect(() => {
    setNote('')
    setPendingStatus('')
  }, [applicationId])

  const advance = useMutation({
    mutationFn: (to: string) => changeStatus(applicationId!, { to }),
    onSuccess: (result) => {
      toast.push(`已推进到「${STATUS_LABELS[result.to as Status] ?? result.to}」`, 'success')
      setPendingStatus('')
      void client.invalidateQueries({ queryKey: qk.applications })
      void client.invalidateQueries({ queryKey: qk.dashboard })
      if (applicationId) {
        void client.invalidateQueries({ queryKey: qk.application(applicationId) })
        void client.invalidateQueries({ queryKey: qk.timeline(applicationId) })
      }
    },
    onError: (error) => toast.push(`推进失败：${errorText(error)}`, 'error'),
  })

  const addNote = useMutation({
    mutationFn: () => appendNote(applicationId!, note.trim()),
    onSuccess: () => {
      setNote('')
      toast.push('备注已记录', 'success')
      if (applicationId) void client.invalidateQueries({ queryKey: qk.timeline(applicationId) })
    },
    onError: (error) => toast.push(`记录失败：${errorText(error)}`, 'error'),
  })

  const linkResume = useMutation({
    mutationFn: (resumeId: string | null) => patchApplication(applicationId!, { resumeId }),
    onSuccess: () => {
      toast.push('已更新关联简历', 'success')
      if (applicationId) {
        void client.invalidateQueries({ queryKey: qk.application(applicationId) })
        void client.invalidateQueries({ queryKey: qk.timeline(applicationId) })
      }
      void client.invalidateQueries({ queryKey: qk.dashboard })
    },
    onError: (error) => toast.push(`更新失败：${errorText(error)}`, 'error'),
  })

  const app = detail.data
  const nextStatuses = app?.nextStatuses ?? []

  return (
    <Drawer
      open={Boolean(applicationId)}
      onClose={onClose}
      title={app ? `${app.companyName ?? '未知公司'} · ${app.jobTitle ?? '未知岗位'}` : '投递详情'}
      subtitle={app ? `${STATUS_LABELS[app.status as Status] ?? app.status} · 已停留 ${app.daysInStatus ?? 0} 天` : undefined}
    >
      {detail.status === 'error' ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errorText(detail.error)}
        </div>
      ) : null}

      {app ? (
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={app.status} />
              <span className="text-[11px] text-stone-400">
                投递于 {app.appliedAt ? formatTime(app.appliedAt) : '未记录'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={pendingStatus}
                onChange={(event) => setPendingStatus(event.target.value)}
                className="w-40"
                aria-label="选择目标状态"
              >
                <option value="">推进到…</option>
                {nextStatuses.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status as Status] ?? status}
                  </option>
                ))}
              </Select>
              <Button
                variant="primary"
                disabled={!pendingStatus || advance.isPending}
                onClick={() => advance.mutate(pendingStatus)}
              >
                {advance.isPending ? '推进中…' : '确认推进'}
              </Button>
              <span className="text-[11px] text-stone-400">只能选下一步能去的状态</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-stone-500">关联简历</span>
              <Select
                value={app.resumeId ?? ''}
                onChange={(event) => linkResume.mutate(event.target.value || null)}
                className="w-56"
                aria-label="关联简历"
              >
                <option value="">未关联</option>
                {(resumes.data ?? []).map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.title}
                  </option>
                ))}
              </Select>
              {app.resumeId === null ? (
                <span className="text-[11px] text-amber-600">未关联简历不算「有效投递」</span>
              ) : null}
            </div>
          </section>

          <section>
            <div className="mb-2 text-[11px] font-medium text-stone-600">追加备注</div>
            <Textarea
              data-testid="note-input"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：HR 说下周安排二面"
            />
            <div className="mt-2 flex justify-end">
              <Button
                data-testid="note-submit"
                disabled={note.trim().length === 0 || addNote.isPending}
                onClick={() => addNote.mutate()}
              >
                记录
              </Button>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-stone-600">时间线</span>
              <span className="text-[11px] text-stone-400">只往后追加，不会覆盖之前记的</span>
            </div>
            {timeline.status === 'pending' ? (
              <div className="text-xs text-stone-400">读取中…</div>
            ) : (
              <ol className="relative space-y-3 border-l border-stone-200 pl-4">
                {(timeline.data ?? []).map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full bg-stone-300" />
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs text-stone-800">{EVENT_LABELS[event.type] ?? event.type}</span>
                      {event.fromStatus && event.toStatus ? (
                        <span className="text-[11px] text-stone-500">
                          {STATUS_LABELS[event.fromStatus as Status] ?? event.fromStatus} →{' '}
                          {STATUS_LABELS[event.toStatus as Status] ?? event.toStatus}
                        </span>
                      ) : null}
                      <span className="ml-auto font-mono text-[10px] text-stone-400">{formatTime(event.at)}</span>
                    </div>
                    {eventNote(event) ? (
                      <div className="mt-0.5 text-[11px] leading-relaxed text-stone-500">{eventNote(event)}</div>
                    ) : null}
                    <div className="mt-0.5 text-[10px] text-stone-300">
                      来自 {event.source} · {event.actor}
                    </div>
                  </li>
                ))}
                {(timeline.data ?? []).length === 0 ? <li className="text-xs text-stone-400">还没有事件</li> : null}
              </ol>
            )}
          </section>
        </div>
      ) : detail.status === 'pending' ? (
        <div className="text-xs text-stone-400">读取中…</div>
      ) : null}
    </Drawer>
  )
}
