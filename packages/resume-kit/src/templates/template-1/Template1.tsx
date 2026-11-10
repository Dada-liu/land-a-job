import type { FC } from 'react'
import { ContactValue } from '../../editor/ContactValue'
import { LinkifiedText } from '../../editor/LinkifiedText'
import { ProjectName } from '../../editor/ProjectName'
import type { ResumeData } from '../../types/resume'
import { hasContent } from '../../utils/blank'

export const Template1: FC<{ data: ResumeData }> = ({ data }) => {
  // 只渲染真有内容的条目：空条目留给编辑器，不该出现在简历上
  const experiences = data.experiences.filter((exp) =>
    hasContent(exp.period, exp.company, exp.position, exp.responsibilities),
  )
  const educations = data.educations.filter((edu) =>
    hasContent(edu.period, edu.school, edu.degree, edu.major),
  )
  const skills = data.skills.filter((skill) => hasContent(skill.name, skill.description))
  const projects = data.projects.filter((project) =>
    hasContent(project.name, project.description, project.details, project.technologies),
  )

  return (
    <div className="w-full h-full bg-white p-8 font-sans">
      {/* 个人信息模块 */}
      <div className="flex items-center mb-6 pb-4 border-b border-gray-200">
        {/* 头像：没上传就不占位，免得导出的 PDF 上印一块写着「照片」的灰块 */}
        {data.personalInfo.showAvatar !== false && data.personalInfo.avatar && (
          <div className="mr-6">
            <img
              src={data.personalInfo.avatar}
              alt="头像"
              className={`w-20 h-20 object-cover ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full' : 'rounded-none'}`}
            />
          </div>
        )}

        {/* 个人信息 */}
        <div className="flex-1">
          {data.personalInfo.name && (
            <h1 className="text-xl font-bold text-gray-800 mb-1">{data.personalInfo.name}</h1>
          )}
          {data.personalInfo.jobTitle && (
            <p className="text-sm text-gray-600 mb-2">{data.personalInfo.jobTitle}</p>
          )}

          {/* 联系方式 */}
          <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
            {data.personalInfo.city && (
              <span className="flex items-center">意向城市: {data.personalInfo.city}</span>
            )}
            {data.contacts.map((contact) => (
              <span key={contact.id} className="flex items-center">
                {contact.platform}: <ContactValue contact={contact} />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 工作经历模块 */}
      {experiences.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            工作经历
          </h2>
          {experiences.map((exp) => (
            <div key={exp.id} className="mb-4">
              <div className="flex justify-between items-start mb-1">
                <div>
                  {exp.company && (
                    <p className="font-medium text-gray-700 text-sm">{exp.company}</p>
                  )}
                  {exp.position && <p className="text-gray-500 text-xs">{exp.position}</p>}
                </div>
                {exp.period && <span className="text-gray-400 text-xs">{exp.period}</span>}
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
      {projects.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            项目经验
          </h2>
          {projects.map((project) => (
            <div key={project.id} className="mb-4">
              {project.name && (
                <p className="font-medium text-gray-700 text-sm mb-1">
                  项目名称：<ProjectName project={project} />
                </p>
              )}
              {project.description && (
                <p className="text-gray-600 text-xs mb-1 whitespace-pre-wrap">
                  项目背景：<LinkifiedText text={project.description} />
                </p>
              )}
              {project.details && (
                <p className="text-gray-600 text-xs mb-1 whitespace-pre-wrap">
                  项目产出：<LinkifiedText text={project.details} />
                </p>
              )}
              {project.technologies.filter((tech) => tech.trim()).length > 0 && (
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
              )}
            </div>
          ))}
        </section>
      )}

      {/* 教育背景模块 */}
      {educations.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            教育背景
          </h2>
          {educations.map((edu) => (
            <div key={edu.id} className="mb-3">
              <div className="flex justify-between items-start">
                <div>
                  {edu.school && (
                    <p className="font-medium text-gray-700 text-sm">{edu.school}</p>
                  )}
                  {[edu.degree, edu.major].filter(Boolean).length > 0 && (
                    <p className="text-gray-500 text-xs">
                      {[edu.degree, edu.major].filter(Boolean).join(' | ')}
                    </p>
                  )}
                </div>
                {edu.period && (
                  <p className="text-gray-400 text-xs">{edu.period}</p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 技能特长模块：与现代简约模板的「专业技能」保持同一套展示（灰色标签流） */}
      {skills.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">
            技能特长
          </h2>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill.id}
                className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs"
              >
                {skill.name}
                {skill.description && ` - ${skill.description}`}
              </span>
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
