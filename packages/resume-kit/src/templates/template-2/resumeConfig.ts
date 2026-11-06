import { EDITOR_MODULES } from '../../editor/modules'
import type { ResumeData } from '../../types/resume'

export const template2DefaultResume: ResumeData = {
  personalInfo: {
    name: '张三',
    jobTitle: '软件工程师',
    workYears: '5年',
    avatarShape: 'square',
  },
  selfIntroduction: '我是一名拥有5年软件开发经验的软件工程师，专注于后端开发和系统架构设计。我熟练掌握多种编程语言和技术栈，具有良好的团队协作能力和解决问题的能力。我热爱技术，不断学习和探索新的技术领域，致力于开发高质量、可维护的软件产品。',
  experiences: [
    {
      id: 'default-exp-1',
      period: '2023.03 - 至今',
      company: '某科技公司',
      position: '高级软件工程师',
      responsibilities: [
        '负责公司核心产品的后端开发和维护',
        '设计和实现高可用、高性能的系统架构',
        '参与需求分析和技术方案评审',
        '指导和培训初级开发工程师',
        '优化系统性能，提高代码质量',
      ],
    },
    {
      id: 'default-exp-2',
      period: '2021.02 - 2023.02',
      company: '某互联网公司',
      position: '软件工程师',
      responsibilities: [
        '负责电商平台的后端开发',
        '参与系统架构设计和优化',
        '开发和维护API接口',
        '解决生产环境中的问题',
        '参与代码审查和技术分享',
      ],
    },
  ],
  educations: [
    {
      id: 'default-edu-1',
      school: '某大学',
      degree: '本科',
      major: '计算机科学与技术',
      period: '2015.09 - 2019.06',
    },
  ],
  skills: [
    { id: 'default-skill-1', name: '后端开发', description: '熟练掌握Java、Python、Go等编程语言' },
    { id: 'default-skill-2', name: '数据库', description: '熟练使用MySQL、PostgreSQL、MongoDB等数据库' },
    { id: 'default-skill-3', name: '框架', description: '熟悉Spring Boot、Django、Flask等框架' },
    { id: 'default-skill-4', name: '云服务', description: '熟悉AWS、阿里云等云服务平台' },
    { id: 'default-skill-5', name: '团队协作', description: '有良好的沟通和团队协作能力' },
  ],
  projects: [
    {
      id: 'default-proj-1',
      name: '电商平台后端系统',
      period: '2021.05 - 2022.12',
      role: '后端开发工程师',
      description: '负责电商平台的用户管理、订单管理、支付系统等模块的开发',
      details: '使用Spring Boot + MySQL + Redis开发，支持高并发、高可用',
      technologies: ['Java', 'Spring Boot', 'MySQL', 'Redis'],
    },
    {
      id: 'default-proj-2',
      name: '数据分析平台',
      period: '2020.03 - 2021.01',
      role: '数据工程师',
      description: '负责数据分析平台的架构设计和开发',
      details: '使用Python + Spark + Kafka开发，支持实时数据分析',
      technologies: ['Python', 'Spark', 'Kafka', 'Hadoop'],
    },
  ],
  contacts: [
    { id: 'default-contact-1', platform: '电话', value: '138****0001' },
    { id: 'default-contact-2', platform: '邮箱', value: 'zhangsan@email.com' },
    { id: 'default-contact-3', platform: '微信', value: 'zhangsan_wechat' },
    { id: 'default-contact-4', platform: 'Github', value: 'github.com/zhangsan' },
  ],
}

/** 三套模板共用同一组编辑器：改一处，三套模板同时生效 */
export const template2EditorModules = EDITOR_MODULES
