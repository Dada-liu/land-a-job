import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSkills } from '../lib/api'
import { qk } from '../lib/queries'
import { Button } from './ui'
import { useToast } from './Toast'

/**
 * AI 交接组件（P7-9）。
 *
 * 这个应用**不调用模型**，所以每个「生成类」按钮最后都要落到一句话上：
 * 「把这段指令粘到你的 Agent 里，装好对应 Skill，产出会通过 MCP 落回本地库」。
 *
 * 三件事必须同时给到，缺一个用户就会卡住：
 * 1. **能复制的指令**（自带 jobId / resumeId / 缺口，不用用户自己拼）；
 * 2. **用哪个 Skill**，以及它没装时的那条安装命令；
 * 3. **兜底出口**：用户也可以自己在别处改好，点「我已手动改好」直接刷新。
 *
 * 不做的事：不假装「正在生成」，不放进度条。假装在跑比老实说「需要你去 Agent 里做」更糟。
 */

export interface HandoffStep {
  label: string
  /** 可选的补充说明，例如要检查的点 */
  hint?: string
}

export function AgentHandoff({
  skill,
  instruction,
  steps,
  title = '在 Agent 中执行',
  note,
  onDone,
  doneLabel = '我已手动改好，刷新',
}: {
  /** SKILL_REGISTRY 里的 skill 名，用于查安装状态并给出安装命令 */
  skill: string
  /** 可复制的完整指令（含 id 与上下文） */
  instruction: string
  steps?: HandoffStep[]
  title?: string
  note?: string
  /** 用户点「我已手动改好」后做什么（通常是失效查询） */
  onDone?: () => void
  doneLabel?: string
}) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const skills = useQuery({ queryKey: qk.skills, queryFn: getSkills, staleTime: 60_000 })

  const status = (skills.data?.skills ?? []).find((item) => item.name === skill)
  const installCommand = 'npm run skills:install'

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(instruction)
      setCopied(true)
      toast.push('指令已复制，粘贴到 Agent 里即可', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 非 https / 无剪贴板权限时会走到这里：别静默失败，让用户手动选
      toast.push('浏览器不允许自动复制，请手动选中下面的文字', 'error')
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50/60 p-3" data-testid="agent-handoff">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-stone-700">{title}</span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
              status?.compatible ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
            data-testid="handoff-skill"
            data-skill={skill}
            data-compatible={status?.compatible ? 'true' : 'false'}
          >
            {skill}
            {status?.compatible ? '' : ' · 未就绪'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button data-testid="handoff-copy" onClick={() => void copy()}>
            {copied ? '已复制' : '复制指令'}
          </Button>
          {onDone ? <Button onClick={onDone}>{doneLabel}</Button> : null}
        </div>
      </div>

      <pre
        data-testid="handoff-instruction"
        className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-stone-200 bg-white p-2 font-mono text-[10.5px] leading-relaxed text-stone-600"
      >
        {instruction}
      </pre>

      {steps && steps.length > 0 ? (
        <ol className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-stone-500">
          {steps.map((step, index) => (
            <li key={step.label} className="flex gap-1.5">
              <span className="font-mono text-stone-400">{index + 1}.</span>
              <span>
                {step.label}
                {step.hint ? <span className="text-stone-400">（{step.hint}）</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {status && !status.compatible ? (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
          <div>这台机器还没装好 `{skill}`。先跑一次：</div>
          <code className="mt-0.5 inline-block rounded bg-white px-1 py-0.5 font-mono text-[10.5px]">{installCommand}</code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(installCommand)
              toast.push('安装命令已复制', 'success')
            }}
            className="ml-2 underline decoration-amber-300 underline-offset-2 hover:text-amber-900"
          >
            复制
          </button>
        </div>
      ) : null}

      {note ? <div className="mt-2 text-[10px] leading-relaxed text-stone-400">{note}</div> : null}
    </div>
  )
}
