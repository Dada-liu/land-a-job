import type { Dict } from '..'

/** 总览首页与本周目标编辑器的文案 */
const dict: Dict = {
  // ——— 页面骨架与空状态 ———
  '读取中…': 'Loading…',
  '指标读取失败：{error}': 'Could not load metrics: {error}',
  '先看这周投了几份、有没有回音，再看今天该跟进谁。数字都是从你的记录当场算的，不是估的。':
    'See how many applications went out this week and whether anyone replied, then who to follow up with today. Every number is calculated live from your records, not estimated.',
  打开投递看板: 'Open pipeline',
  库还是空的: 'Your library is empty',
  '先建一个岗位：按 ⌘K 输入「字节 后端工程师 30-50k」就行；建好之后，这里的进度和待办会自动出现。':
    'Start with a job: press ⌘K and type something like “ByteDance Backend Engineer 30–50k”. Once it’s in, your progress and to-dos will show up here automatically.',
  去岗位库: 'Go to jobs',

  // ——— 北极星卡片 ———
  本周已投: 'Applied this week',
  本周新增岗位: 'New jobs this week',
  本周新增投递: 'New applications this week',
  响应中位数: 'Median response',
  无样本: 'No data yet',
  '{days} 天': '{days} days',
  '样本 {n}': '{n} samples',
  '{n} 条还在等': '{n} still waiting',
  '· {n} 条还在等': '· {n} still waiting',

  // ——— 转化漏斗 ———
  '样本 {n} 条已投': 'Based on {n} applications',
  转化漏斗: 'Conversion funnel',
  相对上一阶段: 'vs. previous stage',
  '算的是「走到过哪一步」：只要进过面试，就算过了一轮筛选，后来被拒也不会从漏斗里消失。':
    'Counts how far each application has ever reached. Once you’ve made it to an interview, that screening stage stays counted even if you’re later rejected.',

  // ——— 今日待办 ———
  '{n} 条待处理': '{n} to handle',
  今天没有该做的事: 'Nothing due today',
  今日待办: 'Today’s to-dos',
  '暂时没有要跟进的投递。这几种情况会出现在这里：投出去 7 天没回音、面完 3 天还没写复盘、Offer 还剩 2 天到期、同一个状态停留超过 30 天。':
    'No applications need follow-up right now. Items appear here when an application has gone 7 days without a reply, an interview was 3 days ago with no debrief written, an offer expires in 2 days, or an application has sat in the same stage for more than 30 days.',
  完成: 'Done',
  去复盘: 'Add debrief',
  去决策: 'Decide',
  '已处理，这条待办不会再出现': 'Done. This to-do won’t come up again.',
  '处理失败：{error}': 'Couldn’t complete: {error}',

  // ——— 接下来 ———
  接下来: 'Up next',
  待进行的面试: 'Upcoming interviews',
  '待答复的 Offer': 'Offers awaiting reply',
  在库岗位: 'Saved jobs',
  '按 ⌘K 可以用一句话记下岗位；你在别处改动数据，这里开着的页面会自动更新。':
    'Press ⌘K to save a job in one line. Changes made elsewhere update this page automatically.',

  // ——— 简历版本胜率 ———
  '每版至少 {n} 份样本才给转化率': 'At least {n} samples per version for a conversion rate',
  简历版本胜率: 'Resume performance',
  投递: 'Applied',
  进面: 'Interviews',
  进面率: 'Interview rate',
  样本不足: 'Not enough data',
  '还没有绑定简历的投递。投递时选一版简历，这里才能算「哪版更容易过筛」。':
    'No applications are linked to a resume yet. Pick a resume when you apply, and we can show which version gets through screening more often.',
  '「进面」算的是「走到过面试」：过了三面最后挂了也算进过——不然哪版简历好用会被低估。':
    '“Interviews” counts applications that ever reached an interview. Even if you were rejected after the final round, it still counts—otherwise a strong resume would look worse than it is.',

  // ——— 回音时长 ———
  回音一般要等多久: 'How long do replies usually take',
  中位数: 'Median',
  '90 分位': '90th percentile',
  还在等: 'Still waiting',
  '{n} 条': '{n}',

  // ——— 本周目标编辑器 ———
  '本周目标已改为 {n} 份': 'Weekly target updated to {n}',
  '目标没保存：{error}': 'Couldn’t save target: {error}',
  '目标要填 {min}–{max} 之间的整数': 'Enter a whole number from {min} to {max}',
  本周有效投递目标: 'Weekly application target',
  '/ 目标': '/ target',
  '每周目标 {target} 份，点一下可以改（{min}–{max}）':
    'Weekly target: {target}. Click to edit ({min}–{max})',

  // ——— 服务端产出的文案：北极星说明、漏斗提示、待办标题与详情 ———
  本周有效投递: 'Effective applications this week',
  '只算匹配度 60 分以上、并且绑了简历的投递。一周 8 份是「认真投」的下限，点数字可以改':
    'Only applications scoring 60+ on fit with a resume attached count. Eight a week is the floor for a serious search — click the number to change it.',
  '「回音时长」算的是：投出去之后，到第一次被推进到筛选或更后面，中间过了多少天':
    '“Time to reply” measures the days between applying and the first move to screening or beyond.',
  '还没动静的投递不算进样本，单独记成「等待中」——不然等得越久，数字反而越好看':
    'Applications still waiting are excluded from the sample and tracked separately as “waiting” — otherwise the longer you wait, the better the number would look.',
  '用中位数而不是平均数：一条拖了 60 天的样本就能把平均数拉歪':
    'Median, not mean: one 60-day outlier would skew the average.',
  催办: 'Follow up',
  '催一下 {company}': 'Follow up with {company}',
  '{job} 已投 {days} 天没有回音，建议发一封跟进邮件或换渠道触达。':
    '{job}: {days} days since you applied, no reply yet. Send a follow-up email or try another channel.',
}

export default dict
