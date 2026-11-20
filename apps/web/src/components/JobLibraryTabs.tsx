import type { KeyboardEvent } from 'react'

export type JobLibrary = 'private' | 'public'

interface JobLibraryTabsProps {
  value: JobLibrary
  labels: Record<JobLibrary, string>
  onChange: (value: JobLibrary) => void
}

const libraries: JobLibrary[] = ['private', 'public']

export function JobLibraryTabs({ value, labels, onChange }: JobLibraryTabsProps) {
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % libraries.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + libraries.length) % libraries.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = libraries.length - 1
    else return
    event.preventDefault()
    const tablist = event.currentTarget.parentElement
    tablist?.querySelector<HTMLButtonElement>(`[data-library="${libraries[next]}"]`)?.focus()
  }

  return (
    <div role="tablist" aria-label="岗位库类型" className="mb-4 flex gap-5 overflow-x-auto border-b border-stone-200">
      {libraries.map((library, index) => {
        const selected = value === library
        return (
          <button
            key={library}
            type="button"
            role="tab"
            id={`job-library-tab-${library}`}
            data-testid={`job-library-tab-${library}`}
            data-library={library}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(library)}
            onKeyDown={(event) => moveFocus(event, index)}
            className={`relative min-h-8 shrink-0 whitespace-nowrap px-0.5 pb-2 text-[13px] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 ${
              selected ? 'text-stone-900 after:bg-stone-900' : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            {labels[library]}
          </button>
        )
      })}
    </div>
  )
}
