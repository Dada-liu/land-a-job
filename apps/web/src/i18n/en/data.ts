import type { Dict } from '..'

/** 公司库、题库、设置页（含 Skill 注册表在界面上显示的名称） */
const dict: Dict = {
  // ——— 公司库 ———
  '想去的公司都放这里，岗位挂在公司下面。同一个名字不会悄悄建出两家，这样投递记录才能都归到一家公司身上。':
    'Every company you care about lives here, with its jobs nested underneath. The same name never silently becomes two companies, so all your applications stay attached to one record.',
  新建公司: 'New company',
  '行业 / 规模': 'Industry / size',
  优先级: 'Priority',
  投递入口: 'Apply link',
  '搜索名称 / 行业 / 城市': 'Search name / industry / city',

  // ——— 题库 ———
  '每次被问到的题都记在这，并标上它考的是你哪段经历。面完当天就写答案和评分——隔三天基本只剩下「好像问过」。':
    'Log every question you were asked and tag which part of your experience it probed. Write the answer and score it the same day — three days later you’ll barely remember being asked.',
  轮次: 'Round',
  全部轮次: 'All rounds',
  类别: 'Category',
  全部类别: 'All categories',
  全部来源: 'All sources',
  共: 'Total',
  题: 'questions',
  已答: 'Answered',
  已写改进: 'Improvements noted',
  平均分: 'Avg score',
  题库还是空的: 'Question bank is empty',
  '让 Agent 用 job-prep Skill 按 JD 和简历出一套题（会写回这台电脑），面完再来这页补答案和评分。':
    'Have your agent run the job-prep skill against the JD and your resume to generate a question set (it writes back to this machine), then come here after the interview to add answers and scores.',
  手动加题: 'Add question',

  // ——— 设置：数据 ———
  '数据只存在这台电脑上：备份是本地文件，导出是一个 JSON。想让 AI 帮你搜岗、改简历、投递，就在 WorkBuddy / Kimi 这类 Agent 里装好下面的 Skill，它通过 MCP 读写这些数据——这个应用自己不会去调模型。':
    'Your data stays on this machine: backups are local files, exports are a single JSON. To let AI find jobs, tailor resumes, or apply, install the skills below in an agent such as WorkBuddy or Kimi — it reads and writes through MCP. This app itself never calls a model.',
  立即备份: 'Back up now',
  快照: 'Snapshots',
  '保留最近 {n} 份': 'Keep the latest {n}',
  '{n} 分钟前': '{n} min ago',
  '备份是数据库自己导出的完整副本，不是直接拷文件——边写边拷可能拷到一半，那种文件打不开。':
    'A backup is a full copy exported by the database itself, not a raw file copy — copying while writes are in flight can produce a truncated, unopenable file.',
  全库导出: 'Export whole database',
  '{n} 行': '{n} rows',
  导出的是: 'Exports',
  所有原始字段: 'all raw fields',
  '（包括已经删掉的记录和每次操作是谁做的），换电脑时用它把数据搬过去。比页面上能看到的更全。':
    ' (including deleted records and who made each change). Use it to move your data to another machine — it contains more than the UI shows.',
  '下载 JSON': 'Download JSON',

  // ——— 设置：Skill ———
  'Skill 安装状态': 'Skill install status',
  '{n}/{m} 就绪': '{n}/{m} ready',
  就绪: 'Ready',
  '这些是给 Agent 看的说明书：装了 Skill，Agent 才知道怎么按规矩读写这里的数据。':
    'These are instruction manuals for your agent. With a skill installed, it knows the rules for reading and writing your data.',
  仓库目录: 'Repo directory',
  复制安装命令: 'Copy install command',
  '第一次装？把安装说明交给你的 Agent：': 'First time? Hand the install guide to your agent:',
  安装说明: 'Install guide',
  版本: 'Version',
  安装到: 'Installed to',
  写接口: 'Write tools',
  '版本以仓库里的 SKILL.md 为准；改了却没重新装，这里会显示「未就绪」。Agent 写回的每条数据都带着版本号，对不上服务端就不收。':
    'Versions follow SKILL.md in the repo. Edit it without reinstalling and this page shows “not ready”. Every record your agent writes carries a version, and the server rejects mismatches.',

  // ——— Skill 注册表的中文标题（core/skills.ts 产出）———
  'JD 采集与补录': 'JD collection',
  求职推进: 'Job hunt',
  简历定制: 'Resume tailoring',
  面试准备: 'Interview prep',
  'Offer 决策': 'Offer decision',
  批量搜岗: 'Batch job search',
  批量定制并进入待投: 'Batch tailoring to queue',
  浏览器辅助投递: 'Browser-assisted applying',
  投递状态巡检: 'Application status sync',
}

export default dict
