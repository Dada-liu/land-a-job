import { Plus, Trash2 } from 'lucide-react'
import { useResumeEditor } from '../context'
import { SortableList } from '../SortableList'

export function ProjectsEditor() {
  const { resume, addProject, updateProject, deleteProject, reorderProjects, setActiveEditor } = useResumeEditor()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const technologies = (formData.get('technologies') as string)
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t)
    updateProject(id, {
      id,
      name: formData.get('name') as string,
      period: formData.get('period') as string,
      role: formData.get('role') as string,
      description: formData.get('description') as string,
      details: formData.get('details') as string,
      technologies,
      url: (formData.get('url') as string).trim() || undefined,
    })
  }

  return (
    <div className="space-y-4">
      <SortableList
        items={resume.projects}
        onReorder={reorderProjects}
        renderItem={(project) => (
          <div className="border rounded-lg p-3 bg-white">
            <form onSubmit={(e) => handleSubmit(e, project.id)} className="space-y-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1">项目名称</label>
                <input
                  name="name"
                  defaultValue={project.name}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="请输入项目名称"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">链接（可选）</label>
                <input
                  name="url"
                  defaultValue={project.url ?? ''}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="如: https://github.com/xxx"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">时间段</label>
                  <input
                    name="period"
                    defaultValue={project.period}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                    placeholder="如: 2024.01 - 2024.03"
                  />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">担任角色</label>
                  <input
                    name="role"
                    defaultValue={project.role}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                    placeholder="如: 前端负责人"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">项目背景</label>
                <input
                  name="description"
                  defaultValue={project.description}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="请输入项目背景"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">项目产出</label>
                <textarea
                  name="details"
                  defaultValue={project.details}
                  rows={2}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 resize-none"
                  placeholder="请输入项目产出"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  技术栈（用逗号分隔）
                </label>
                <input
                  name="technologies"
                  defaultValue={project.technologies.join(', ')}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="如: React, TypeScript, Node.js"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 px-3 py-2 bg-stone-900 text-white rounded-lg text-sm hover:bg-stone-800"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => deleteProject(project.id)}
                  className="px-3 py-2 border border-red-300 text-red-500 rounded-lg text-sm hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        )}
      />
      <button
        onClick={addProject}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg text-sm text-stone-500 hover:border-stone-900 hover:text-stone-900"
      >
        <Plus className="w-4 h-4" />
        添加项目介绍
      </button>
      <button
        onClick={() => setActiveEditor(null)}
        className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-100 hover:text-stone-900"
      >
        完成
      </button>
    </div>
  )
}
