import { Plus, Trash2 } from 'lucide-react'
import { useResumeEditor } from '../context'

export function EducationEditor() {
  const { resume, addEducation, updateEducation, deleteEducation, setActiveEditor } = useResumeEditor()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    updateEducation(id, {
      id,
      school: formData.get('school') as string,
      degree: formData.get('degree') as string,
      major: formData.get('major') as string,
      period: formData.get('period') as string,
    })
  }

  return (
    <div className="space-y-4">
      {resume.educations.map((edu) => (
        <div key={edu.id} className="border rounded-lg p-3 bg-white">
          <form onSubmit={(e) => handleSubmit(e, edu.id)} className="space-y-2">
            <div>
              <label className="block text-xs text-stone-500 mb-1">学校名称</label>
              <input
                name="school"
                defaultValue={edu.school}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="请输入学校名称"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">学历</label>
              <input
                name="degree"
                defaultValue={edu.degree}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="如: 本科、硕士"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">专业</label>
              <input
                name="major"
                defaultValue={edu.major}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="请输入专业"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">时间段</label>
              <input
                name="period"
                defaultValue={edu.period}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="如: 2018.09 - 2022.06"
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
                onClick={() => deleteEducation(edu.id)}
                className="px-3 py-2 border border-red-300 text-red-500 rounded-lg text-sm hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      ))}
      <button
        onClick={addEducation}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg text-sm text-stone-500 hover:border-stone-900 hover:text-stone-900"
      >
        <Plus className="w-4 h-4" />
        添加教育经历
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
