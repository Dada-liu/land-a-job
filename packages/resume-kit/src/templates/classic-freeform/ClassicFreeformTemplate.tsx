import type { FC } from 'react'
import { Minus, Plus } from 'lucide-react'
import { ContactValue } from '../../editor/ContactValue'
import { EditableText } from '../../freeform/EditableText'
import { useFreeformEdit } from '../../freeform/context'
import { MAX_SECTION_SPACING } from '../../model'
import type {
  Education,
  Experience,
  PersonalInfo,
  Project,
  ResumeData,
  SectionSpacingKey,
  Skill,
} from '../../types/resume'
import { hasContent } from '../../utils/blank'

/**
 * 「经典模板（自由编辑）」：版式与「经典模板」一致，区别是每段文字都能在纸面上直接改。
 *
 * 刻意做成**独立模板**而不是给 Template1 加开关：
 * 1. 两套模板的排版诉求会各自演化（自由编辑版允许某行为空、需要可点击的占位高度），
 *    塞进同一个组件会让「经典模板」的渲染被编辑态影响；
 * 2. 纸上编辑依赖 freeform/ 那套上下文，把它引进 Template1 等于让所有模板都带上编辑依赖。
 *
 * 数据仍然是那一份结构化 ResumeData：纸上改完写回同样的字段，所以左侧面板、
 * 匹配度、定制版对比、PDF 导出全都不需要知道「这次是在哪改的」。
 */
export const ClassicFreeformTemplate: FC<{ data: ResumeData }> = ({ data }) => {
  const edit = useFreeformEdit()

  /** 编辑态下即使是空字段也要渲染出来，否则删干净了就再也点不回去（这是独立模板的主要理由） */
  const show = (value: string | undefined): boolean => Boolean(edit) || Boolean(value?.trim())

  const setPersonal = (part: Partial<PersonalInfo>) =>
    edit?.update((prev) => ({ ...prev, personalInfo: { ...prev.personalInfo, ...part } }))

  const setExperience = (id: string, part: Partial<Experience>) =>
    edit?.update((prev) => ({
      ...prev,
      experiences: prev.experiences.map((item) => (item.id === id ? { ...item, ...part } : item)),
    }))

  const setBullet = (id: string, index: number, text: string) =>
    edit?.update((prev) => ({
      ...prev,
      experiences: prev.experiences.map((item) =>
        item.id === id
          ? { ...item, responsibilities: item.responsibilities.map((line, i) => (i === index ? text : line)) }
          : item,
      ),
    }))

  const setEducation = (id: string, part: Partial<Education>) =>
    edit?.update((prev) => ({
      ...prev,
      educations: prev.educations.map((item) => (item.id === id ? { ...item, ...part } : item)),
    }))

  const setSkill = (id: string, part: Partial<Skill>) =>
    edit?.update((prev) => ({
      ...prev,
      skills: prev.skills.map((item) => (item.id === id ? { ...item, ...part } : item)),
    }))

  /** 技能标签在纸面上是「名称 - 说明」一行字，改完按第一个「 - 」拆回两个字段 */
  const setSkillText = (skill: Skill, text: string) => {
    const [name, ...rest] = text.split(/\s+-\s+/)
    setSkill(skill.id, { name: (name ?? '').trim(), description: rest.join(' - ').trim() })
  }

  const setProject = (id: string, part: Partial<Project>) =>
    edit?.update((prev) => ({
      ...prev,
      projects: prev.projects.map((item) => (item.id === id ? { ...item, ...part } : item)),
    }))

  const setTechnology = (project: Project, index: number, text: string) =>
    setProject(project.id, {
      technologies: project.technologies.map((tech, i) => (i === index ? text : tech)),
    })

  /* --------------------------- 区块末尾的空行 --------------------------- */
  // 空行就是「间距」：一行 = 一个正文行高，加在区块内容的最后面，把下一个区块推下去

  const spacingOf = (section: SectionSpacingKey): number => data.sectionSpacing?.[section] ?? 0

  const changeSpacing = (section: SectionSpacingKey, delta: number) =>
    edit?.update((prev) => {
      const current = prev.sectionSpacing ?? {}
      const next = Math.max(0, Math.min(MAX_SECTION_SPACING, (current[section] ?? 0) + delta))
      return { ...prev, sectionSpacing: { ...current, [section]: next } }
    })

  /** 区块末尾的空行。打印/导出也照渲染——它本来就该出现在 PDF 里 */
  const Spacers = ({ section }: { section: SectionSpacingKey }) => {
    const count = spacingOf(section)
    if (count <= 0) return null
    return (
      <div aria-hidden>
        {Array.from({ length: count }, (_, index) => (
          // text-xs 自带 1rem 行高：一行空行 = 一个正文行高，跟正常段落一致
          <p key={index} className="text-xs">
            &nbsp;
          </p>
        ))}
      </div>
    )
  }

  /**
   * 悬停区块时出现在右下角的「− / ＋」。
   *
   * 绝对定位在区块的下边距里：它一占行高，纸面高度就变了，
   * 编辑态的分页会跟导出的 PDF 对不上（用户看到 2 页、下载只有 1 页）。
   * 也刻意只放图标、不写「N 行空行」：分页是按文本实际高度量的，
   * 多一串字就等于多算几十像素，同样会把页顶出去。
   */
  const SpacerControl = ({ section }: { section: SectionSpacingKey }) => {
    if (!edit) return null
    const count = spacingOf(section)
    return (
      <div
        data-freeform-spacing={section}
        className="absolute -bottom-4 right-0 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100"
      >
        <button
          type="button"
          aria-label="减少一行空行"
          title="减少一行空行"
          disabled={count === 0}
          onClick={() => changeSpacing(section, -1)}
          className="rounded p-0.5 text-stone-300 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
        >
          <Minus className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="增加一行空行"
          title="增加一行空行"
          disabled={count >= MAX_SECTION_SPACING}
          onClick={() => changeSpacing(section, 1)}
          className="rounded p-0.5 text-stone-300 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    )
  }

  // 非编辑态只渲染真有内容的条目（与「经典模板」一致）：空条目只是还没填，不该出现在简历上。
  // 编辑态全部渲染——否则刚插入的空行当场就消失，等于点了个寂寞。
  const experiences = edit
    ? data.experiences
    : data.experiences.filter((exp) => hasContent(exp.period, exp.company, exp.position, exp.responsibilities))
  const educations = edit
    ? data.educations
    : data.educations.filter((edu) => hasContent(edu.period, edu.school, edu.degree, edu.major))
  const skills = edit ? data.skills : data.skills.filter((skill) => hasContent(skill.name, skill.description))
  const projects = edit
    ? data.projects
    : data.projects.filter((project) =>
        hasContent(project.name, project.description, project.details, project.technologies),
      )

  const showAvatar = data.personalInfo.showAvatar !== false && Boolean(data.personalInfo.avatar)

  return (
    <div className="w-full h-full bg-white p-8 font-sans">
      {/* 个人信息模块 */}
      <div className="group/section relative mb-6">
        <div className="flex items-center pb-4 border-b border-gray-200">
          {showAvatar && (
            <div className="mr-6">
              <img
                src={data.personalInfo.avatar}
                alt="头像"
                className={`w-20 h-20 object-cover ${data.personalInfo.avatarShape === 'circle' ? 'rounded-full' : 'rounded-none'}`}
              />
            </div>
          )}

          <div className="flex-1">
            {show(data.personalInfo.name) && (
              <EditableText
                as="h1"
                field="personal.name"
                label="姓名"
                value={data.personalInfo.name}
                onChange={(text) => setPersonal({ name: text })}
                className="text-xl font-bold text-gray-800 mb-1"
              />
            )}
            {show(data.personalInfo.jobTitle) && (
              <EditableText
                as="p"
                field="personal.jobTitle"
                label="求职岗位"
                value={data.personalInfo.jobTitle}
                onChange={(text) => setPersonal({ jobTitle: text })}
                className="text-sm text-gray-600 mb-2"
              />
            )}

            {/* 联系方式：值本身是可点的链接（mailto / 网址），在纸上改成普通文字会毁掉链接，所以保持只读 */}
            <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
              {data.personalInfo.city && (
                // gap-1 而不是行内空格：flex 容器里的空白文本节点会被吞掉，冒号后面会贴住城市名
                <span className="flex items-center gap-1">
                  意向城市:
                  <EditableText
                    as="span"
                    field="personal.city"
                    label="意向城市"
                    value={data.personalInfo.city}
                    onChange={(text) => setPersonal({ city: text })}
                  />
                </span>
              )}
              {data.contacts.map((contact) => (
                <span key={contact.id} className="flex items-center">
                  {contact.platform}: <ContactValue contact={contact} />
                </span>
              ))}
            </div>
          </div>
        </div>
        <SpacerControl section="personal" />
      </div>
      <Spacers section="personal" />

      {/* 工作经历模块 */}
      {(edit || experiences.length > 0) && (
        <section className="group/section relative mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">工作经历</h2>
          {experiences.map((exp) => (
            <div key={exp.id} className="mb-4">
              <div className="flex justify-between items-start mb-1">
                <div className="flex-1">
                  {show(exp.company) && (
                    <EditableText
                      as="p"
                      field={`experience.${exp.id}.company`}
                      label="公司"
                      value={exp.company}
                      onChange={(text) => setExperience(exp.id, { company: text })}
                      className="font-medium text-gray-700 text-sm"
                    />
                  )}
                  {show(exp.position) && (
                    <EditableText
                      as="p"
                      field={`experience.${exp.id}.position`}
                      label="职位"
                      value={exp.position}
                      onChange={(text) => setExperience(exp.id, { position: text })}
                      className="text-gray-500 text-xs"
                    />
                  )}
                </div>
                {show(exp.period) && (
                  <EditableText
                    as="span"
                    field={`experience.${exp.id}.period`}
                    label="起止时间"
                    value={exp.period}
                    onChange={(text) => setExperience(exp.id, { period: text })}
                    className="shrink-0 text-gray-400 text-xs"
                  />
                )}
              </div>
              {exp.responsibilities.length > 0 && (
                <ul className="list-disc list-inside text-gray-600 text-xs ml-2 mt-1">
                  {exp.responsibilities.map((resp, index) => (
                    <li key={index} className="mb-0.5">
                      <EditableText
                        as="span"
                        field={`experience.${exp.id}.bullet.${index}`}
                        label="工作内容"
                        value={resp}
                        onChange={(text) => setBullet(exp.id, index, text)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <SpacerControl section="experiences" />
        </section>
      )}
      <Spacers section="experiences" />

      {/* 项目经验模块 */}
      {(edit || projects.length > 0) && (
        <section className="group/section relative mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">项目经验</h2>
          {projects.map((project) => (
            <div key={project.id} className="mb-4">
              {show(project.name) && (
                <p className="font-medium text-gray-700 text-sm mb-1">
                  项目名称：
                  <EditableText
                    as="span"
                    field={`project.${project.id}.name`}
                    label="项目名称"
                    value={project.name}
                    onChange={(text) => setProject(project.id, { name: text })}
                  />
                </p>
              )}
              {show(project.description) && (
                <p className="text-gray-600 text-xs mb-1 whitespace-pre-wrap">
                  项目背景：
                  <EditableText
                    as="span"
                    field={`project.${project.id}.description`}
                    label="项目背景"
                    value={project.description}
                    onChange={(text) => setProject(project.id, { description: text })}
                    multiline
                  />
                </p>
              )}
              {show(project.details) && (
                <p className="text-gray-600 text-xs mb-1 whitespace-pre-wrap">
                  项目产出：
                  <EditableText
                    as="span"
                    field={`project.${project.id}.details`}
                    label="项目产出"
                    value={project.details}
                    onChange={(text) => setProject(project.id, { details: text })}
                    multiline
                  />
                </p>
              )}
              {project.technologies.filter((tech) => tech.trim()).length > 0 && (
                <p className="text-gray-600 text-xs flex flex-wrap items-center gap-1">
                  <span className="shrink-0">技术栈：</span>
                  {project.technologies
                    .filter((tech) => tech.trim())
                    .map((tech, index) => (
                      <span key={`${tech}-${index}`} className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                        <EditableText
                          as="span"
                          field={`project.${project.id}.tech.${index}`}
                          label="技术栈"
                          value={tech}
                          onChange={(text) => setTechnology(project, index, text)}
                        />
                      </span>
                    ))}
                </p>
              )}
            </div>
          ))}
          <SpacerControl section="projects" />
        </section>
      )}
      <Spacers section="projects" />

      {/* 教育背景模块 */}
      {(edit || educations.length > 0) && (
        <section className="group/section relative mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">教育背景</h2>
          {educations.map((edu) => (
            <div key={edu.id} className="mb-3">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  {show(edu.school) && (
                    <EditableText
                      as="p"
                      field={`education.${edu.id}.school`}
                      label="学校"
                      value={edu.school}
                      onChange={(text) => setEducation(edu.id, { school: text })}
                      className="font-medium text-gray-700 text-sm"
                    />
                  )}
                  {(edit || edu.degree || edu.major) && (
                    <p className="text-gray-500 text-xs">
                      <EditableText
                        as="span"
                        field={`education.${edu.id}.degree`}
                        label="学历"
                        value={edu.degree}
                        onChange={(text) => setEducation(edu.id, { degree: text })}
                      />
                      {edu.degree && edu.major ? ' | ' : null}
                      <EditableText
                        as="span"
                        field={`education.${edu.id}.major`}
                        label="专业"
                        value={edu.major}
                        onChange={(text) => setEducation(edu.id, { major: text })}
                      />
                    </p>
                  )}
                </div>
                {show(edu.period) && (
                  <EditableText
                    as="span"
                    field={`education.${edu.id}.period`}
                    label="起止时间"
                    value={edu.period ?? ''}
                    onChange={(text) => setEducation(edu.id, { period: text })}
                    className="shrink-0 text-gray-400 text-xs"
                  />
                )}
              </div>
            </div>
          ))}
          <SpacerControl section="educations" />
        </section>
      )}
      <Spacers section="educations" />

      {/* 技能特长模块：与「经典模板」一致的灰色标签流，标签文字也能改 */}
      {(edit || skills.length > 0) && (
        <section className="group/section relative mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">技能特长</h2>
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span key={skill.id} className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs">
                <EditableText
                  as="span"
                  field={`skill.${skill.id}`}
                  label="技能"
                  value={skill.description ? `${skill.name} - ${skill.description}` : skill.name}
                  onChange={(text) => setSkillText(skill, text)}
                />
              </span>
            ))}
          </div>
          <SpacerControl section="skills" />
        </section>
      )}
      <Spacers section="skills" />

      {/* 自我评价模块 */}
      {(edit || show(data.selfIntroduction)) && (
        <section className="group/section relative mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-200">自我评价</h2>
          <p className="text-gray-600 text-xs leading-relaxed indent-8">
            <EditableText
              as="span"
              field="selfIntroduction"
              label="自我评价"
              value={data.selfIntroduction}
              onChange={(text) => edit?.update((prev) => ({ ...prev, selfIntroduction: text }))}
              multiline
            />
          </p>
          <SpacerControl section="summary" />
        </section>
      )}
      <Spacers section="summary" />
    </div>
  )
}
