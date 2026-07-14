import { Fragment, type ReactNode } from 'react'

/**
 * A tiny, safe Markdown renderer for Alpha's CHAT replies.
 *
 * Alpha is prompted to format with a small Markdown subset — `**bold**`, `- ` bullet lists, numbered
 * lists, and blank-line paragraphs — but the chat bubble used to print the raw text, so users saw
 * literal `**asterisks**` and `-` dashes ("the chat is not parsing well"). The delivered brief renders
 * from structured blocks, not Markdown, so there was no renderer to reuse and no Markdown lib in the
 * project. Rather than pull a heavy dependency for chat, this covers exactly the subset Alpha emits.
 *
 * Safety: it builds React nodes (never dangerouslySetInnerHTML) and only ever emits text + a fixed set
 * of tags, so model output can't inject markup. Unrecognised syntax degrades to plain text.
 */

// Inline spans: **bold**, *italic* / _italic_, `code`. Applied left-to-right, non-overlapping.
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // One regex over the three inline forms; the alternation order matters (** before *).
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(last, m.index)}</Fragment>)
    if (m[2] !== undefined) {
      out.push(<strong key={`${keyPrefix}-b${i}`} className="font-semibold text-ink-900">{m[2]}</strong>)
    } else if (m[4] !== undefined) {
      out.push(<em key={`${keyPrefix}-i${i}`}>{m[4]}</em>)
    } else if (m[6] !== undefined) {
      out.push(<em key={`${keyPrefix}-i${i}`}>{m[6]}</em>)
    } else if (m[8] !== undefined) {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-cream-100 px-1 py-0.5 text-[0.85em] font-mono text-ink-800">
          {m[8]}
        </code>,
      )
    }
    last = m.index + m[0].length
    i += 1
  }
  if (last < text.length) out.push(<Fragment key={`${keyPrefix}-t${i}`}>{text.slice(last)}</Fragment>)
  return out
}

const BULLET_RE = /^\s*[-*]\s+(.*)$/
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/

/** Render one contiguous run of chat text as blocks (paragraphs + lists). */
export function ChatMarkdown({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let key = 0

  const flushPara = () => {
    if (para.length === 0) return
    const joined = para.join(' ')
    blocks.push(
      <p key={`p${key++}`} className="whitespace-pre-wrap [&:not(:first-child)]:mt-2">
        {renderInline(joined, `p${key}`)}
      </p>,
    )
    para = []
  }
  const flushList = () => {
    if (!list || list.items.length === 0) { list = null; return }
    const items = list.items.map((it, idx) => (
      <li key={idx} className="[&:not(:first-child)]:mt-1">{renderInline(it, `li${key}-${idx}`)}</li>
    ))
    blocks.push(
      list.ordered ? (
        <ol key={`ol${key++}`} className="mt-2 list-decimal space-y-0.5 pl-5">{items}</ol>
      ) : (
        <ul key={`ul${key++}`} className="mt-2 list-disc space-y-0.5 pl-5">{items}</ul>
      ),
    )
    list = null
  }

  for (const line of lines) {
    if (line.trim() === '') {
      // blank line ends the current paragraph/list (paragraph boundary)
      flushPara()
      flushList()
      continue
    }
    const bullet = line.match(BULLET_RE)
    const numbered = line.match(NUMBERED_RE)
    if (bullet) {
      flushPara()
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] } }
      list.items.push(bullet[1])
    } else if (numbered) {
      flushPara()
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] } }
      list.items.push(numbered[2])
    } else {
      flushList()
      para.push(line)
    }
  }
  flushPara()
  flushList()

  return <>{blocks}</>
}
