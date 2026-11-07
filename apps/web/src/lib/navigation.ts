/**
 * 导航的单一事实来源：侧栏、顶栏标题、⌘K 面板都从这里取，避免三处手写列表走偏。
 *
 * 「设置」现在是一个分区，不是单独一页：简历 / 公司库 / 题库 / 数据和 Agent 连接
 * 是它的四个二级 tab。
 * 刻意保留历史 URL（/settings、/resumes、/companies、/bank）——页面内深链
 * （/companies?focus=…、/bank?interviewId=…、/resumes/:id）、打印页入口与 E2E
 * 都指向这些路径；改层级只改导航，不给所有旧链接加一层重定向。
 */

export interface NavItem {
  to: string
  label: string
  /** 稳定英文标识，用于 data-testid，别拿中文当选择器 */
  key: string
  end?: boolean
  phase?: string
  /**
   * 「点这一项时去哪」。一级项自己有页面时省略（等于 `to`）；
   * 「设置」是一级分区、没有独立落地页，点进去应该落在默认的二级 tab 上。
   */
  enterTo?: string
}

/**
 * 设置分区的默认落地页（= 第一个二级 tab）。
 * 侧栏、⌘K、`g s` 三处都从这里取，改默认 tab 只改这一行。
 */
export const SETTINGS_ENTRY = '/resumes'

/**
 * 一级侧栏：业务流水线在前，「设置」作为配置/资料分区放在最后。
 * 投递助手不再是一级项：入口收进岗位库每行的「直接投递」弹窗。
 */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: '总览', key: 'dashboard', end: true },
  { to: '/pipeline', label: '投递看板', key: 'pipeline' },
  { to: '/jobs', label: '岗位库', key: 'jobs' },
  { to: '/interviews', label: '面试', key: 'interviews' },
  { to: '/offers', label: 'Offer 对比', key: 'offers' },
  // 点「设置」= 进这个分区，落在简历；`/settings` 仍是「数据和 Agent 连接」那一页的地址
  { to: '/settings', label: '设置', key: 'settings', end: true, enterTo: SETTINGS_ENTRY },
]

/**
 * 设置分区的二级 tab：三个「资料库」（简历 / 公司库 / 题库）+ 一页「数据和 Agent 连接」。
 * 原来的设置页改名后放到最后——它是配置与运维入口，不属于日常填资料的动线。
 * 顺序即呈现顺序：资料在前，连接在后；第一个同时也是点「设置」的落地页。
 */
export const SETTINGS_TABS: NavItem[] = [
  { to: SETTINGS_ENTRY, label: '简历', key: 'resumes', end: true },
  { to: '/companies', label: '公司库', key: 'companies', end: true },
  { to: '/bank', label: '题库', key: 'bank', end: true },
  { to: '/settings', label: '数据和 Agent 连接', key: 'settings', end: true },
]

/** 点导航项时的真实目的地：分区型一级项落到它的默认二级页 */
export function navEntryTo(item: NavItem): string {
  return item.enterTo ?? item.to
}

/** 是否落在设置分区的某个二级 tab 下；编辑器 /resumes/:id 也算「简历」 */
export function settingsTabFor(pathname: string): NavItem | undefined {
  return SETTINGS_TABS.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
}

/** 顶栏/侧栏用的一级归属：设置分区里的任何页面都算「设置」这一项 */
export function primaryNavFor(pathname: string): NavItem | undefined {
  if (settingsTabFor(pathname)) return PRIMARY_NAV.find((item) => item.key === 'settings')
  return PRIMARY_NAV.find((item) =>
    item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`),
  )
}
