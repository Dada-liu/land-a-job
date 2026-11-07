import { Plus, Trash2 } from 'lucide-react'
import { useResumeEditor } from '../context'
import { SortableList } from '../SortableList'

export function ExperienceEditor() {
  const { resume, addExperience, updateExperience, deleteExperience, reorderExperiences, setActiveEditor } = useResumeEditor()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const responsibilities = (formData.get('responsibilities') as string)
      .split('\n')
      .filter((r) => r.trim())
    updateExperience(id, {
      id,
      period: formData.get('period') as string,
      company: formData.get('company') as string,
      position: formData.get('position') as string,
      responsibilities,
    })
  }

  return (
    <div className="space-y-4">
      <SortableList
        items={resume.experiences}
        onReorder={reorderExperiences}
        renderItem={(exp) => (
          <div className="border rounded-lg p-3 bg-white">
            <form onSubmit={(e) => handleSubmit(e, exp.id)} className="space-y-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1">时间段</label>
                <input
                  name="period"
                  defaultValue={exp.period}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="如: 2022.03 - 至今"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">公司名称</label>
                <input
                  name="company"
                  defaultValue={exp.company}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="请输入公司名称"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">任职职位</label>
                <input
                  name="position"
                  defaultValue={exp.position}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="请输入职位"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">
                  工作内容（每行一条）
                </label>
                <textarea
                  name="responsibilities"
                  defaultValue={exp.responsibilities.join('\n')}
                  rows={3}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 resize-none"
                  placeholder="每行一条工作内容"
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
                  onClick={() => deleteExperience(exp.id)}
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
        onClick={addExperience}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg text-sm text-stone-500 hover:border-stone-900 hover:text-stone-900"
      >
        <Plus className="w-4 h-4" />
        添加工作经历
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
