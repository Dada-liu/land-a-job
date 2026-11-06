import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createCompany, createJob, fetchJd, listCompanies, listJobs, scoreJob } from '../lib/api'
import { qk } from '../lib/queries'
import { PRIMARY_NAV, SETTINGS_TABS } from '../lib/navigation'
import { errorText, useToast } from './Toast'

/**
 * 全局快捷录入（P3-8）。
 *
 * 一句话 → 岗位：只做「结构化字段抽取」，不做语义理解，也不调模型。
 * 抽不出来的就留空，让用户在岗位详情里补——比猜错一个公司名强。
 */

export interface QuickParse {
  raw: string
  company: string
  title: string
  salaryMin: number | null
  salaryMax: number | null
  city: string | null
  url: string | null
}

const CITY_HINTS = ['北京', '上海', '深圳', '广州', '杭州', '成都', '南京', '武汉', '西安', '苏州', '厦门', '长沙']

export function parseQuickInput(raw: string): QuickParse {
  let rest = raw.trim()
  const urlMatch = /https?:\/\/\S+/.exec(rest)
  const url = urlMatch?.[0] ?? null
  if (url) rest = rest.replace(url, ' ')

  const salaryMatch = /(\d{1,3})\s*[kK千]?\s*[-~至到]\s*(\d{1,3})\s*[kK千万]/.exec(rest)
  let salaryMin: number | null = null
  let salaryMax: number | null = null
  if (salaryMatch) {
    const unitIsWan = /万/.test(salaryMatch[0])
    const factor = unitIsWan ? 10_000 : 1000
    salaryMin = Number(salaryMatch[1]) * factor
    salaryMax = Number(salaryMatch[2]) * factor
    rest = rest.replace(salaryMatch[0], ' ')
  }

  let city: string | null = null
  for (const hint of CITY_HINTS) {
    if (rest.includes(hint)) {
      city = hint
      rest = rest.replace(hint, ' ')
      break
    }
  }

  const tokens = rest
    .split(/[\s,，、/|]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const company = tokens[0] ?? ''
  const title = tokens.slice(1).join(' ').trim()
  return { raw, company, title, salaryMin, salaryMax, city, url }
}

// 从导航配置生成，不再手抄一份列表：一级项全列，设置下的二级页也保留直达入口
// （收进侧栏不等于要从 ⌘K 里消失，否则「会打字的人」反而要多点一层）。
const NAV_SHORTCUTS: { label: string; to: string; hint: string }[] = [
  ...PRIMARY_NAV.map((item) => ({ label: item.label, to: item.to, hint: '前往' })),
  ...SETTINGS_TABS.filter((item) => item.to !== '/settings').map((item) => ({
    label: `设置 · ${item.label}`,
    to: item.to,
    hint: '设置下的二级页',
  })),
]

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const client = useQueryClient()
  const toast = useToast()

  const parsed = useMemo(() => parseQuickInput(value), [value])
  const canCreate = parsed.company.length > 0 && parsed.title.length > 0

  const search = useQuery({
    queryKey: ['quick-search', value],
    queryFn: async () => {
      if (value.trim().length < 2) return { jobs: [], companies: [] }
      const [jobs, companies] = await Promise.all([
        listJobs({ q: value.trim(), limit: 5 }),
        listCompanies({ q: value.trim(), limit: 5 }),
      ])
      return { jobs, companies }
    },
    enabled: open && value.trim().length >= 2,
  })

  const create = useMutation({
    mutationFn: async () => {
      const companies = await listCompanies({ q: parsed.company, limit: 50 })
      const existing = companies.find((company) => company.name === parsed.company)
      const company = existing ?? (await createCompany({ name: parsed.company }))
      return createJob({
        companyId: company.id,
        title: parsed.title,
        jdUrl: parsed.url,
        city: parsed.city,
        salaryMin: parsed.salaryMin,
        salaryMax: parsed.salaryMax,
        channel: 'official',
      })
    },
    onSuccess: (job) => {
      toast.push(`已建岗位：${parsed.company} · ${job.title}${parsed.url ? '，正在抓取 JD' : ''}`, 'success')
      void client.invalidateQueries({ queryKey: ['jobs'] })
      void client.invalidateQueries({ queryKey: ['companies'] })
      void client.invalidateQueries({ queryKey: qk.dashboard })

      // 与 add_job MCP 工具保持一致：带链接建岗就自动抓正文 + 打分。
      // 抓取失败不回滚岗位，提示用户去详情页粘贴即可。
      if (parsed.url) {
        void fetchJd(job.id)
          .then(() => scoreJob(job.id))
          .then(() => {
            void client.invalidateQueries({ queryKey: qk.job(job.id) })
            void client.invalidateQueries({ queryKey: ['jobs'] })
          })
          .catch((error: unknown) =>
            toast.push(`岗位已建，但 JD 没抓到：${errorText(error)}；可在详情页粘贴正文`, 'error'),
          )
      }

      setValue('')
      onClose()
      navigate(`/jobs/${job.id}`)
    },
    onError: (error) => toast.push(`创建失败：${errorText(error)}`, 'error'),
  })

  useEffect(() => {
    if (!open) return
    setValue('')
    setCursor(0)
    // 等 portal 挂载后再聚焦，否则 ref 还是 null
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const rows: { key: string; label: string; hint?: string; run: () => void }[] = []
  if (canCreate) {
    rows.push({
      key: 'create',
      label: `新建岗位：${parsed.company} · ${parsed.title}`,
      hint: [parsed.city, parsed.salaryMin ? `${parsed.salaryMin / 1000}-${(parsed.salaryMax ?? 0) / 1000}K` : null, parsed.url ? '带 JD 链接' : null]
        .filter(Boolean)
        .join(' · '),
      run: () => create.mutate(),
    })
  }
  for (const job of search.data?.jobs ?? []) {
    rows.push({
      key: `job-${job.id}`,
      label: `${job.companyName ?? '未知公司'} · ${job.title}`,
      hint: `岗位 · 匹配度 ${job.fitScore ?? '—'}`,
      run: () => {
        onClose()
        navigate(`/jobs/${job.id}`)
      },
    })
  }
  for (const company of search.data?.companies ?? []) {
    rows.push({
      key: `company-${company.id}`,
      label: company.name,
      hint: `公司 · ${company.jobCount ?? 0} 个岗位`,
      run: () => {
        onClose()
        navigate(`/companies?focus=${company.id}`)
      },
    })
  }
  if (value.trim().length === 0) {
    for (const item of NAV_SHORTCUTS) {
      rows.push({
        key: `nav-${item.to}`,
        label: item.label,
        hint: item.hint,
        run: () => {
          onClose()
          navigate(item.to)
        },
      })
    }
  }

  const active = rows[Math.min(cursor, Math.max(0, rows.length - 1))]

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center pt-24">
      <button type="button" aria-label="关闭" className="absolute inset-0 bg-stone-900/25" onClick={onClose} />
      <div className="relative w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl">
        <input
          ref={inputRef}
          data-testid="palette-input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setCursor(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setCursor((n) => Math.min(n + 1, rows.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((n) => Math.max(n - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              active?.run()
            }
          }}
          placeholder="输入「公司 岗位 30-50k https://…」直接建岗位，或搜索"
          className="w-full border-b border-stone-200 px-4 py-3 text-sm outline-none placeholder:text-stone-400"
        />

        {canCreate ? (
          <div className="border-b border-stone-100 bg-stone-50/60 px-4 py-2 text-[11px] text-stone-500">
            识别为：公司 <span className="font-medium text-stone-800">{parsed.company}</span> · 岗位{' '}
            <span className="font-medium text-stone-800">{parsed.title}</span>
            {parsed.city ? ` · ${parsed.city}` : ''}
            {parsed.salaryMin ? ` · ${parsed.salaryMin / 1000}-${(parsed.salaryMax ?? 0) / 1000}K` : ''}
          </div>
        ) : null}

        <ul className="max-h-80 overflow-auto py-1">
          {rows.map((row, index) => (
            <li key={row.key}>
              <button
                type="button"
                data-testid={row.key === 'create' ? 'palette-create' : undefined}
                onMouseEnter={() => setCursor(index)}
                onClick={row.run}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs ${
                  index === cursor ? 'bg-stone-100 text-stone-900' : 'text-stone-700'
                }`}
              >
                <span className="truncate">{row.label}</span>
                {row.hint ? <span className="shrink-0 text-[10px] text-stone-400">{row.hint}</span> : null}
              </button>
            </li>
          ))}
          {rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-[11px] text-stone-400">
              没有匹配。试试「字节 后端工程师 30-50k」，会直接建好岗位。
            </li>
          ) : null}
        </ul>

        <div className="flex items-center justify-between border-t border-stone-100 px-4 py-2 text-[10px] text-stone-400">
          <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
          <span>不联网、不调模型，就在本地按规则识别</span>
        </div>
      </div>
    </div>
  )
}
