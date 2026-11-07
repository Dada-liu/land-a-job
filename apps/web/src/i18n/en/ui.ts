import type { Dict } from '..'

/**
 * 通用 UI 部件：⌘K 命令面板、Skill 状态条、设置二级 tab、404、接口自举失败提示。
 * 导航词（简历 / 公司库 / 题库 / 数据和 Agent 连接 / 设置）在 nav.ts，不在这里重复登记。
 */
const dict: Dict = {
  // ——— ⌘K 命令面板 ———
  前往: 'Go',
  设置下的二级页: 'Settings page',
  '输入「公司 岗位 30-50k https://…」直接建岗位，或搜索':
    'Type “Company Role 30-50k https://…” to add a job, or search',
  '新建岗位：{company} · {title}': 'New job: {company} · {title}',
  '带 JD 链接': 'With JD link',
  未知公司: 'Unknown company',
  '岗位 · 匹配度 {score}': 'Job · Fit {score}',
  '公司 · {n} 个岗位': 'Company · {n} job(s)',
  关闭: 'Close',
  '识别为：公司': 'Detected: company',
  '· 岗位': '· role',
  '没有匹配。试试「字节 后端工程师 30-50k」，会直接建好岗位。':
    'No matches. Try “ByteDance backend engineer 30-50k” and the job gets created for you.',
  '↑↓ 选择 · Enter 执行 · Esc 关闭': '↑↓ to move · Enter to run · Esc to close',
  '不联网、不调模型，就在本地按规则识别': 'Runs locally by rules — no network, no model calls',
  '已建岗位：{company} · {title}': 'Job created: {company} · {title}',
  '已建岗位：{company} · {title}，正在抓取 JD': 'Job created: {company} · {title} — fetching the JD',
  '岗位已建，但 JD 没抓到：{error}；可在详情页粘贴正文':
    'Job created, but the JD could not be fetched: {error}. Paste the text on the job page instead.',
  '创建失败：{error}': 'Create failed: {error}',

  // ——— 侧栏 Skill 状态条 ———
  'Skill 检测中…': 'Checking skills…',
  'Skill 状态读不到 · 去设置': 'Skill status unavailable · Open settings',
  'Skill 已就绪': 'Skills ready',
  '{n} 个 Skill 未就绪': '{n} skill(s) not ready',
  去修复: 'Fix',
  详情: 'Details',

  // ——— 设置二级 tab ———
  设置二级导航: 'Settings navigation',

  // ——— 404 ———
  这个页面不存在: 'This page doesn’t exist',
  '地址可能打错了，也可能这个页面已经下线。': 'The address may be mistyped, or this page no longer exists.',
  '用左边导航换个页面，或者按 ⌘K 直接搜岗位、公司和你自己的简历。':
    'Switch pages from the sidebar, or press ⌘K to search jobs, companies, and your resumes.',
  回到总览: 'Back to overview',

  // ——— 接口自举失败（lib/api.ts，会直接显示在页面上）———
  '无法获取本机令牌（HTTP {status}）：本地服务未就绪，确认 npm run dev 的 server 已启动（日志 data/logs/server.log）':
    'Could not get the local token (HTTP {status}): the local server isn’t ready. Make sure the `npm run dev` server is running (see data/logs/server.log).',
  'bootstrap 未返回令牌': 'Bootstrap returned no token',
}

export default dict
