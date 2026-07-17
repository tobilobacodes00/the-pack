import { useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'
import type { BriefSource } from '@/api/hunts'
import { cn } from '@/lib/utils'
import { wolfLabel } from './lib/wolf-label'

interface Props {
  /** Position relative to the (position:relative) article container. */
  top: number
  left: number
  sources: BriefSource[]
  onClose: () => void
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Field({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-wide text-text-faint">{label}</p>
      <p className={cn('mt-0.5 text-[13px] text-ink-700', valueClass)}>{value}</p>
    </div>
  )
}

/**
 * The click-to-open provenance card. Rendered inside the article (not portaled) so it lives within
 * the Dialog's content — clicking it never trips Radix's close-on-outside, and it scrolls with the
 * claim it belongs to. Positioned absolute against the article's relative box.
 */
export function ProvenancePopover({ top, left, sources, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture phase + stopPropagation so Radix Dialog's (bubble-phase) Esc handler never runs —
        // Esc dismisses just the popover, not the whole modal.
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
    }
    // Defer so the opening click's own mousedown doesn't immediately dismiss it.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const [primary, ...rest] = sources
  const w = wolfLabel(primary.by)

  return (
    <div
      ref={ref}
      style={{ top, left }}
      className="absolute z-[60] w-[min(300px,88vw)] rounded-xl border border-border bg-white p-4 shadow-soft"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: w.color }} />
        <span className="text-[13px] font-semibold text-text">{w.label} found this</span>
      </div>

      <Field label="Source Name" value={primary.title || primary.url || 'Untitled source'} />
      {primary.timestamp ? (
        <Field label="Timestamp" value={`Recording timestamp ${primary.timestamp}`} />
      ) : primary.url ? (
        <Field label="Where" value={domainOf(primary.url)} />
      ) : null}
      <Field
        label="Verification status"
        value={primary.verified ? 'Sentinel verified · No challenges' : 'Flagged as unverified'}
        valueClass={primary.verified ? 'text-brand-600' : 'text-[#C79A2E]'}
      />

      {primary.url && (
        <a
          href={primary.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-[12px] text-accent transition-colors hover:text-brand-600"
        >
          Open source <ExternalLink size={12} />
        </a>
      )}

      {rest.length > 0 && (
        <div className="mt-3 border-t border-border pt-2.5">
          <p className="text-[11px] uppercase tracking-wide text-text-faint">Also cited</p>
          {rest.map((s, i) => {
            const rw = wolfLabel(s.by)
            return (
              <p key={i} className="mt-1 text-[12px] text-text-dim">
                <span style={{ color: rw.color }}>{rw.short}</span> · {s.title || s.url}
              </p>
            )
          })}
        </div>
      )}
    </div>
  )
}
