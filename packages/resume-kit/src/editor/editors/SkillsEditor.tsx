import { Plus, Trash2 } from 'lucide-react'
import { useResumeEditor } from '../context'
import { SortableList } from '../SortableList'

export function SkillsEditor() {
  const { resume, addSkill, updateSkill, deleteSkill, reorderSkills, setActiveEditor } = useResumeEditor()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    updateSkill(id, {
      id,
      name: formData.get('name') as string,
      description: formData.get('description') as string,
    })
  }

  return (
    <div className="space-y-4">
      <SortableList
        items={resume.skills}
        onReorder={reorderSkills}
        renderItem={(skill) => (
          <div className="border rounded-lg p-3 bg-white">
            <form onSubmit={(e) => handleSubmit(e, skill.id)} className="space-y-2">
              <div>
                <label className="block text-xs text-stone-500 mb-1">技能名称</label>
                <input
                  name="name"
                  defaultValue={skill.name}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="如: React"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">技能描述</label>
                <input
                  name="description"
                  defaultValue={skill.description}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                  placeholder="如: 精通、熟练、掌握、了解"
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
                  onClick={() => deleteSkill(skill.id)}
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
        onClick={addSkill}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg text-sm text-stone-500 hover:border-stone-900 hover:text-stone-900"
      >
        <Plus className="w-4 h-4" />
        添加专业技能
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
