import { useResumeEditor } from '../context'

export function SummaryEditor() {
  const { resume, updateSelfIntroduction, setActiveEditor } = useResumeEditor()
  const { selfIntroduction } = resume

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    updateSelfIntroduction(formData.get('intro') as string)
    setActiveEditor(null)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs text-stone-500 mb-1">自我介绍</label>
        <textarea
          name="intro"
          defaultValue={selfIntroduction}
          rows={4}
          className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 resize-none"
          placeholder="请输入自我介绍"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => setActiveEditor(null)}
          className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-100 hover:text-stone-900"
        >
          取消
        </button>
        <button
          type="submit"
          className="flex-1 px-3 py-2 bg-stone-900 text-white rounded-lg text-sm hover:bg-stone-800"
        >
          保存
        </button>
      </div>
    </form>
  )
}
