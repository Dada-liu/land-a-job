import { Plus, Trash2 } from 'lucide-react'
import { useResumeEditor } from '../context'

export function ContactEditor() {
  const { resume, addContact, updateContact, deleteContact, setActiveEditor } = useResumeEditor()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>, id: string) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    updateContact(id, {
      id,
      platform: formData.get('platform') as string,
      value: formData.get('value') as string,
      url: (formData.get('url') as string).trim() || undefined,
    })
  }

  return (
    <div className="space-y-4">
      {resume.contacts.map((contact) => (
        <div key={contact.id} className="border rounded-lg p-3 bg-white">
          <form onSubmit={(e) => handleSubmit(e, contact.id)} className="space-y-2">
            <div>
              <label className="block text-xs text-stone-500 mb-1">渠道</label>
              <input
                name="platform"
                defaultValue={contact.platform}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="如: Email, Phone, GitHub"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">联系方式</label>
              <input
                name="value"
                defaultValue={contact.value}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="请输入联系方式"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1">链接（可选）</label>
              <input
                name="url"
                defaultValue={contact.url ?? ''}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:border-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900"
                placeholder="留空则按内容自动识别"
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
                onClick={() => deleteContact(contact.id)}
                className="px-3 py-2 border border-red-300 text-red-500 rounded-lg text-sm hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      ))}
      <button
        onClick={addContact}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-stone-300 rounded-lg text-sm text-stone-500 hover:border-stone-900 hover:text-stone-900"
      >
        <Plus className="w-4 h-4" />
        添加联系方式
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
