import { EDITOR_MODULES } from '../../editor/modules'
import type { ResumeData } from '../../types/resume'

export const template1DefaultResume: ResumeData = {
  personalInfo: {
    name: '胡小豆',
    jobTitle: '高级前端工程师',
    workYears: '5年',
    avatarShape: 'square',
  },
  selfIntroduction: '我是一名热爱编程的前端工程师，拥有5年的开发经验。我专注于使用现代化技术栈构建高质量的用户界面。我对响应式设计、性能优化和用户体验有深入的理解。在我的职业生涯中，我参与了多个大型项目的开发，从移动应用到企业级系统。我喜欢学习新技术，并将其应用到实际项目中。我相信通过不断学习和实践，我能够为团队带来更多的价值。',
  experiences: [
    {
      id: 'default-exp-1',
      period: '2022.07 - 至今',
      company: '某互联网公司',
      position: '高级前端工程师',
      responsibilities: [
        '负责公司核心产品的前端开发和维护工作',
        '主导前端技术栈的选型和架构设计',
        '参与团队代码审查和技术分享',
        '优化现有系统的性能和用户体验',
        '与产品经理和设计师紧密合作，确保产品质量',
      ],
    },
    {
      id: 'default-exp-2',
      period: '2020.03 - 2022.06',
      company: '某科技有限公司',
      position: '前端工程师',
      responsibilities: [
        '负责公司内部管理系统的前端开发',
        '参与项目需求分析和技术方案设计',
        '编写高质量的代码和单元测试',
        '协助解决生产环境的技术问题',
      ],
    },
  ],
  educations: [
    {
      id: 'default-edu-1',
      school: '某知名大学',
      degree: '本科',
      major: '计算机科学与技术',
      period: '2015.09 - 2019.06',
    },
  ],
  skills: [
    { id: 'default-skill-1', name: '前端开发', description: '熟练掌握HTML、CSS、JavaScript等前端技术' },
    { id: 'default-skill-2', name: 'React框架', description: '深入理解React及其生态系统' },
    { id: 'default-skill-3', name: 'TypeScript', description: '熟练使用TypeScript进行开发' },
    { id: 'default-skill-4', name: '移动开发', description: '有响应式设计和移动应用开发经验' },
    { id: 'default-skill-5', name: '团队协作', description: '有良好的沟通和团队协作能力' },
  ],
  projects: [
    {
      id: 'default-proj-1',
      name: '在线简历编辑器',
      period: '2024.01 - 2024.03',
      role: '前端负责人',
      description: '一个所见即所得的简历编辑器，支持实时预览和PDF导出',
      details: '使用 React + TypeScript 开发，支持实时预览、PDF 导出等功能',
      technologies: ['React', 'TypeScript', 'Tailwind CSS', 'React PDF'],
    },
    {
      id: 'default-proj-2',
      name: '电商管理后台',
      period: '2023.05 - 2023.12',
      role: '前端开发工程师',
      description: '企业级电商管理后台系统，提供商品管理、订单管理、数据分析等功能',
      details: '使用 Vue 3 + Element Plus 开发，支持多租户、权限管理等功能',
      technologies: ['Vue 3', 'Element Plus', 'Pinia', 'Axios'],
    },
  ],
  contacts: [
    { id: 'default-contact-1', platform: '电话', value: '188****0001' },
    { id: 'default-contact-2', platform: '邮箱', value: 'huxiaodou@email.com' },
    { id: 'default-contact-3', platform: '微信', value: 'huxiaodou_wechat' },
    { id: 'default-contact-4', platform: 'Github', value: 'github.com/huxiaodou' },
  ],
}

/** 三套模板共用同一组编辑器：改一处，三套模板同时生效 */
export const template1EditorModules = EDITOR_MODULES
