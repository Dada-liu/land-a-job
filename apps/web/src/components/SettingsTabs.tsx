import { NavLink, useLocation } from 'react-router-dom'
import { SETTINGS_TABS, settingsTabFor } from '../lib/navigation'

/**
 * 设置分区的二级 tab，四个页面共用一条。
 *
 * 高亮按路径归属算（而不是 NavLink 自己的 isActive）：这样从简历列表点进
 * /resumes/:id 编辑器时，回来仍落在「简历」上，不会出现两个 tab 都亮。
 *
 * 关于滚动条：`overflow-x-auto` 会把另一轴的计算值也变成 auto（CSS 规定
 * visible + auto 的组合按 auto 处理），所以以前用 `-mb-px` 把激活态的下划线
 * 压到容器边框上时，那一像素的溢出就变成了一条竖向滚动条。现在改成
 * `shadow-[inset_0_-2px]` 画下划线——box-shadow 不参与布局也不产生溢出，
 * 边框仍连续，竖向滚动条也就没了。
 */
export function SettingsTabs() {
  const location = useLocation()
  const active = settingsTabFor(location.pathname)

  return (
    <nav
      data-testid="settings-tabs"
      aria-label="设置二级导航"
      className="mb-5 flex gap-5 overflow-x-auto border-b border-stone-200"
    >
      {SETTINGS_TABS.map((item) => {
        const isActive = active?.key === item.key
        return (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.end}
            data-testid={`settings-tab-${item.key}`}
            aria-current={isActive ? 'page' : undefined}
            className={[
              'shrink-0 whitespace-nowrap px-0.5 pb-2 text-[13px] transition-colors',
              isActive
                ? 'font-medium text-stone-900 shadow-[inset_0_-2px_0_0_var(--color-stone-900)]'
                : 'text-stone-500 hover:text-stone-800',
            ].join(' ')}
          >
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
