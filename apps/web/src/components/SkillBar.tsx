import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSkills } from '../lib/api'
import { qk } from '../lib/queries'
import { useT } from '../i18n'

/**
 * 侧栏底部的 Skill 状态：只给一句结论。
 *
 * 原来这里逐条列九个 Skill 的名字和版本，侧栏被撑得很长、信息量却几乎为零——
 * 「哪个 Skill 是旧版」是排查时才需要看的细节，去设置页看全量表格更合适。
 * 这里保留一个红点/绿点 + 一句话，只回答「Agent 那一侧是不是就绪」。
 */
export function SkillBar() {
  const t = useT()
  const skills = useQuery({ queryKey: qk.skills, queryFn: getSkills, staleTime: 60_000, refetchOnWindowFocus: true })

  const list = skills.data?.skills ?? []
  const broken = list.filter((item) => !item.compatible)

  if (skills.status === 'pending') {
    return <div className="text-[10px] text-stone-400">{t('Skill 检测中…')}</div>
  }
  if (skills.status === 'error' || list.length === 0) {
    return (
      <Link to="/settings" className="text-[10px] text-stone-400 hover:text-stone-600">
        {t('Skill 状态读不到 · 去设置')}
      </Link>
    )
  }

  return (
    <div
      data-testid="skill-bar"
      data-broken={broken.length}
      className="flex items-center justify-between gap-2 text-[10px]"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${broken.length > 0 ? 'bg-amber-400' : 'bg-emerald-500'}`} />
        <span className={`truncate ${broken.length > 0 ? 'text-amber-700' : 'text-stone-500'}`}>
          {broken.length > 0 ? t('{n} 个 Skill 未就绪', { n: broken.length }) : t('Skill 已就绪')}
        </span>
      </span>
      <Link to="/settings" className="shrink-0 text-stone-400 hover:text-stone-600">
        {broken.length > 0 ? t('去修复') : t('详情')}
      </Link>
    </div>
  )
}
