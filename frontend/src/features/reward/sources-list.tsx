import type { BriefSource } from '@/api/hunts'
import { wolfLabel } from './lib/wolf-label'

interface Props {
  sources: BriefSource[]
}

/** The bottom "Sources" list — "Title — Scout-N", flagged when a source wasn't verified. */
export function SourcesList({ sources }: Props) {
  if (!sources.length) return null
  return (
    <div className="mt-10 border-t border-[#242424] pt-6">
      <h2 className="text-[15px] font-semibold text-text">Sources</h2>
      <ul className="mt-3 flex flex-col gap-2.5">
        {sources.map((s, i) => {
          const w = wolfLabel(s.by)
          return (
            <li key={i} className="text-[13.5px] leading-relaxed text-text-dim">
              <span className="text-[#D8D8D8]">{s.title || s.url || 'Untitled source'}</span>
              <span className="text-text-faint"> — {w.short}</span>
              {!s.verified && <span className="text-[#C79A2E]"> flagged as unverified</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
