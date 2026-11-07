import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  createSnapshot,
  downloadExport,
  getExportDump,
  getSkills,
  listSnapshots,
  type SnapshotDto,
} from '../lib/api'
import { qk } from '../lib/queries'
import { AGENT_INSTALL_URL_ZH, GITHUB_URL, SITE_URL_ZH } from '../lib/links'
import { Button, Card, EmptyState, PageHeader, SectionTitle } from '../components/ui'
import { errorText, useToast } from '../components/Toast'

function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function when(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Settings() {
  const client = useQueryClient()
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)

  const snapshots = useQuery({ queryKey: qk.snapshots, queryFn: listSnapshots })
  const skills = useQuery({ queryKey: qk.skills, queryFn: getSkills, staleTime: 60_000 })
  const dump = useQuery({ queryKey: ['data-export'], queryFn: getExportDump })

  // 进页面时先备份一次：设置页是「我要动数据了」的地方，先有快照再动手
  const snapshot = useMutation({
    mutationFn: createSnapshot,
    onSuccess: (result: SnapshotDto & { kept: number; removed: string[] }) => {
      toast.push(`快照已生成（${bytes(result.bytes)}）${result.removed.length ? `，清理了 ${result.removed.length} 份旧快照` : ''}`, 'success')
      void client.invalidateQueries({ queryKey: qk.snapshots })
    },
    onError: (error) => toast.push(`备份失败：${errorText(error)}`, 'error'),
  })

  useEffect(() => {
    // 只在第一次挂载且还没有任何快照时自动备份一次，避免每次进页面都写盘
    if (snapshots.status === 'success' && snapshots.data.items.length === 0 && !snapshot.isPending) {
      snapshot.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots.status, snapshots.data])

  const download = async () => {
    setDownloading(true)
    try {
      const result = await downloadExport()
      toast.push(`已导出 ${result.filename}（${bytes(result.bytes)}）`, 'success')
    } catch (error) {
      toast.push(`导出失败：${errorText(error)}`, 'error')
    } finally {
      setDownloading(false)
    }
  }

  const tables = Object.entries(dump.data?.counts ?? {})
  const totalRows = tables.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        title="数据和 Agent 连接"
        description="数据只存在这台电脑上：备份是本地文件，导出是一个 JSON。想让 AI 帮你搜岗、改简历、投递，就在 WorkBuddy / Kimi 这类 Agent 里装好下面的 Skill，它通过 MCP 读写这些数据——这个应用自己不会去调模型。"
        actions={
          <Button variant="primary" data-testid="snapshot-now" disabled={snapshot.isPending} onClick={() => snapshot.mutate()}>
            {snapshot.isPending ? '备份中…' : '立即备份'}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <SectionTitle extra={`保留最近 ${snapshots.data?.keep ?? 7} 份`}>快照</SectionTitle>
          <div className="mb-2 break-all rounded bg-stone-50 px-2 py-1.5 font-mono text-[10px] text-stone-500">
            {snapshots.data?.dir ?? '—'}
          </div>
          {snapshots.status === 'success' && snapshots.data.items.length === 0 ? (
            <EmptyState title="还没有快照" hint="点右上角「立即备份」生成第一份；之后每次打开这页也会自动补一份。" />
          ) : (
            <ul className="divide-y divide-stone-100" data-testid="snapshot-list">
              {snapshots.data?.items.map((item) => (
                <li key={item.file} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                  <span className="truncate font-mono text-stone-600">{item.file.split('/').pop()}</span>
                  <span className="shrink-0 text-stone-400">
                    {when(item.createdAt)} · {bytes(item.bytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
            备份是数据库自己导出的完整副本，不是直接拷文件——边写边拷可能拷到一半，那种文件打不开。
          </p>
        </Card>

        <Card className="p-4">
          <SectionTitle extra={dump.data ? `${totalRows} 行` : '—'}>全库导出</SectionTitle>
          <p className="mb-2 text-[11px] leading-relaxed text-stone-500">
            导出的是<span className="font-medium text-stone-700">所有原始字段</span>（包括已经删掉的记录和每次操作是谁做的），换电脑时用它把数据搬过去。比页面上能看到的更全。
          </p>
          <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-stone-600 sm:grid-cols-3">
            {tables.map(([name, count]) => (
              <div key={name} className="flex items-baseline justify-between gap-1">
                <span className="truncate font-mono text-[10px] text-stone-500">{name}</span>
                <span className="font-mono text-stone-900">{count}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button data-testid="export-json" disabled={downloading} onClick={() => void download()}>
              {downloading ? '导出中…' : '下载 JSON'}
            </Button>
            <span className="text-[10px] text-stone-400">
              {dump.data ? `schema v${dump.data.app.schemaVersion} · v${dump.data.app.version}` : ''}
            </span>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <SectionTitle extra={`${skills.data?.skills.filter((item) => item.compatible).length ?? 0}/${skills.data?.skills.length ?? 0} 就绪`}>
          Skill 安装状态
        </SectionTitle>
        <p className="mb-2 text-[11px] leading-relaxed text-stone-500">
          这些是给 Agent 看的说明书：装了 Skill，Agent 才知道怎么按规矩读写这里的数据。
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
          <span>仓库目录</span>
          <code className="break-all rounded bg-stone-50 px-1.5 py-0.5 font-mono text-[10px]">{skills.data?.dir ?? '—'}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText('npm run skills:install')
              toast.push('安装命令已复制', 'success')
            }}
            className="text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
          >
            复制安装命令
          </button>
        </div>
        {/* 第一次装、换机器、想升级时，把安装说明交给 Agent 比照着手敲命令省事 */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500">
          <span>第一次装？把安装说明交给你的 Agent：</span>
          <a
            href={AGENT_INSTALL_URL_ZH}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
          >
            安装说明
          </a>
          <a
            href={SITE_URL_ZH}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
          >
            官网
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-stone-300 underline-offset-2 hover:text-stone-800"
          >
            GitHub
          </a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[11px]">
            <thead>
              <tr className="border-b border-stone-200 text-left text-[10px] text-stone-500">
                <th className="py-1.5 pr-2 font-normal">Skill</th>
                <th className="py-1.5 pr-2 font-normal">版本</th>
                <th className="py-1.5 pr-2 font-normal">状态</th>
                <th className="py-1.5 pr-2 font-normal">安装到</th>
                <th className="py-1.5 font-normal">写接口</th>
              </tr>
            </thead>
            <tbody>
              {skills.data?.skills.map((item) => {
                const installed = (skills.data?.targets ?? [])
                  .filter((target) => target.installed.includes(item.name))
                  .map((target) => target.dir)
                return (
                  <tr key={item.name} className="border-b border-stone-100 last:border-0" data-testid="skill-row">
                    <td className="py-1.5 pr-2">
                      <div className="font-mono text-stone-800">{item.name}</div>
                      <div className="text-[10px] text-stone-400">{item.title}</div>
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-stone-600">{skills.data?.versions[item.name] ?? '—'}</td>
                    <td className="py-1.5 pr-2">
                      <span className={item.compatible ? 'text-emerald-700' : 'text-amber-700'}>
                        {item.compatible ? '就绪' : '未就绪'}
                      </span>
                      {item.note ? <div className="text-[10px] text-stone-400">{item.note}</div> : null}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[10px] text-stone-500">
                      {installed.length > 0 ? installed.join(' · ') : '未安装'}
                    </td>
                    <td className="py-1.5 font-mono text-[10px] text-stone-500">{item.writeTools.join(', ')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
          版本以仓库里的 SKILL.md 为准；改了却没重新装，这里会显示「未就绪」。Agent 写回的每条数据都带着版本号，对不上服务端就不收。
        </p>
      </Card>
    </div>
  )
}
