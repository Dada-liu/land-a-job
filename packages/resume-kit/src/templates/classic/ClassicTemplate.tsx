import type { FC } from 'react'
import { ContactValue } from '../../editor/ContactValue'
import { LinkifiedText } from '../../editor/LinkifiedText'
import { ProjectName } from '../../editor/ProjectName'
import type { ResumeData } from '../../types/resume'
import { hasContent } from '../../utils/blank'

export const ClassicTemplate: FC<{ data: ResumeData }> = ({ data }) => {
  // 没上传头像就不渲染整块（那条灰底只是给照片做衬底），左侧灰面板也不上移去补位
  const showAvatar = data.personalInfo.showAvatar !== false && Boolean(data.personalInfo.avatar)
  // 只渲染真有内容的条目：空条目留给编辑器，不该出现在简历上
  const educations = data.educations.filter((edu) =>
    hasContent(edu.period, edu.school, edu.degree, edu.major),
  )
  const experiences = data.experiences.filter((exp) =>
    hasContent(exp.period, exp.company, exp.position, exp.responsibilities),
  )
  const skills = data.skills.filter((skill) => hasContent(skill.name, skill.description))
  const projects = data.projects.filter((project) =>
    hasContent(project.name, project.description, project.details, project.technologies),
  )

  return (
    <>
      {/* Left Column - 1/3 */}
      <div className="w-1/3 absolute top-4 bottom-0 left-0 rounded-r-lg flex flex-col">
        {/* Avatar */}
        {showAvatar && (
          <div className="mb-12 flex justify-center relative">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 bg-gray-200" />
            <div className="relative">
              <img
                src={data.personalInfo.avatar}
                alt="头像"
                className={`w-36 h-36 object-cover mb-4 ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full' : 'rounded-lg'}`}
              />
            </div>
          </div>
        )}

        {/* Gray background for rest */}
        <div
          className={`bg-gray-100 p-4 pt-10 grow ${showAvatar ? '-mt-2' : 'mt-0'}`}
        >
          {/* Self Introduction */}
          {data.selfIntroduction && (
            <section className="mb-16">
              <h2 className="text-base font-semibold text-gray-800 mb-2">
                自我介绍
              </h2>
              <p className="text-gray-600 text-xs leading-relaxed whitespace-pre-wrap">
                <LinkifiedText text={data.selfIntroduction} />
              </p>
            </section>
          )}

          {/* Education */}
          {educations.length > 0 && (
            <section className="mb-16">
              <h2 className="text-base font-semibold text-gray-800 mb-2">
                教育经历
              </h2>
              {educations.map((edu) => (
                <div key={edu.id} className="mb-3">
                  {edu.school && (
                    <p className="font-medium text-gray-700 text-xs">{edu.school}</p>
                  )}
                  {[edu.degree, edu.major].filter(Boolean).length > 0 && (
                    <p className="text-gray-500 text-xs">
                      {[edu.degree, edu.major].filter(Boolean).join(' | ')}
                    </p>
                  )}
                  {edu.period && (
                    <p className="text-gray-400 text-xs">{edu.period}</p>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Contact */}
          {data.contacts.length > 0 && (
            <section className="mb-16">
              <h2 className="text-base font-semibold text-gray-800 mb-2">
                联系方式
              </h2>
              {data.contacts.map((contact) => (
                <p key={contact.id} className="text-gray-600 text-xs mb-1">
                  {contact.platform}: <ContactValue contact={contact} />
                </p>
              ))}
            </section>
          )}
        </div>
      </div>

      {/* Right Column - 2/3 */}
      <div className="w-2/3 absolute top-6 bottom-0 right-0 pl-8 pr-8">
        {/* Name and Title */}
        <div className="mb-6">
          {data.personalInfo.name && (
            <h1 className="text-2xl font-bold text-gray-800 mb-1">{data.personalInfo.name}</h1>
          )}
          {data.personalInfo.jobTitle && (
            <p className="text-gray-600 mb-1">{data.personalInfo.jobTitle}</p>
          )}
          {(data.personalInfo.workYears || data.personalInfo.city) && (
            <div className="flex flex-wrap gap-x-6 text-gray-500 text-xs">
              {data.personalInfo.workYears && (
                <p>工作年限: {data.personalInfo.workYears}</p>
              )}
              {data.personalInfo.city && <p>意向城市: {data.personalInfo.city}</p>}
            </div>
          )}
        </div>

        {/* Experience */}
        {experiences.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              工作经历
            </h2>
            {experiences.map((exp) => (
              <div key={exp.id} className="mb-4">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    {exp.company && (
                      <p className="font-medium text-gray-700 text-xs">{exp.company}</p>
                    )}
                    {exp.position && <p className="text-gray-500 text-xs">{exp.position}</p>}
                  </div>
                  {exp.period && <span className="text-gray-400 text-xs">{exp.period}</span>}
                </div>
                {exp.responsibilities.length > 0 && (
                  <ul className="list-disc list-inside text-gray-600 text-xs">
                    {exp.responsibilities.map((resp, idx) => (
                      <li key={idx}><LinkifiedText text={resp} /></li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              专业技能
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

        {/* Projects */}
        {projects.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              项目介绍
            </h2>
            {projects.map((project) => (
              <div key={project.id} className="mb-4">
                {project.name && (
                  <p className="font-medium text-gray-700 text-xs mb-1">
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
      </div>
    </>
  )
}
