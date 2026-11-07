import { ChevronRight } from 'lucide-react'
import type { EditorModule } from '../types/template'

export interface EditorPanelProps {
  modules: EditorModule[]
  activeEditor: string | null
  onToggle: (id: string | null) => void
}

/**
 * 右侧编辑面板：手风琴式展开，一次只开一个模块。
 * 只收 props，不再 import 任何 store —— 这是 resume-kit 能被复用的前提。
 */
export function EditorPanel({ modules, activeEditor, onToggle }: EditorPanelProps) {
  return (
    <div className="flex h-full w-80 flex-col border-l border-stone-200 bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-1 p-4">
          {modules.map((mod) => {
            const Icon = mod.icon
            const isActive = activeEditor === mod.id

            return (
              <div key={mod.id}>
                <button
                  type="button"
                  onClick={() => onToggle(isActive ? null : mod.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-4 py-3 transition-colors ${
                    isActive ? 'bg-stone-900 text-white' : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{mod.label}</span>
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${isActive ? 'rotate-90' : ''}`}
                  />
                </button>
                {isActive && (
                  <div className="mt-2 rounded-lg bg-stone-50 p-4">
                    <mod.component />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
