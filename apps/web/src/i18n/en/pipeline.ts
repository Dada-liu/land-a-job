import type { Dict } from '..'

/** 投递看板、卡片、投递详情抽屉、直接投递/进入待投弹窗 */
const dict: Dict = {
  '把卡片拖到右边那一列，就算往下推进了一步。跳步（比如从待投直接到 Offer）会被拦下，并告诉你这一步能去哪。':
    'Drag a card one column to the right to move it forward. Skipping stages (say, Queued straight to Offer) is blocked, with a note on where it can actually go.',
  显示已结束: 'Show closed',
  '显示已结束 ({n})': 'Show closed ({n})',
  隐藏已结束: 'Hide closed',
  岗位匹配度: 'Job fit',
  '匹配度 —': 'Fit —',
  '匹配度 {score}': 'Fit {score}',
  有简历: 'Resume linked',
  已关联简历: 'Resume linked',
  缺简历: 'No resume',
  '未关联简历，不算有效投递': 'No resume linked — this does not count as an effective application',
  今天: 'Today',
  拖到这里: 'Drop here',
  未知岗位: 'Unknown role',

  // ——— 投递详情抽屉 ———
  关联简历: 'Linked resume',
  来自: 'From',
  '已投 · 已停留 {n} 天': 'Applied · {n} days in stage',
  投递于: 'Applied on',
  '推进到…': 'Move to…',
  确认推进: 'Confirm move',
  只能选下一步能去的状态: 'Only valid next stages are listed',
  追加备注: 'Add note',
  记录: 'Save',
  时间线: 'Timeline',
  '只往后追加，不会覆盖之前记的': 'Appends only; earlier notes are never overwritten',
  状态变更: 'Status change',
  创建: 'Created',
  选择目标状态: 'Choose a target stage',
  '例如：HR 说下周安排二面': 'e.g. recruiter scheduled a second round next week',
}

export default dict
