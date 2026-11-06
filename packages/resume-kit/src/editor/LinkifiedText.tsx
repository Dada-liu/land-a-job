import type { ReactNode } from 'react'

const URL_PATTERN = /(?<![\w.@/-])(?:https?:\/\/|www\.)[^\s<>"'，。；：！？、（）【】]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}>，。；：！？、）】》」』]+$/

function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0]
    const matched = raw.replace(TRAILING_PUNCTUATION, '')
    if (!matched) continue

    if (start > cursor) nodes.push(text.slice(cursor, start))
    const href = /^https?:\/\//i.test(matched) ? matched : `https://${matched}`
    nodes.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        {matched}
      </a>
    )

    const rest = raw.slice(matched.length)
    if (rest) nodes.push(rest)
    cursor = start + raw.length
  }

  if (nodes.length === 0) return [text]
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function LinkifiedText({ text }: { text: string }) {
  return <>{linkify(text)}</>
}
