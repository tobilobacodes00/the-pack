interface Props {
  ids: number[]
  onClick: (anchor: HTMLElement) => void
}

/**
 * The right-margin citation numbers for one block — sits in the reading gutter, aligned to the top
 * of its paragraph. Muted until hover; click opens that block's provenance. An empty (but reserved)
 * cell keeps the text column aligned for paragraphs with no citations.
 */
export function CitationRail({ ids, onClick }: Props) {
  if (!ids.length) return <div className="w-6 shrink-0" aria-hidden />
  return (
    <div className="flex w-6 shrink-0 flex-col items-end pt-1">
      {ids.map((n) => (
        <button
          key={n}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClick(e.currentTarget)
          }}
          className="text-[12px] font-medium tabular-nums leading-6 text-text-faint transition-colors hover:text-accent"
        >
          {n}
        </button>
      ))}
    </div>
  )
}
