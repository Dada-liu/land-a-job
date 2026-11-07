import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      requestAnimationFrame(() => cancelRef.current?.focus())
    }
  }, [])

  const close = () => {
    dialogRef.current?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onClose={onCancel}
      className="m-auto w-[min(90vw,440px)] rounded-xl border-0 bg-white p-0 text-stone-800 shadow-2xl backdrop:bg-black/30"
    >
      <div className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 id="confirm-dialog-title" className="text-base font-semibold">
            {title}
          </h2>
        </div>
        <p id="confirm-dialog-description" className="text-sm leading-relaxed text-stone-600">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={close}
            className="rounded-lg border border-stone-200 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm()
              close()
            }}
            className={`rounded-lg px-4 py-2 text-sm text-white ${
              destructive
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-stone-900 hover:bg-stone-800'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
