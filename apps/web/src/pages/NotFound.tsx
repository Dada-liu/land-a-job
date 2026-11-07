import { Link } from 'react-router-dom'
import { Card, PageHeader } from '../components/ui'
import { useT } from '../i18n'

/** 404：地址打错或页面下线时落到这里，给一条能走的路，而不是讲实现计划 */
export default function NotFound() {
  const t = useT()
  return (
    <div>
      <PageHeader title={t('这个页面不存在')} description={t('地址可能打错了，也可能这个页面已经下线。')} />
      <Card className="p-6">
        <p className="text-xs leading-relaxed text-stone-500">
          {t('用左边导航换个页面，或者按 ⌘K 直接搜岗位、公司和你自己的简历。')}
        </p>
        <div className="mt-3 flex gap-2 text-xs">
          <Link to="/" className="rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-800">
            {t('回到总览')}
          </Link>
          <Link
            to="/jobs"
            className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-stone-700 hover:bg-stone-50"
          >
            {t('去岗位库')}
          </Link>
        </div>
      </Card>
    </div>
  )
}
