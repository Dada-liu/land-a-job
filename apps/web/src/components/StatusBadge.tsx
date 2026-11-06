import { STATUS_LABELS, type Status } from '@land/core/application'

/**
 * 状态徽标。配色按「推进得越远越暖」排列：
 * 线索/待投是中性灰，已投/筛选是冷色，面试/offer 才给高饱和，
 * 这样一眼扫过去，注意力会自然落在需要行动的那几列。
 */
const STYLES: Record<string, string> = {
  lead: 'bg-stone-100 text-stone-600',
  queued: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
  applied: 'bg-blue-50 text-blue-700 ring-1 ring-blue-100',
  screening: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100',
  assessment: 'bg-violet-50 text-violet-700 ring-1 ring-violet-100',
  interview: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100',
  offer: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  accepted: 'bg-emerald-600 text-white',
  rejected: 'bg-stone-100 text-stone-500',
  ghosted: 'bg-stone-100 text-stone-400',
  withdrawn: 'bg-stone-100 text-stone-400',
}

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const label = STATUS_LABELS[status as Status] ?? status
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${STYLES[status] ?? STYLES.lead} ${className}`}
    >
      {label}
    </span>
  )
}
