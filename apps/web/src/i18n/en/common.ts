import type { Dict } from '..'

/**
 * 通用词汇：外壳、状态枚举、匹配度因子、投递渠道、确认框默认按钮。
 * 这些串在全站复用，译文只写在这里一份——别的片段不要再重复登记，
 * 否则 `check:i18n` 会报重复 key，且后者会静默覆盖前者。
 */
const dict: Dict = {
  // ——— 应用外壳 ———
  启动中: 'Starting',
  后台正在运行: 'Backend running',
  后台未运行: 'Backend offline',
  关闭导航: 'Close navigation',
  打开导航: 'Open navigation',
  求职流水线: 'Job search pipeline',
  '快速录入 / 搜索': 'Quick add / search',
  'AI 在 Agent 里跑，本应用不调用模型。': 'AI runs inside your agent. This app never calls a model.',
  '设置 · {tab}': 'Settings · {tab}',
  页面不存在: 'Page not found',
  '到 GitHub 看源码、提 issue，或点个 star': 'Source code, issues, and a star on GitHub',
  '如果对你有帮助，点个 star 吧': 'Star on GitHub',
  '加载编辑器…': 'Loading editor…',
  切换界面语言: 'Switch language',

  // ——— 投递状态（对应 core 的 STATUS_LABELS）———
  线索: 'Lead',
  待投: 'Queued',
  已投: 'Applied',
  筛选中: 'Screening',
  '笔试/作业': 'Assessment',
  面试中: 'Interview',
  '已发 offer': 'Offer',
  已接受: 'Accepted',
  被拒: 'Rejected',
  无回音: 'No reply',
  已撤回: 'Withdrawn',

  // ——— 匹配度档位与因子 ———
  未评分: 'Unscored',
  匹配: 'Match',
  可投: 'Apply',
  有缺口: 'Gaps',
  不建议: 'Skip',
  '为什么是 {score} 分': 'Why {score}',
  '{score} 分': '{score}',
  硬性条件: 'Must-haves',
  技术匹配: 'Tech stack',
  年限: 'Experience',
  领域: 'Domain',
  城市: 'Location',
  薪资: 'Salary',

  // ——— 投递渠道（对应 lib/channels.ts）———
  官网: 'Company site',
  内推: 'Referral',
  招聘平台: 'Job board',
  其他: 'Other',

  // ——— 通用动作 ———
  没有可选项: 'No options',
  取消: 'Cancel',
  确认: 'Confirm',
  条: 'items',
  样本: 'samples',
  已投递: 'Applied',
  '此操作不可撤销，请确认。': 'This cannot be undone. Please confirm.',
  '请确认是否继续。': 'Continue?',
}

export default dict
