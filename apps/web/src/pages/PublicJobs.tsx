import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { favoritePublicJob, listPublicJobs, type PublicJobSummaryDto } from '../lib/api'
import { useSessionState } from '../lib/sessionState'
import { Button, Card, EmptyState, Input, PageHeader, Select } from '../components/ui'
import { errorText, useToast } from '../components/Toast'
import { useT } from '../i18n'

function salary(job: PublicJobSummaryDto): string {
  if (job.salaryMin == null && job.salaryMax == null) return job.salaryText || '—'
  const format = (value: number | null) => (value == null ? '?' : String(Math.round(value / 1000)))
  return `${format(job.salaryMin)}-${format(job.salaryMax)}K`
}

export default function PublicJobs() {
  const t = useT()
  const toast = useToast()
  const client = useQueryClient()
  const [search, setSearch] = useSessionState('publicJobs.search', '')
  const [city, setCity] = useSessionState('publicJobs.city', '')
  const [status, setStatus] = useSessionState('publicJobs.status', 'open')
  const [sort, setSort] = useSessionState<'updated' | 'posted' | 'firstSeen'>('publicJobs.sort', 'updated')
  const [cursor, setCursor] = useState<string | undefined>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const [favorites, setFavorites] = useState<Record<string, string>>({})

  const jobs = useQuery({
    queryKey: ['public-jobs', { q: search, city, status, sort, cursor }],
    queryFn: () =>
      listPublicJobs({
        q: search || undefined,
        city: city || undefined,
        status: status || undefined,
        sort,
        cursor,
      }),
    placeholderData: (previous) => previous,
  })

  const favorite = useMutation({
    mutationFn: (id: string) => favoritePublicJob(id),
    onSuccess: ({ job, duplicate }, publicId) => {
      setFavorites((current) => ({ ...current, [publicId]: job.id }))
      toast.push(t(duplicate ? '该岗位已在私有库' : '已收藏到私有库'), 'success')
      void client.invalidateQueries({ queryKey: ['jobs'] })
      void client.invalidateQueries({ queryKey: ['companies'] })
      void client.invalidateQueries({ queryKey: ['stats'] })
    },
    onError: (error) => toast.push(t('收藏失败：{message}', { message: errorText(error) }), 'error'),
  })

  const updateFilter = (update: () => void) => {
    update()
    setCursor(undefined)
    setHistory([])
  }

  const rows = jobs.data?.items ?? []

  return (
    <div>
      <PageHeader
        title={t('公开库')}
        description={t('岗位来自 Position Hub 的公开职位仓库。收藏后会带入完整 JD，并出现在私有库中。')}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
        <Input
          value={city}
          onChange={(event) => updateFilter(() => setCity(event.target.value))}
          placeholder={t('按城市筛选')}
          aria-label={t('公开库城市筛选')}
          className="w-36"
        />
        <Select
          value={status}
          onChange={(event) => updateFilter(() => setStatus(event.target.value))}
          className="w-32"
          aria-label={t('公开库状态筛选')}
        >
          <option value="open">{t('在招')}</option>
          <option value="paused">{t('暂停')}</option>
          <option value="closed">{t('已关闭')}</option>
          <option value="">{t('全部状态')}</option>
        </Select>
        <Select
          value={sort}
          onChange={(event) => updateFilter(() => setSort(event.target.value as typeof sort))}
          className="w-36"
          aria-label={t('公开库排序')}
        >
          <option value="updated">{t('按最近更新')}</option>
          <option value="posted">{t('按发布时间')}</option>
          <option value="firstSeen">{t('按收录时间')}</option>
        </Select>
        <span className="ml-auto text-stone-400">{t('本页 {count} 个岗位', { count: rows.length })}</span>
      </div>

      <div className="mb-3">
        <Input
          value={search}
          onChange={(event) => updateFilter(() => setSearch(event.target.value))}
          placeholder={t('搜索公开岗位、公司、城市、关键词或 JD 正文')}
          aria-label={t('搜索公开岗位')}
          className="w-full"
        />
      </div>

      {jobs.status === 'error' ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errorText(jobs.error)}
        </div>
      ) : null}

      {jobs.status === 'pending' ? (
        <Card className="p-4 text-xs text-stone-500">{t('加载公开岗位…')}</Card>
      ) : rows.length === 0 && jobs.status === 'success' ? (
        <Card className="p-4">
          <EmptyState title={t('没有符合条件的公开岗位')} hint={t('换个关键词或城市再试。')} />
        </Card>
      ) : rows.length > 0 ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="border-b border-stone-200 bg-stone-50/60 text-[11px] text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t('公司 · 岗位')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('城市')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('薪资')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('来源')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('更新时间')}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t('操作')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((job) => {
                const favoriteId = favorites[job.id]
                return (
                  <tr key={job.id} className="hover:bg-stone-50/60">
                    <td className="px-4 py-2.5">
                      {job.jdUrl ? (
                        <a href={job.jdUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-stone-900 hover:underline">
                          {job.title}<ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="font-medium text-stone-900">{job.title}</span>
                      )}
                      <div className="mt-0.5 text-[11px] text-stone-500">{job.companyName}</div>
                    </td>
                    <td className="px-3 py-2.5 text-stone-600">{job.cities.join('、') || job.city || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-stone-600">{salary(job)}</td>
                    <td className="px-3 py-2.5 text-stone-600">{job.jdSource || '—'}</td>
                    <td className="px-3 py-2.5 text-stone-600">{job.updatedAt.slice(0, 10)}</td>
                    <td className="px-3 py-2.5">
                      <Button
                        variant={favoriteId ? 'secondary' : 'primary'}
                        data-testid={`favorite-public-${job.id}`}
                        aria-label={favoriteId ? t('已收藏 {title}', { title: job.title }) : t('收藏 {title}', { title: job.title })}
                        disabled={Boolean(favoriteId) || (favorite.isPending && favorite.variables === job.id)}
                        onClick={() => favorite.mutate(job.id)}
                      >
                        {favoriteId ? t('已收藏') : favorite.isPending && favorite.variables === job.id ? t('收藏中…') : t('收藏')}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <Button
          variant="secondary"
          disabled={history.length === 0 || jobs.isFetching}
          onClick={() => {
            const previous = history.at(-1)
            setHistory((items) => items.slice(0, -1))
            setCursor(previous)
          }}
        >
          {t('上一页')}
        </Button>
        <span className="text-[11px] text-stone-400">{t('第 {page} 页', { page: history.length + 1 })}</span>
        <Button
          variant="secondary"
          data-testid="public-jobs-next"
          disabled={!jobs.data?.nextCursor || jobs.isFetching}
          onClick={() => {
            if (!jobs.data?.nextCursor) return
            setHistory((items) => [...items, cursor])
            setCursor(jobs.data.nextCursor)
          }}
        >
          {jobs.isFetching ? t('加载中…') : t('下一页')}
        </Button>
      </div>
    </div>
  )
}
