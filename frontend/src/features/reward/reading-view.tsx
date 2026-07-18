import { useRef, useState } from 'react'
import type { Brief, BriefSource } from '@/api/hunts'
import { parseBrief, formatByline } from './lib/brief-view'
import { ProseBlocks } from './prose-blocks'
import { SourcesList } from './sources-list'
import { ProvenancePopover } from './provenance-popover'

interface Props {
  brief: Brief
  dateISO?: string | null
  projectName?: string | null
}

type Prov = { top: number; left: number; sources: BriefSource[] }

/** The main reading column: title, byline, prose body (with provenance + margin rail), Sources. */
export function ReadingView({ brief, dateISO, projectName }: Props) {
  const view = parseBrief(brief, '')
  const sources = brief.content.sources ?? []
  const articleRef = useRef<HTMLElement>(null)
  const [prov, setProv] = useState<Prov | null>(null)

  const openProv = (ids: number[], anchor: HTMLElement) => {
    const picked = ids.map((n) => sources[n - 1]).filter(Boolean) as BriefSource[]
    const art = articleRef.current
    if (!picked.length || !art) return
    const ar = art.getBoundingClientRect()
    const cr = anchor.getBoundingClientRect()
    // Keep the popover fully inside the article — a citation near the edge shouldn't push it off-screen.
    const popW = Math.min(300, ar.width - 24)
    const left = Math.max(0, Math.min(cr.left - ar.left, ar.width - popW - 12))
    setProv({ top: cr.bottom - ar.top + 6, left, sources: picked })
  }

  return (
    <article ref={articleRef} className="relative mx-auto w-full max-w-[840px] px-6 py-10 sm:px-10">
      <div className="max-w-[600px]">
        <h1 className="text-[26px] font-bold leading-[1.2] tracking-[-0.01em] text-text">
          {view.title}
        </h1>
        <div className="mt-2.5 flex items-center gap-2">
          <p className="text-[13px] text-muted">{formatByline(dateISO, projectName)}</p>
          {view.refined && (
            <span className="rounded-full border border-brand-500/40 px-2 py-0.5 text-[11px] font-medium text-brand-600">
              Refined
            </span>
          )}
        </div>
      </div>

      <div className="mt-7">
        <ProseBlocks blocks={view.bodyBlocks} onClaimClick={openProv} />
      </div>

      <div className="max-w-[600px]">
        {view.noSources ? (
          <p className="mt-9 border-t border-border pt-6 text-[13px] italic text-ink-500">
            No sources — this was drafted from the provided context.
          </p>
        ) : (
          <SourcesList sources={sources} />
        )}
      </div>

      {prov && (
        <ProvenancePopover
          top={prov.top}
          left={prov.left}
          sources={prov.sources}
          onClose={() => setProv(null)}
        />
      )}
    </article>
  )
}
