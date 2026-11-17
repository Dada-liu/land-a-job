import type { Dict } from '..'

/** 简历库：母版 / 定制版 / 模板说明 */
const dict: Dict = {
  '母版放通用内容，投某个岗位前复制一份改一改。投递时选了哪一版，之后就能看出「哪版简历换来了面试」。':
    'Keep general content in the master, then duplicate and tailor a copy per role. Choosing a version when you apply is what later tells you which resume actually got interviews.',
  新建简历: 'New resume',
  '先填一份示例内容，看清每块长什么样':
    'Start with sample content, so you can see what each section looks like',
  '全部 {n}': 'All {n}',
  'AI 改过 {n}': 'AI-edited {n}',
  '人工 {n}': 'Manual {n}',
  '标着 AI 名字的版本是 Agent 改的，改了什么都能对比出来':
    'Versions tagged with an AI skill name were edited by your agent. You can diff every change.',
  母版: 'Master',
  默认: 'Default',
  现代简约: 'Modern',
  传统表格: 'Classic table',
  经典模板: 'Classic template',
  '经典模板（自由编辑）': 'Classic (edit on page)',
  '纸面可直接点字修改；区块右下角可加减空行':
    'Click any text on the paper to edit it; hover a section bottom-right to add or remove blank lines',
  // 区块末尾空行（撑开间距）的悬停控件
  减少一行空行: 'Remove one blank line',
  增加一行空行: 'Add one blank line',
  '左侧浅灰侧栏放头像与联系方式，右侧主栏排经历，分栏清晰，适合互联网与设计类岗位':
    'Grey sidebar for photo and contact details, main column for experience. Fits internet and design roles.',
  '单栏通栏，顶部头像加横向联系方式，标题醒目、层次清楚，大多数岗位都能用':
    'Single full-width column with a photo and one horizontal contact row up top. Clear headings, works for most roles.',
  '顶部信息表格，模块紧凑规整，适合国企和传统行业':
    'Info table at the top with compact, tidy sections. Fits state-owned enterprises and traditional industries.',
  '版式同「经典模板」，区别是文字直接在纸面上改：点哪句改哪句，边看排版边抠字':
    'Same layout as Classic, but you edit the text right on the page — click a line, change it, and watch the layout react.',
  更新于: 'Updated',
  '设为默认简历': 'Set as default resume',
  复制一份: 'Duplicate',
  复制简历名: 'Copy resume name',
  打开简历: 'Open resume',
  已复制简历名: 'Resume name copied',
  '复制失败，请手动选择复制': 'Copy failed — please select and copy it manually',
  定制版: 'Tailored',
  '展开 {n} 个定制版': 'Show {n} tailored versions',
  收起定制版: 'Hide tailored versions',
  没有符合条件的简历: 'No resumes match this filter',
  '点「全部」看看全部简历；也可能是这些版本来自另一种来源（AI 改过 / 人工）。':
    'Switch to All to see every resume — these versions may come from the other origin (AI-edited / manual).',
  对比母版: 'Compare with master',
  编辑: 'Edit',
  删除: 'Delete',
  // 删除成功的全局提示（标题是运行时拼进去的，靠占位符模式匹配）
  '已删除简历「{title}」': 'Deleted resume “{title}”',
}

export default dict
