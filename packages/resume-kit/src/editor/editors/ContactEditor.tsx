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
              <label className="block text-xs text-gray-500 mb-1">渠道</label>
              <input
                name="platform"
                defaultValue={contact.platform}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="如: Email, Phone, GitHub"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">联系方式</label>
              <input
                name="value"
                defaultValue={contact.value}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="请输入联系方式"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">链接（可选）</label>
              <input
                name="url"
                defaultValue={contact.url ?? ''}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="留空则按内容自动识别"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
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
        className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-500 hover:text-blue-500"
      >
        <Plus className="w-4 h-4" />
        添加联系方式
      </button>
      <button
        onClick={() => setActiveEditor(null)}
        className="w-full px-3 py-2 border rounded-lg text-sm hover:bg-gray-100"
      >
        完成
      </button>
    </div>
  )
}
