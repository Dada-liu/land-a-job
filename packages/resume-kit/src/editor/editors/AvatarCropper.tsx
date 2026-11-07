import { useState, useCallback } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

interface AvatarCropperProps {
  image: string
  onCropComplete: (croppedImage: string) => void
  onCancel: () => void
  cropShape?: 'round' | 'rect'
}

export function AvatarCropper({ image, onCropComplete, onCancel, cropShape = 'round' }: AvatarCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1.5)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)

  const onCropChange = (crop: { x: number; y: number }) => {
    setCrop(crop)
  }

  const onZoomChange = (zoom: number) => {
    setZoom(zoom)
  }

  const onCropCompleteHandler = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels)
  }, [])

  const getCroppedImg = async () => {
    if (!croppedAreaPixels) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const imageObj = new Image()
    imageObj.src = image

    await new Promise<void>((resolve) => {
      imageObj.onload = () => resolve()
    })

    canvas.width = croppedAreaPixels.width
    canvas.height = croppedAreaPixels.height

    if (ctx) {
      ctx.drawImage(
        imageObj,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        croppedAreaPixels.width,
        croppedAreaPixels.height
      )
    }

    const croppedImage = canvas.toDataURL('image/jpeg', 0.9)
    onCropComplete(croppedImage)
  }

  return (
    <div className="space-y-4">
      <div className="relative w-full h-48 bg-stone-100 rounded-lg overflow-hidden">
        <Cropper
          image={image}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape={cropShape}
          showGrid={false}
          onCropChange={onCropChange}
          onZoomChange={onZoomChange}
          onCropComplete={onCropCompleteHandler}
        />
      </div>

      {/* Zoom Slider */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-stone-500">-</span>
        <input
          type="range"
          value={zoom}
          min={0.5}
          max={3}
          step={0.1}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-xs text-stone-500">+</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-3 py-2 border border-stone-300 rounded-lg text-sm hover:bg-stone-100 hover:text-stone-900"
        >
          取消
        </button>
        <button
          type="button"
          onClick={getCroppedImg}
          className="flex-1 px-3 py-2 bg-stone-900 text-white rounded-lg text-sm hover:bg-stone-800"
        >
          确认裁剪
        </button>
      </div>
    </div>
  )
}
