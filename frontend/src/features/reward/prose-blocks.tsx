import type { BriefBlock } from '@/api/hunts'
import { CitationRail } from './citation-rail'

interface Props {
  blocks: BriefBlock[]
  /** Open provenance for a claim: its 1-based source ids + the element to anchor the card to. */
  onClaimClick: (ids: number[], anchor: HTMLElement) => void
}

function uniqueSorted(ids: number[] | undefined): number[] {
  return [...new Set((ids ?? []).filter((n) => n > 0))].sort((a, b) => a - b)
}

/** The brief body: one paragraph per block. Cited paragraphs hover blue + open provenance. */
export function ProseBlocks({ blocks, onClaimClick }: Props) {
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((b, i) => {
        const text = (b.text ?? '').trim()
        if (text.startsWith('## ')) {
          return (
            <h2 key={i} className="mt-2 max-w-[600px] text-[17px] font-semibold text-ink-900">
              {text.slice(3).trim()}
            </h2>
          )
        }
        const ids = uniqueSorted(b.source_ids)
        return (
          <div key={i} className="flex items-start justify-between gap-8">
            {ids.length ? (
              <p
                onClick={(e) => onClaimClick(ids, e.currentTarget)}
                className="-mx-2 min-w-0 max-w-[600px] flex-1 cursor-pointer whitespace-pre-wrap rounded-md px-2 py-0.5 text-[15px] leading-[1.75] text-ink-700 transition-colors hover:bg-[rgba(26,26,26,0.12)]"
              >
                {text}
              </p>
            ) : (
              <p className="min-w-0 max-w-[600px] flex-1 whitespace-pre-wrap text-[15px] leading-[1.75] text-ink-700">
                {text}
              </p>
            )}
            <CitationRail ids={ids} onClick={(anchor) => onClaimClick(ids, anchor)} />
          </div>
        )
      })}
    </div>
  )
}
