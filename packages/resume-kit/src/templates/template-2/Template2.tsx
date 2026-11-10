import type { FC } from 'react'
import { ContactValue } from '../../editor/ContactValue'
import { LinkifiedText } from '../../editor/LinkifiedText'
import { ProjectName } from '../../editor/ProjectName'
import type { ResumeData } from '../../types/resume'
import { hasContent } from '../../utils/blank'

export const Template2: FC<{ data: ResumeData }> = ({ data }) => {
  const phoneContact = data.contacts.find((contact) => contact.platform === '电话')
  const emailContact = data.contacts.find((contact) => contact.platform === '邮箱')
  // 电话/邮箱之外的渠道（微信、GitHub……）以前在这个模板里会被直接丢掉，现在按行补在表格末尾
  const otherContacts = data.contacts.filter(
    (contact) => contact !== phoneContact && contact !== emailContact,
  )
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
    <div className="w-full h-full bg-white p-8 font-sans">
      {/* 个人信息模块 */}
      <div className="flex justify-between mb-6">
        {/* 个人信息表格：只渲染真的有数据的行，不用占位文案撑版面 */}
        <div className="flex-1">
          <table className="text-sm w-full">
            <tbody>
              {data.personalInfo.name && (
                <tr>
                  <td className="py-1 font-medium text-gray-800 w-1/3">姓名</td>
                  <td className="py-1 text-gray-600">{data.personalInfo.name}</td>
                </tr>
              )}
              {phoneContact && (
                <tr>
                  <td className="py-1 font-medium text-gray-800 w-1/3">电话</td>
                  <td className="py-1 text-gray-600">
                    <ContactValue contact={phoneContact} />
                  </td>
                </tr>
              )}
              {emailContact && (
                <tr>
                  <td className="py-1 font-medium text-gray-800 w-1/3">邮箱</td>
                  <td className="py-1 text-gray-600">
                    <ContactValue contact={emailContact} />
                  </td>
                </tr>
              )}
              {data.personalInfo.city && (
                <tr>
                  <td className="py-1 font-medium text-gray-800 w-1/3">意向城市</td>
                  <td className="py-1 text-gray-600">{data.personalInfo.city}</td>
                </tr>
              )}
              {otherContacts.map((contact) => (
                <tr key={contact.id}>
                  <td className="py-1 font-medium text-gray-800 w-1/3">{contact.platform}</td>
                  <td className="py-1 text-gray-600">
                    <ContactValue contact={contact} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 头像：没上传就不占位 */}
        {data.personalInfo.showAvatar !== false && data.personalInfo.avatar && (
          <div className="ml-6">
            <img
              src={data.personalInfo.avatar}
              alt="头像"
              className={`w-42 h-50 object-cover ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full' : 'rounded-none'}`}
            />
          </div>
        )}
      </div>

      {/* 教育背景模块 */}
      {educations.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-bold text-gray-800 mb-2 pb-1 border-b border-gray-300">
            教育背景
          </h2>
          {educations.map((edu) => (
            <div key={edu.id} className="mb-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  {edu.period && <p className="font-medium text-gray-700 text-sm">{edu.period}</p>}
                  {edu.school && <p className="text-gray-600 text-sm">{edu.school}</p>}
                  {[edu.degree, edu.major].filter(Boolean).length > 0 && (
                    <p className="text-gray-500 text-xs">
                      {[edu.degree, edu.major].filter(Boolean).join(' | ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 工作经历模块 */}
      {experiences.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-bold text-gray-800 mb-2 pb-1 border-b border-gray-300">
            工作经历
          </h2>
          {experiences.map((exp) => (
            <div key={exp.id} className="mb-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  {exp.period && <p className="font-medium text-gray-700 text-sm">{exp.period}</p>}
                  {exp.company && <p className="text-gray-600 text-sm">{exp.company}</p>}
                  {exp.position && <p className="text-gray-500 text-xs">{exp.position}</p>}
                </div>
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

      {/* 项目经历模块 */}
      {projects.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-bold text-gray-800 mb-2 pb-1 border-b border-gray-300">
            项目经历
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

      {/* 专业技能模块 */}
      {skills.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-bold text-gray-800 mb-2 pb-1 border-b border-gray-300">
            专业技能
          </h2>
          <div className="grid grid-cols-1 gap-y-1">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-start">
                <span className="font-medium text-gray-700 text-sm flex-1">
                  {skill.name}
                </span>
                <span className="text-gray-600 text-xs">
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
          <h2 className="text-base font-bold text-gray-800 mb-2 pb-1 border-b border-gray-300">
            自我评价
          </h2>
          <p className="text-gray-600 text-xs leading-relaxed indent-4">
            <LinkifiedText text={data.selfIntroduction} />
          </p>
        </section>
      )}
    </div>
  )
}
