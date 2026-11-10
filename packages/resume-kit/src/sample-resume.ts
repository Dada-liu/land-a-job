import { normalizeResumeData } from './model'
import type { ResumeData } from './types/resume'

/**
 * 新建简历时填进去的示例内容。
 *
 * 目的只有一个：让人一打开编辑器就看得出这套模板分了哪几块、每块大概什么密度。
 * 所以刻意写得很短——每块一到两条，够撑起结构，又不至于让人删半天。
 * 姓名、公司、邮箱都是明显的示例值（张三 / 某互联网公司 / example.com），
 * 导出前一眼就能看出还没换成自己的。
 *
 * 为什么放在 resume-kit 而不是 core：core 刻意不碰 resume 的字段结构
 * （见 core/schema/resume.ts 的 zResumeData），简历正文长什么样只有这里知道。
 */
const SAMPLE = {
  personalInfo: {
    name: '张三',
    jobTitle: '前端工程师',
    workYears: '3 年',
    city: '上海',
    avatarShape: 'circle',
  },
  selfIntroduction: '3 年前端开发经验，主要做 React 方向的业务系统与内部工具。',
  contacts: [
    { platform: '电话', value: '138****8888' },
    { platform: '邮箱', value: 'zhangsan@example.com' },
    // 带 url 的联系方式会渲染成蓝色链接，顺便让人看到「配了链接」和「纯文本」的区别
    { platform: 'Github', value: 'github.com/zhangsan', url: 'https://github.com/zhangsan' },
  ],
  experiences: [
    {
      period: '2022.03 - 至今',
      company: '某互联网公司',
      position: '前端工程师',
      responsibilities: [
        '负责核心业务系统的前端开发，独立交付 20+ 页面',
        '牵头搭建组件库，重复页面的开发时间缩短约一半',
      ],
    },
  ],
  educations: [
    {
      period: '2018.09 - 2022.06',
      school: '某某大学',
      degree: '本科',
      major: '计算机科学与技术',
    },
  ],
  skills: [
    { name: 'React', description: '熟练，能独立设计组件与状态管理方案' },
    { name: 'TypeScript', description: '熟练，习惯用类型约束接口与数据流' },
    { name: 'Node.js', description: '能写中小型服务与构建脚本' },
  ],
  projects: [
    {
      name: '在线简历编辑器',
      period: '2024.01 - 2024.03',
      role: '前端负责人',
      description: '面向求职者的所见即所得简历编辑器',
      details: '负责前端架构与分页预览，支持实时编辑与 PDF 导出',
      technologies: ['React', 'TypeScript', 'Tailwind CSS'],
    },
  ],
}

/**
 * 返回一份全新的示例数据。
 *
 * 走 normalizeResumeData 而不是直接把常量丢出去：每次生成新的条目 id，
 * 两份简历不会共用同一批 id；字段名写错也会在单测里立刻暴露（区块变空）。
 */
export function sampleResumeData(): ResumeData {
  return normalizeResumeData(SAMPLE)
}
