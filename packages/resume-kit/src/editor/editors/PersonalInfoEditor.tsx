import { useRef, useState } from 'react'
import { useResumeEditor } from '../context'
import { AvatarCropper } from './AvatarCropper'

export function PersonalInfoEditor() {
  const { resume, updatePersonalInfo, setActiveEditor } = useResumeEditor()
  const { personalInfo } = resume
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 裁剪状态
  const [showCropper, setShowCropper] = useState(false)
  const [imageToCrop, setImageToCrop] = useState<string | null>(null)
  // 删除头像是不可撤销的（裁好的图没留副本），点一次只进入待确认态
  const [confirmRemoveAvatar, setConfirmRemoveAvatar] = useState(false)

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = () => {
        setImageToCrop(reader.result as string)
        setShowCropper(true)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleCropComplete = (croppedImage: string) => {
    updatePersonalInfo({
      ...personalInfo,
      avatar: croppedImage,
    })
    setShowCropper(false)
    setImageToCrop(null)
  }

  const handleCropCancel = () => {
    setShowCropper(false)
    setImageToCrop(null)
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    updatePersonalInfo({
      name: formData.get('name') as string,
      jobTitle: formData.get('jobTitle') as string,
      workYears: formData.get('workYears') as string,
      avatar: personalInfo.avatar,
      showAvatar: personalInfo.showAvatar,
      avatarShape: personalInfo.avatarShape,
    })
    setActiveEditor(null)
  }

  // 显示裁剪界面
  if (showCropper && imageToCrop) {
    return (
      <div>
        <h3 className="text-sm font-medium mb-4">调整头像</h3>
        <AvatarCropper
          image={imageToCrop}
          onCropComplete={handleCropComplete}
          onCancel={handleCropCancel}
          cropShape={personalInfo.avatarShape === 'circle' ? 'round' : 'rect'}
        />
      </div>
    )
  }

  // 显示编辑表单
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Avatar Upload */}
      <div className="flex flex-col items-center mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
        />
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-24 h-24 rounded-full overflow-hidden cursor-pointer border-2 border-dashed border-gray-300 hover:border-blue-500 flex items-center justify-center"
        >
          {personalInfo.avatar ? (
            <img
              src={personalInfo.avatar}
              alt="头像"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-gray-400 text-xs text-center">点击上传<br />头像</span>
          )}
        </div>
        {personalInfo.avatar &&
          (confirmRemoveAvatar ? (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-gray-500">删除后要重新上传，确定？</span>
              <button
                type="button"
                onClick={() => {
                  updatePersonalInfo({ ...personalInfo, avatar: '' })
                  setConfirmRemoveAvatar(false)
                }}
                className="text-red-600 hover:underline"
              >
                确认删除
              </button>
              <button type="button" onClick={() => setConfirmRemoveAvatar(false)} className="text-gray-500 hover:underline">
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemoveAvatar(true)}
              className="mt-2 text-xs text-red-500 hover:text-red-600"
            >
              删除头像
            </button>
          ))}
      </div>

      {/* Avatar Settings */}
      <div className="space-y-4 mb-4">
        {/* Show Avatar Toggle */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={personalInfo.showAvatar !== false}
              onChange={(e) => updatePersonalInfo({ ...personalInfo, showAvatar: e.target.checked })}
              className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600">在简历中显示头像</span>
          </label>
        </div>

        {/* Avatar Shape Selection */}
        <div>
          <label className="block text-xs text-gray-500 mb-2">头像形状</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="avatarShape"
                value="circle"
                checked={personalInfo.avatarShape === 'circle'}
                onChange={(e) => updatePersonalInfo({ ...personalInfo, avatarShape: e.target.value as 'circle' })}
                className="w-4 h-4 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">圆形</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="avatarShape"
                value="square"
                checked={personalInfo.avatarShape === 'square'}
                onChange={(e) => updatePersonalInfo({ ...personalInfo, avatarShape: e.target.value as 'square' })}
                className="w-4 h-4 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">方形</span>
            </label>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">姓名</label>
        <input
          name="name"
          defaultValue={personalInfo.name}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="请输入姓名"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">求职岗位</label>
        <input
          name="jobTitle"
          defaultValue={personalInfo.jobTitle}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="请输入求职岗位"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">工作年限</label>
        <input
          name="workYears"
          defaultValue={personalInfo.workYears}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="如: 3年"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => setActiveEditor(null)}
          className="flex-1 px-3 py-2 border rounded-lg text-sm hover:bg-gray-100"
        >
          取消
        </button>
        <button
          type="submit"
          className="flex-1 px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"
        >
          保存
        </button>
      </div>
    </form>
  )
}
