import type { Dict } from '..'

/**
 * 导航。字典 key 用 navigation.ts 里的中文 label——那里是导航文案的单一事实来源，
 * 侧栏、顶栏标题、⌘K 都从同一份 label 取，译文自然也只有一份。
 */
const dict: Dict = {
  总览: 'Overview',
  投递看板: 'Pipeline',
  岗位库: 'Jobs',
  面试: 'Interviews',
  'Offer 对比': 'Offers',
  设置: 'Settings',
  简历: 'Resumes',
  公司库: 'Companies',
  题库: 'Question bank',
  '数据和 Agent 连接': 'Data & Agent',
}

export default dict
