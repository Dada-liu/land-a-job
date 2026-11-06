import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  createCompany,
  deleteCompany,
  listCompanies,
  patchCompany,
  type CompanyDto,
  type CompanyInput,
} from '../lib/api'
import { qk } from '../lib/queries'
import { Button, Card, EmptyState, Field, Input, PageHeader, Select, Textarea } from '../components/ui'
import { Drawer } from '../components/Drawer'
import { useConfirm } from '../components/ConfirmDialog'
import { errorText, useToast } from '../components/Toast'

const SIZES = ['<100', '100-499', '500-1999', '2000-9999', '10000+']

const EMPTY: CompanyInput = {
  name: '',
  website: '',
  industry: '',
  size: '',
  city: '',
  priority: 3,
  applyEntry: '',
  notes: '',
}

export default function Companies() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CompanyDto | null>(null)
  const [form, setForm] = useState<CompanyInput>(EMPTY)
  const [open, setOpen] = useState(false)
  const [params] = useSearchParams()
  const focusId = params.get('focus')

  const client = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()

  const companies = useQuery({ queryKey: [...qk.companies, search], queryFn: () => listCompanies({ q: search || undefined }) })

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: qk.companies })
    void client.invalidateQueries({ queryKey: qk.dashboard })
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload: CompanyInput = {
        ...form,
        website: form.website || null,
        industry: form.industry || null,
        size: form.size || null,
        city: form.city || null,
        applyEntry: form.applyEntry || null,
        notes: form.notes || null,
      }
      return editing ? patchCompany(editing.id, payload) : createCompany(payload)
    },
    onSuccess: () => {
      toast.push(editing ? '公司已更新' : '公司已创建', 'success')
      invalidate()
      setOpen(false)
    },
    onError: (error) => toast.push(`保存失败：${errorText(error)}`, 'error'),
  })

  const remove = useMutation({
    mutationFn: (input: { id: string; cascade: boolean }) => deleteCompany(input.id, input.cascade),
    onSuccess: () => {
      toast.push('已删除', 'success')
      invalidate()
    },
    onError: (error) => toast.push(`删除失败：${errorText(error)}`, 'error'),
  })

  const handleDelete = async (company: CompanyDto) => {
    const jobCount = company.jobCount ?? 0
    const confirmed = await confirm({
      title: `删除公司「${company.name}」？`,
      description:
        jobCount > 0
          ? `这家公司下还有 ${jobCount} 个岗位，会连同岗位一起删除；相关投递记录也会失去归属。`
          : '删除后无法恢复，只能重新录入。',
      confirmText: jobCount > 0 ? '连同岗位删除' : '删除',
      danger: true,
    })
    if (!confirmed) return
    remove.mutate({ id: company.id, cascade: jobCount > 0 })
  }

  const rows = useMemo(() => companies.data ?? [], [companies.data])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY)
    setOpen(true)
  }

  const openEdit = (company: CompanyDto) => {
    setEditing(company)
    setForm({
      name: company.name,
      website: company.website ?? '',
      industry: company.industry ?? '',
      size: company.size ?? '',
      city: company.city ?? '',
      priority: company.priority,
      applyEntry: company.applyEntry ?? '',
      notes: company.notes ?? '',
    })
    setOpen(true)
  }

  return (
    <div>
      <PageHeader
        title="公司库"
        description="想去的公司都放这里，岗位挂在公司下面。同一个名字不会悄悄建出两家，这样投递记录才能都归到一家公司身上。"
        actions={
          <>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索名称 / 行业 / 城市"
              className="w-56"
            />
            <Button variant="primary" onClick={openCreate}>
              新建公司
            </Button>
          </>
        }
      />

      {companies.status === 'error' ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errorText(companies.error)}
        </div>
      ) : null}

      {companies.status === 'pending' ? (
        <Card className="p-4 text-xs text-stone-500">加载公司…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            title={search ? '没有匹配的公司' : '还没有公司'}
            hint={search ? '换个关键词，或者直接新建一家。' : '按 ⌘K 一句话建岗时，没有这家公司会自动建好。'}
            action={search ? undefined : <Button onClick={openCreate}>新建第一家公司</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-stone-200 bg-stone-50/60 text-[11px] text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">公司</th>
                <th className="px-3 py-2 font-medium">城市</th>
                <th className="px-3 py-2 font-medium">行业 / 规模</th>
                <th className="px-3 py-2 font-medium text-center">优先级</th>
                <th className="px-3 py-2 font-medium text-center">岗位</th>
                <th className="px-3 py-2 font-medium">投递入口</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((company) => (
                <tr
                  key={company.id}
                  className={`hover:bg-stone-50/60 ${focusId === company.id ? 'bg-amber-50/40' : ''}`}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-stone-900">{company.name}</span>
                      {company.website ? (
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-stone-400 hover:text-stone-700"
                        >
                          官网
                        </a>
                      ) : null}
                    </div>
                    {company.notes ? (
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-stone-400">{company.notes}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-stone-600">{company.city ?? '—'}</td>
                  <td className="px-3 py-2.5 text-stone-600">
                    {[company.industry, company.size].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="font-mono text-stone-700">P{company.priority}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => navigate(`/jobs?companyId=${company.id}`)}
                      className="font-mono text-stone-700 underline-offset-2 hover:underline"
                    >
                      {company.jobCount ?? 0}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    {company.applyEntry ? (
                      <a
                        href={company.applyEntry}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-stone-500 underline-offset-2 hover:text-stone-900 hover:underline"
                      >
                        直达
                      </a>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => openEdit(company)}>
                        编辑
                      </Button>
                      <Button variant="danger" onClick={() => void handleDelete(company)}>
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `编辑 ${editing.name}` : '新建公司'}
        subtitle="只填名字就能建，官网和投递入口想起来再补"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              data-testid="company-save"
              variant="primary"
              disabled={form.name.trim().length === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="公司名称">
            <Input
              data-testid="company-name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="城市">
              <Input value={form.city ?? ''} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
            <Field label="优先级" hint="1 最想去。列表会按它排序">
              <Select
                value={form.priority ?? 3}
                onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    P{n}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="行业">
              <Input value={form.industry ?? ''} onChange={(event) => setForm({ ...form, industry: event.target.value })} />
            </Field>
            <Field label="规模">
              <Select value={form.size ?? ''} onChange={(event) => setForm({ ...form, size: event.target.value })}>
                <option value="">未填</option>
                {SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="官网">
            <Input
              value={form.website ?? ''}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
              placeholder="https://"
            />
          </Field>
          <Field label="投递入口" hint="这家公司的招聘页地址。点「直接投递」时会默认打开它">
            <Input
              value={form.applyEntry ?? ''}
              onChange={(event) => setForm({ ...form, applyEntry: event.target.value })}
              placeholder="https://"
            />
          </Field>
          <Field label="备注">
            <Textarea rows={3} value={form.notes ?? ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
      </Drawer>
    </div>
  )
}
