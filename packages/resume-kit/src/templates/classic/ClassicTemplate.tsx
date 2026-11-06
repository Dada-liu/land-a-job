import type { FC } from 'react'
import { ContactValue } from '../../editor/ContactValue'
import { LinkifiedText } from '../../editor/LinkifiedText'
import { ProjectName } from '../../editor/ProjectName'
import type { ResumeData } from '../../types/resume'

export const ClassicTemplate: FC<{ data: ResumeData }> = ({ data }) => {
  return (
    <>
      {/* Left Column - 1/3 */}
      <div className="w-1/3 absolute top-4 bottom-0 left-0 rounded-r-lg flex flex-col">
        {/* Avatar */}
        {data.personalInfo.showAvatar !== false && (
          <div className="mb-12 flex justify-center relative">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-10 bg-gray-200" />
            <div className="relative">
              {data.personalInfo.avatar ? (
                <img
                  src={data.personalInfo.avatar}
                  alt="头像"
                  className={`w-36 h-36 object-cover mb-4 ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full' : 'rounded-lg'}`}
                />
              ) : (
                <div className={`w-36 h-36 flex items-center justify-center mb-4 outline-2 outline-gray-300 ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full bg-gray-200' : 'rounded-lg bg-gray-200'}`}>
                  <span className="text-gray-400 text-2xl">照片</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Gray background for rest */}
        <div
          className={`bg-gray-100 p-4 pt-10 grow ${data.personalInfo.showAvatar !== false ? '-mt-2' : 'mt-0'}`}
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
          {data.educations.length > 0 && (
            <section className="mb-16">
              <h2 className="text-base font-semibold text-gray-800 mb-2">
                教育经历
              </h2>
              {data.educations.map((edu) => (
                <div key={edu.id} className="mb-3">
                  <p className="font-medium text-gray-700 text-xs">
                    {edu.school || '学校'}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {edu.degree} | {edu.major}
                  </p>
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
          <h1 className="text-2xl font-bold text-gray-800 mb-1">
            {data.personalInfo.name || '姓名'}
          </h1>
          <div className="flex">
            <p className="text-gray-600 mb-1 flex-1">
              {data.personalInfo.jobTitle || '求职岗位'}
            </p>
            {data.personalInfo.workYears && (
              <p className="text-gray-500 text-xs flex-1">
                工作年限: {data.personalInfo.workYears}
              </p>
            )}
          </div>
        </div>

        {/* Experience */}
        {data.experiences.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              工作经历
            </h2>
            {data.experiences.map((exp) => (
              <div key={exp.id} className="mb-4">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <p className="font-medium text-gray-700 text-xs">
                      {exp.company || '公司名称'}
                    </p>
                    <p className="text-gray-500 text-xs">{exp.position}</p>
                  </div>
                  <span className="text-gray-400 text-xs">
                    {exp.period || '时间段'}
                  </span>
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
        {data.skills.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              专业技能
            </h2>
            <div className="flex flex-wrap gap-2">
              {data.skills.map((skill) => (
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
        {data.projects.length > 0 && (
          <section className="mb-6">
            <h2 className="text-base font-semibold text-gray-800 mb-2">
              项目介绍
            </h2>
            {data.projects.map((project) => (
              <div key={project.id} className="mb-4">
                <p className="font-medium text-gray-700 text-xs mb-1">
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
      </div>
    </>
  )
}
