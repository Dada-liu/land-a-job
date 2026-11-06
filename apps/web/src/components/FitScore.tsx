/**
 * fit 分数与因子展示。
 *
 * 分数只是入口，真正让人做决定的是「为什么是这个分」——
 * 所以因子永远和分数一起出现，且直接写证据原文，不写权重系数。
 */
export interface FitFactorView {
  key: string
  weight: number
  score: number
  evidence: string
}

/** 服务端存的是「人话字符串」（fit_reasons 是 text[]），前端可能拿到对象也可能拿到字符串 */
export type FitFactorLike = FitFactorView | string

const FACTOR_LABELS: Record<string, string> = {
  must: '硬性条件',
  tech: '技术匹配',
  years: '年限',
  domain: '领域',
  city: '城市',
  salary: '薪资',
}

export function fitTone(score: number | null): { text: string; bg: string; label: string } {
  if (score === null) return { text: 'text-stone-400', bg: 'bg-stone-100', label: '未评分' }
  if (score >= 75) return { text: 'text-emerald-700', bg: 'bg-emerald-50', label: '匹配' }
  if (score >= 60) return { text: 'text-lime-700', bg: 'bg-lime-50', label: '可投' }
  if (score >= 40) return { text: 'text-amber-700', bg: 'bg-amber-50', label: '有缺口' }
  return { text: 'text-stone-500', bg: 'bg-stone-100', label: '不建议' }
}

export function FitScore({
  score,
  factors,
  compact = false,
}: {
  score: number | null
  factors?: FitFactorLike[] | null
  compact?: boolean
}) {
  const tone = fitTone(score)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone.bg} ${tone.text}`}>
      <span className="font-mono tabular-nums">{score === null ? '—' : score}</span>
      {compact ? null : <span className="font-normal opacity-70">{tone.label}</span>}
      {factors && factors.length > 0 ? <FactorTooltip score={score} factors={factors} /> : null}
    </span>
  )
}

function FactorTooltip({ score, factors }: { score: number | null; factors: FitFactorLike[] }) {
  return (
    <span className="group relative inline-flex">
      <svg viewBox="0 0 16 16" className="h-3 w-3 cursor-help opacity-50" aria-hidden>
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 7v4M8 5.2v.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <span className="pointer-events-none absolute left-1/2 top-full z-40 hidden w-72 -translate-x-1/2 pt-1.5 group-hover:block">
        <span className="block rounded-lg border border-stone-200 bg-white p-3 text-left text-[11px] font-normal leading-relaxed text-stone-600 shadow-lg">
          <span className="mb-1.5 block font-medium text-stone-900">为什么是 {score} 分</span>
          {factors.map((factor, index) =>
            typeof factor === 'string' ? (
              <span key={`s-${index}`} className="mb-1 block last:mb-0">
                {factor}
              </span>
            ) : (
              <span key={`${factor.key}-${index}`} className="mb-1 flex gap-2 last:mb-0">
                <span className="w-14 shrink-0 text-stone-400">{FACTOR_LABELS[factor.key] ?? factor.key}</span>
                <span className="shrink-0 font-mono text-stone-500">{Math.round(factor.score * 100)}</span>
                <span className="text-stone-600">{factor.evidence}</span>
              </span>
            ),
          )}
        </span>
      </span>
    </span>
  )
}

/** 列表里的横条，比纯数字更容易横向比较 */
export function FitBar({ score }: { score: number | null }) {
  const value = score ?? 0
  const color = score === null ? 'bg-stone-200' : value >= 75 ? 'bg-emerald-500' : value >= 60 ? 'bg-lime-500' : value >= 40 ? 'bg-amber-400' : 'bg-stone-300'
  return (
    <span className="inline-flex w-16 items-center gap-1.5" title={score === null ? '未评分' : `${score} 分`}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
    </span>
  )
}
