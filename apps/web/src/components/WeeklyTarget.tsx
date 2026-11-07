import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { WEEKLY_TARGET_MAX, WEEKLY_TARGET_MIN } from '@land/core/settings'
import { patchSettings } from '../lib/api'
import { qk } from '../lib/queries'
import { errorText, useToast } from './Toast'

/**
 * 北极星的分母：本周有效投递目标。
 *
 * 交互刻意做得「轻」：默认只是 `/ 目标 8` 一行小字，鼠标移上去（或键盘 Tab 到）
 * 才露出铅笔，点开变成一个小输入框，回车/失焦保存、Esc 取消。
 * 不做成弹窗——改一个数弹一个 Dialog 太重，而这个数本来就该随手可调。
 *
 * 这里不复用 ui.tsx 的 `Input`：那个是表单控件（text-sm + py-1.5），
 * 而这个输入框要和 12px 的小字对齐。Tailwind 里 `.text-sm` 与 `.text-xs` 谁赢
 * 由生成顺序决定，调用点传 `text-xs` 覆盖不掉（`ui.tsx` 里 `fieldWidth()` 的注释
 * 就是同一个坑），所以这里手写一套尺寸。
 */
export function WeeklyTarget({ target }: { target: number }) {
  const client = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(target))
  // Esc 之后输入框会被卸载，blur 可能紧跟着触发；用 ref 记住「这次失焦是取消」
  const cancelling = useRef(false)

  const save = useMutation({
    mutationFn: (value: number) => patchSettings({ weeklyTarget: value }),
    onSuccess: (data) => {
      toast.push(`本周目标已改为 ${data.weeklyTarget} 份`, 'success')
      void client.invalidateQueries({ queryKey: qk.dashboard })
    },
    onError: (err) => toast.push(`目标没保存：${errorText(err)}`, 'error'),
  })

  const begin = () => {
    setDraft(String(target))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (cancelling.current) {
      cancelling.current = false
      return
    }
    const next = Number.parseInt(draft, 10)
    if (!Number.isFinite(next) || next === target) return
    if (next < WEEKLY_TARGET_MIN || next > WEEKLY_TARGET_MAX) {
      toast.push(`目标要填 ${WEEKLY_TARGET_MIN}–${WEEKLY_TARGET_MAX} 之间的整数`, 'error')
      return
    }
    save.mutate(next)
  }

  if (editing) {
    return (
      <span className="mb-1 flex items-baseline gap-1.5 text-xs text-stone-400">
        / 目标
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          min={WEEKLY_TARGET_MIN}
          max={WEEKLY_TARGET_MAX}
          step={1}
          value={draft}
          data-testid="north-star-target-input"
          aria-label="本周有效投递目标"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancelling.current = true
              setDraft(String(target))
              setEditing(false)
            }
          }}
          className="no-spin w-12 rounded border border-stone-300 bg-white px-1 py-0.5 text-center font-mono text-xs tabular-nums text-stone-900 focus:border-stone-500 focus:outline-none"
        />
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={begin}
      data-testid="north-star-target"
      title={`每周目标 ${target} 份，点一下可以改（${WEEKLY_TARGET_MIN}–${WEEKLY_TARGET_MAX}）`}
      className="group mb-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus-visible:bg-stone-100 focus-visible:text-stone-600 focus-visible:outline-none"
    >
      <span>/ 目标</span>
      <span className="font-mono tabular-nums text-stone-500 group-hover:text-stone-900">{target}</span>
      <Pencil
        aria-hidden="true"
        className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  )
}
