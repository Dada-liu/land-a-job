import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { createApplication, listResumes, type JobSummaryDto } from '../lib/api'
import { qk } from '../lib/queries'
import { CHANNEL_OPTIONS, normalizeChannel } from '../lib/channels'
import { Button, Field, Select, Textarea } from './ui'
import { Modal } from './Modal'
import { errorText, useToast } from './Toast'

/**
 * 「进入待投」弹窗：岗位库列表行与岗位详情共用这一个组件。
 *
 * 只做一件事——把岗位放进待投队列（status 固定 queued，不写 appliedAt），
 * 所以不给「初始状态」选项；想真的投出去用「直接投递」弹窗。
 */
export function QueueDialog({ job, onClose }: { job: JobSummaryDto; onClose: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState({
    resumeId: '',
    channel: normalizeChannel(job.channel),
    notes: '',
  })

  const resumes = useQuery({ queryKey: qk.resumes, queryFn: () => listResumes() })

  const apply = useMutation({
    mutationFn: () =>
      createApplication({
        jobId: job.id,
        resumeId: form.resumeId || null,
        channel: form.channel,
        status: 'queued',
        notes: form.notes || null,
      }),
    onSuccess: () => {
      toast.push('已进入待投，去看板推进', 'success')
      void client.invalidateQueries({ queryKey: qk.applications })
      void client.invalidateQueries({ queryKey: ['jobs'] })
      void client.invalidateQueries({ queryKey: qk.dashboard })
      onClose()
      navigate('/pipeline')
    },
    onError: (error) => toast.push(`进入待投失败：${errorText(error)}`, 'error'),
  })

  return (
    <Modal
      open
      onClose={onClose}
      testId="queue-dialog"
      title={`进入待投：${job.companyName ?? ''} ${job.title}`}
      subtitle="先放进待投队列，想投的时候从看板点进去。绑一份简历才算「有效投递」，会计入本周目标"
      footer={
        <div className="flex justify-end gap-2">
          <Button data-testid="queue-cancel" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" data-testid="queue-confirm" disabled={apply.isPending} onClick={() => apply.mutate()}>
            {apply.isPending ? '处理中…' : '进入待投'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="使用的简历">
          <Select value={form.resumeId} onChange={(event) => setForm({ ...form, resumeId: event.target.value })}>
            <option value="">暂不关联</option>
            {(resumes.data ?? []).map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.title}
                {resume.kind === 'variant' ? '（定制版）' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="渠道">
          <Select value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
            {CHANNEL_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="备注">
          <Textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
