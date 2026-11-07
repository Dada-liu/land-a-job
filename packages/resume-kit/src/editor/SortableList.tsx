import { useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { GripVertical } from 'lucide-react'

interface SortableListProps<T extends { id: string }> {
  items: T[]
  onReorder: (fromIndex: number, toIndex: number) => void
  renderItem: (item: T) => ReactNode
}

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
}: SortableListProps<T>) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)

  const resetDrag = () => {
    setDraggedIndex(null)
    setDropTargetIndex(null)
  }

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    index: number
  ) => {
    setDraggedIndex(index)
    setDropTargetIndex(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (
    event: DragEvent<HTMLDivElement>,
    index: number
  ) => {
    if (draggedIndex === null) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetIndex(index)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    if (draggedIndex === null) return

    event.preventDefault()
    onReorder(draggedIndex, index)
    resetDrag()
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const toIndex = event.key === 'ArrowUp'
      ? index - 1
      : event.key === 'ArrowDown'
        ? index + 1
        : null

    if (toIndex === null || toIndex < 0 || toIndex >= items.length) return

    event.preventDefault()
    onReorder(index, toIndex)
  }

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div
          key={item.id}
          onDragOver={(event) => handleDragOver(event, index)}
          onDrop={(event) => handleDrop(event, index)}
          className={`rounded-lg transition-shadow ${
            dropTargetIndex === index && draggedIndex !== index
              ? 'ring-2 ring-stone-900'
              : ''
          }`}
        >
          <div className="mb-1 flex justify-end">
            <button
              type="button"
              draggable
              onDragStart={(event) => handleDragStart(event, index)}
              onDragEnd={resetDrag}
              onKeyDown={(event) => handleKeyDown(event, index)}
              aria-label={`调整第 ${index + 1} 项顺序：拖拽或使用上下方向键`}
              title="拖拽调整顺序，也可使用上下方向键"
              className={`inline-flex h-6 w-6 items-center justify-center rounded text-stone-400 select-none [-webkit-user-select:none] hover:bg-stone-100 hover:text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900 ${
                draggedIndex === index ? 'cursor-grabbing' : 'cursor-grab'
              }`}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </div>
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}
