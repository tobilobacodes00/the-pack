import type { NarrativeItem } from './lib/narrative'

interface Props {
  items: NarrativeItem[]
}

export function TracksTimeline({ items }: Props) {
  if (!items.length) {
    return <p className="px-4 py-6 text-[13px] text-muted">No activity recorded for this hunt.</p>
  }
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {items.map((it) => (
        <div key={it.id} className="flex gap-3">
          <span
            className="mt-[7px] h-2 w-2 shrink-0 rounded-full"
            style={{ background: it.color }}
          />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#EDEDED]">{it.title}</p>
            {it.detail && (
              <p className="mt-0.5 text-[12.5px] leading-snug text-[#9A9A9A]">{it.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
