import type { FC } from 'react'
import { ContactValue } from '../../editor/ContactValue'
import { LinkifiedText } from '../../editor/LinkifiedText'
import { ProjectName } from '../../editor/ProjectName'
import type { ResumeData } from '../../types/resume'

export const Template1: FC<{ data: ResumeData }> = ({ data }) => {
  return (
    <div className="w-full h-full bg-white p-8 font-sans">
      {/* 个人信息模块 */}
      <div className="flex items-center mb-6 pb-4 border-b border-gray-200">
        {/* 头像 */}
        {data.personalInfo.showAvatar !== false && (
          <div className="mr-6">
            {data.personalInfo.avatar ? (
              <img
                src={data.personalInfo.avatar}
                alt="头像"
                className={`w-20 h-20 object-cover ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full' : 'rounded-none'}`}
              />
            ) : (
              <div className={`w-20 h-20 flex items-center justify-center ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full bg-gray-200' : 'bg-gray-200'}`}>
                <span className="text-gray-400">照片</span>
              </div>
            )}
          </div>
        )}

        {/* 个人信息 */}
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 mb-1">
            {data.personalInfo.name || '姓名'}
          </h1>
          <p className="text-sm text-gray-600 mb-2">
            {data.personalInfo.jobTitle || '求职岗位'}
          </p>

          {/* 联系方式 */}
          <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
            {data.contacts.map((contact) => (
              <span key={contact.id} className="flex items-center">
                {contact.platform}: <ContactValue contact={contact} />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 工作经历模块 */}
      {data.experiences.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            工作经历
          </h2>
          {data.experiences.map((exp) => (
            <div key={exp.id} className="mb-4">
              <div className="flex justify-between items-start mb-1">
                <div>
                  <p className="font-medium text-gray-700 text-sm">
                    {exp.company || '公司名称'}
                  </p>
                  <p className="text-gray-500 text-xs">{exp.position}</p>
                </div>
                <span className="text-gray-400 text-xs">
                  {exp.period || '时间段'}
                </span>
              </div>
              {exp.responsibilities.length > 0 && (
                <ul className="list-disc list-inside text-gray-600 text-xs ml-2 mt-1">
                  {exp.responsibilities.map((resp, idx) => (
                    <li key={idx} className="mb-0.5"><LinkifiedText text={resp} /></li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {/* 项目经验模块 */}
      {data.projects.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            项目经验
          </h2>
          {data.projects.map((project) => (
            <div key={project.id} className="mb-4">
              <p className="font-medium text-gray-700 text-sm mb-1">
                项目名称：<ProjectName project={project} />
              </p>
              <p className="text-gray-600 text-xs mb-1 whitespace-pre-wrap">
                项目背景：<LinkifiedText text={project.description} />
              </p>
              <p className="text-gray-600 text-xs mb-1 whitespace-pre-wrap">
                项目产出：<LinkifiedText text={project.details} />
              </p>
              <p className="text-gray-600 text-xs flex flex-wrap items-center gap-1">
                <span className="shrink-0">技术栈：</span>
                {project.technologies
                  .filter((tech) => tech.trim())
                  .map((tech, index) => (
                    <span
                      key={`${tech}-${index}`}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600"
                    >
                      {tech}
                    </span>
                  ))}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* 教育背景模块 */}
      {data.educations.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            教育背景
          </h2>
          {data.educations.map((edu) => (
            <div key={edu.id} className="mb-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium text-gray-700 text-sm">
                    {edu.school || '学校'}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {edu.degree} | {edu.major}
                  </p>
                </div>
                {edu.period && (
                  <p className="text-gray-400 text-xs">{edu.period}</p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 技能特长模块 */}
      {data.skills.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            技能特长
          </h2>
          <div className="grid grid-cols-1 gap-y-2">
            {data.skills.map((skill) => (
              <div key={skill.id} className="flex items-start">
                <span className="font-medium text-gray-700 text-sm w-1/3">
                  {skill.name}
                </span>
                <span className="text-gray-600 text-xs flex-1">
                  {skill.description}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 自我评价模块 */}
      {data.selfIntroduction && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            自我评价
          </h2>
          <p className="text-gray-600 text-xs leading-relaxed indent-8">
            <LinkifiedText text={data.selfIntroduction} />
          </p>
        </section>
      )}
    </div>
  )
}
