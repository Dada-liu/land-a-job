import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  closeApplySession,
  fillApplySession,
  getCurrentApplySession,
  getResume,
  inspectApplySession,
  listJobs,
  listResumes,
  openApplySession,
  submitApplySession,
  type ApplyFieldDto,
  type ApplySessionDto,
  type JobSummaryDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { CHANNEL_OPTIONS, normalizeChannel } from '../lib/channels'
import { Button, Card, Field, Input, SectionTitle, Select } from './ui'
import { Modal } from './Modal'
import { errorText, useToast } from './Toast'

/**
 * 直接投递弹窗：把原「投递助手」页的整套流程搬到岗位库的某一行上。
 *
 * 逻辑与原来的独立页面一致（单例会话 → 扫描字段 → 逐项填充 → 人工确认 → 截图存证 → 自动建投递），
 * 只多两件事：岗位/起始地址/渠道默认带入这一行，以及「使用的简历」可显式选。
 * 弹窗内不写 URL（岗位库自己的 query 参数不能被助手改掉），岗位用局部 state。
 */

interface ResumeShape {
  personalInfo?: { name?: string; jobTitle?: string; workYears?: string; city?: string }
  selfIntroduction?: string
  contacts?: { platform?: string; value?: string; url?: string }[]
}

function pickContact(resume: ResumeShape | undefined, pattern: RegExp): string {
  return (resume?.contacts ?? []).find((contact) => pattern.test(contact.platform ?? ''))?.value ?? ''
}

function guessValue(field: ApplyFieldDto, resume: ResumeShape | undefined, jobTitle: string, jobId: string): string {
  const haystack = `${field.label} ${field.placeholder ?? ''} ${field.name ?? ''} ${field.id ?? ''} ${field.key}`.toLowerCase()

  if (field.type === 'checkbox' || field.type === 'radio') {
    return /同意|agree|协议|隐私|条款/.test(haystack) ? 'true' : ''
  }
  if (/姓名|name/.test(haystack)) return resume?.personalInfo?.name ?? ''
  if (/邮箱|email|e-mail|mail/.test(haystack)) {
    return pickContact(resume, /邮箱|email|mail/) || (resume?.contacts ?? []).find((c) => c.value?.includes('@'))?.value || ''
  }
  if (/手机|电话|phone|mobile|tel/.test(haystack)) return pickContact(resume, /电话|手机|phone|tel/)
  if (/城市|city|地点|base/.test(haystack)) return resume?.personalInfo?.city ?? ''
  if (/岗位|职位|position|title|应聘/.test(haystack)) return jobTitle
  if (/介绍|summary|about|introduction|评价/.test(haystack)) return resume?.selfIntroduction ?? ''
  if (/github|主页|portfolio|网站|blog|链接/.test(haystack)) {
    return (resume?.contacts ?? []).find((contact) => /github|博客|blog|主页|网站/.test(contact.platform ?? ''))?.url ?? ''
  }
  if (/岗位\s*id|job\s*id/i.test(haystack)) return jobId
  return ''
}

const STATUS_LABELS: Record<ApplySessionDto['status'], string> = {
  open: '等待填充',
  filled: '已填入，待提交',
  blocked: '被拦截，需人工处理',
  submitted: '已提交',
  closed: '已结束',
}

export function ApplyDialog({ job, onClose }: { job: JobSummaryDto; onClose: () => void }) {
  const client = useQueryClient()
  const toast = useToast()

  const [jobId, setJobId] = useState(job.id)
  const [url, setUrl] = useState(job.jdUrl ?? '')
  const [resumeId, setResumeId] = useState('')
  const [channel, setChannel] = useState(() => normalizeChannel(job.channel))
  const [session, setSession] = useState<ApplySessionDto | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState<{ screenshotPath: string | null; finalUrl: string; emptyRequired: string[] } | null>(null)

  const jobs = useQuery({ queryKey: ['jobs', 'apply-picker'], queryFn: () => listJobs({ limit: 100, status: 'open' }) })
  const resumes = useQuery({ queryKey: qk.resumes, queryFn: () => listResumes() })

  // 当前行的岗位未必在「在招」列表里（例如已暂停），补进去保证下拉一定能选中它
  const jobOptions = useMemo(() => {
    const list = jobs.data ?? []
    return list.some((item) => item.id === job.id) ? list : [job, ...list]
  }, [jobs.data, job])
  const activeJob = jobOptions.find((item) => item.id === jobId) ?? job

  const resume = useQuery({
    queryKey: ['resume', resumeId, 'apply'],
    queryFn: () => getResume(resumeId),
    enabled: Boolean(resumeId),
  })

  // 默认带上默认简历；用户仍然可以改选（或不指定）
  useEffect(() => {
    if (resumeId || !resumes.data) return
    const fallback = resumes.data.find((item) => item.isDefault)?.id ?? resumes.data[0]?.id ?? ''
    if (fallback) setResumeId(fallback)
  }, [resumes.data, resumeId])

  // 恢复上次未结束的会话：关掉弹窗再打开不该把正在填的表单弄丢
  const current = useQuery({ queryKey: ['apply', 'current'], queryFn: getCurrentApplySession })
  useEffect(() => {
    const resumed = current.data?.session
    if (session || !resumed) return
    setSession(resumed)
    setJobId(resumed.jobId)
    setUrl(resumed.url)
    if (resumed.resumeId) setResumeId(resumed.resumeId)
  }, [current.data, session])

  // 拿到字段后按简历预填一遍：用户仍然可以逐项改
  useEffect(() => {
    if (!session) return
    const shape = (resume.data?.data ?? {}) as ResumeShape
    const next: Record<string, string> = {}
    for (const field of session.fields) {
      const guess = guessValue(field, shape, activeJob.title, session.jobId)
      if (guess) next[field.key] = guess
    }
    setValues((prev) => ({ ...next, ...prev }))
  }, [session, resume.data, activeJob.title])

  const open = useMutation({
    mutationFn: () =>
      openApplySession({
        jobId,
        resumeId: resumeId || null,
        url: url || undefined,
      }),
    onSuccess: (created) => {
      setSession(created)
      setValues({})
      setResult(null)
      toast.push(`已打开 ${created.fields.length} 个字段的页面`, 'success')
      void client.invalidateQueries({ queryKey: ['apply', 'current'] })
    },
    onError: (error) => toast.push(`打开失败：${errorText(error)}`, 'error'),
  })

  const reInspect = useMutation({
    mutationFn: () => inspectApplySession(session!.id),
    onSuccess: (next) => {
      setSession(next)
      toast.push(`重新扫描到 ${next.fields.length} 个字段`, 'success')
    },
    onError: (error) => toast.push(`扫描失败：${errorText(error)}`, 'error'),
  })

  const fill = useMutation({
    mutationFn: () => {
      // 只提交有值的字段：没值不该被当成「填失败」
      const payload: Record<string, string> = {}
      for (const field of session!.fields) {
        const value = values[field.key]
        if (value !== undefined && value !== '') payload[field.key] = value
      }
      return fillApplySession(session!.id, payload)
    },
    onSuccess: (next) => {
      setSession(next)
      const failed = (next.fillResults ?? []).filter((item) => !item.ok)
      if (failed.length === 0) toast.push('全部字段已填入', 'success')
      else toast.push(`${failed.length} 个字段没填上，见下方逐项原因`, 'error')
    },
    onError: (error) => toast.push(`填充失败：${errorText(error)}`, 'error'),
  })

  const submit = useMutation({
    mutationFn: () => submitApplySession(session!.id, confirm, channel),
    onSuccess: (payload) => {
      setResult({ screenshotPath: payload.screenshotPath, finalUrl: payload.finalUrl, emptyRequired: payload.emptyRequired })
      setSession(null)
      setConfirm(false)
      toast.push('已提交并写入投递记录', 'success')
      void client.invalidateQueries({ queryKey: qk.applications })
      void client.invalidateQueries({ queryKey: qk.dashboard })
      void client.invalidateQueries({ queryKey: ['jobs'] })
      void client.invalidateQueries({ queryKey: ['apply', 'current'] })
    },
    onError: (error) => toast.push(`提交失败：${errorText(error)}`, 'error'),
  })

  const close = useMutation({
    mutationFn: () => closeApplySession(session!.id),
    onSuccess: () => {
      setSession(null)
      toast.push('会话已结束', 'info')
      void client.invalidateQueries({ queryKey: ['apply', 'current'] })
    },
    onError: (error) => toast.push(`关闭失败：${errorText(error)}`, 'error'),
  })

  const shape = (resume.data?.data ?? {}) as ResumeShape
  const materials = useMemo(
    () =>
      [
        { label: '姓名', value: shape.personalInfo?.name ?? '' },
        { label: '邮箱', value: pickContact(shape, /邮箱|email|mail/) },
        { label: '手机', value: pickContact(shape, /电话|手机|phone|tel/) },
        { label: '期望城市', value: shape.personalInfo?.city ?? '' },
        { label: '目标岗位', value: activeJob.title },
        { label: '自我介绍', value: shape.selfIntroduction ?? '' },
      ].filter((item) => item.value),
    [shape, activeJob.title],
  )

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.push('已复制', 'success')
    } catch {
      toast.push('复制失败，请手动选中', 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      testId="apply-dialog"
      width="max-w-5xl"
      title={`直接投递：${activeJob.companyName ?? ''} ${activeJob.title}`}
      subtitle="打开招聘页 → 把简历里的信息填进去 → 你核对后提交 → 顺手截个图留证。不会替你盲投。"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] text-stone-400">关闭不会结束会话，下次打开可继续填。</span>
          <Button onClick={onClose}>关闭</Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card className="p-5">
            <SectionTitle extra={session ? `会话 ${session.id.slice(0, 8)}` : undefined}>① 投哪个岗、从哪个页面进</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="岗位">
                <Select
                  value={jobId}
                  onChange={(event) => {
                    const nextId = event.target.value
                    const next = jobOptions.find((item) => item.id === nextId)
                    setJobId(nextId)
                    setUrl(next?.jdUrl ?? '')
                    setChannel(normalizeChannel(next?.channel))
                  }}
                  data-testid="apply-job"
                >
                  <option value="">选择岗位</option>
                  {jobOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.companyName} · {item.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="起始地址" hint="要打开的招聘页地址，默认是岗位的 JD 链接">
                <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" data-testid="apply-url" />
              </Field>
              <Field label="使用的简历">
                <Select value={resumeId} onChange={(event) => setResumeId(event.target.value)} data-testid="apply-resume">
                  <option value="">不指定</option>
                  {(resumes.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                      {item.kind === 'variant' ? '（定制版）' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="渠道">
                <Select value={channel} onChange={(event) => setChannel(event.target.value)} data-testid="apply-channel">
                  {CHANNEL_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={!jobId || open.isPending} onClick={() => open.mutate()} data-testid="apply-open">
                {open.isPending ? '打开中…' : '打开页面并扫描字段'}
              </Button>
              {session ? (
                <>
                  <Button onClick={() => reInspect.mutate()} disabled={reInspect.isPending}>
                    重新扫描
                  </Button>
                  <Button variant="danger" onClick={() => close.mutate()}>
                    结束会话
                  </Button>
                </>
              ) : null}
            </div>
            {session?.blocker?.blocked ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {session.blocker.kind === 'captcha' ? '检测到验证码' : session.blocker.kind === 'login' ? '需要先登录' : '页面异常'}：
                {session.blocker.reason}
                <div className="mt-1 text-amber-700">
                  在打开的浏览器里手动过掉，再点「重新扫描」。它不会想办法绕过风控。
                </div>
              </div>
            ) : null}
          </Card>

          {session ? (
            <Card className="p-5">
              <SectionTitle extra={STATUS_LABELS[session.status]}>② 逐项核对要填的内容</SectionTitle>
              <div className="space-y-2">
                {session.fields.map((field) => {
                  const outcome = session.fillResults?.find((item) => item.key === field.key)
                  return (
                    <div key={field.key} className="grid grid-cols-[120px_1fr_auto] items-center gap-2">
                      <span className="truncate text-[11px] text-stone-600" title={`${field.key}（${field.tag}${field.type ? `/${field.type}` : ''}）`}>
                        {field.label || field.name || field.key}
                        {field.required ? <span className="ml-0.5 text-red-500">*</span> : null}
                      </span>
                      {field.tag === 'select' ? (
                        <Select
                          value={values[field.key] ?? ''}
                          onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                          data-field={field.key}
                        >
                          <option value="">（不填）</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </Select>
                      ) : field.type === 'file' ? (
                        <span className="text-[11px] text-stone-400">文件上传：请在浏览器里手动选择</span>
                      ) : (
                        <Input
                          value={values[field.key] ?? ''}
                          onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                          placeholder={field.placeholder ?? ''}
                          data-field={field.key}
                        />
                      )}
                      <span className="w-16 text-right text-[10px]">
                        {outcome ? (
                          outcome.ok ? (
                            <span className="text-emerald-600">已填入</span>
                          ) : (
                            <span className="text-red-600" title={outcome.reason}>
                              失败
                            </span>
                          )
                        ) : null}
                      </span>
                    </div>
                  )
                })}
                {session.fields.length === 0 ? (
                  <div className="rounded-lg bg-stone-50 p-3 text-[11px] text-stone-500">
                    这一页没找到能填的输入框。可能是还没加载完，或者要先登录——在浏览器里处理好，再点「重新扫描」。
                  </div>
                ) : null}
              </div>

              {(session.fillResults ?? []).some((item) => !item.ok) ? (
                <ul className="mt-3 space-y-1 rounded-lg bg-red-50/60 p-3 text-[11px] text-red-700">
                  {(session.fillResults ?? [])
                    .filter((item) => !item.ok)
                    .map((item) => (
                      <li key={item.key}>
                        · {session.fields.find((field) => field.key === item.key)?.label || item.key}：{item.reason}
                      </li>
                    ))}
                </ul>
              ) : null}

              {session.manualFields.length > 0 ? (
                <div className="mt-3 text-[11px] text-amber-700">这几项要你自己填：{session.manualFields.join('、')}</div>
              ) : null}

              <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
                <label className="flex items-center gap-2 text-[11px] text-stone-600">
                  <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
                  我已核对页面上的信息，确认提交
                </label>
                <div className="flex gap-2">
                  <Button onClick={() => fill.mutate()} disabled={fill.isPending} data-testid="apply-fill">
                    {fill.isPending ? '填充中…' : '填入页面'}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!confirm || submit.isPending || session.status === 'blocked'}
                    onClick={() => submit.mutate()}
                    data-testid="apply-submit"
                  >
                    {submit.isPending ? '提交中…' : '提交并存证'}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}

          {result ? (
            <Card className="p-5">
              <SectionTitle extra="已写入投递记录">提交完了</SectionTitle>
              <div className="space-y-1 text-[11px] text-stone-600">
                <div>最终地址：{result.finalUrl}</div>
                <div>存证截图：{result.screenshotPath ?? '没截到（页面可能已经关了）'}</div>
                {result.emptyRequired.length > 0 ? (
                  <div className="text-amber-700">还有必填项没填：{result.emptyRequired.join('、')}</div>
                ) : (
                  <div className="text-emerald-700">所有必填项都填上了。</div>
                )}
              </div>
            </Card>
          ) : null}
        </div>

        <Card className="p-5">
          <SectionTitle extra="不想自动填就复制这些">手动填写时用</SectionTitle>
          <div className="space-y-2">
            {materials.length === 0 ? (
              <div className="text-[11px] text-stone-400">先建一份简历，这里会自动列出可以复制的信息。</div>
            ) : (
              materials.map((item) => (
                <div key={item.label} className="rounded-lg border border-stone-200 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-stone-500">{item.label}</span>
                    <button type="button" onClick={() => void copy(item.value)} className="text-[10px] text-stone-500 hover:text-stone-900">
                      复制
                    </button>
                  </div>
                  <div className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-stone-800">{item.value}</div>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 border-t border-stone-100 pt-3 text-[11px] leading-relaxed text-stone-400">
            自动填只在你自己的电脑上开浏览器。碰到验证码或要登录，它会停下来等你，不会去绕。
          </div>
        </Card>
      </div>
    </Modal>
  )
}
