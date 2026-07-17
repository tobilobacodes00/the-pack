import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { RawTrackEvent } from '@/api/hunts'
import { deriveNarrative, deriveTrackStats } from '@/features/reward/lib/narrative'
import { GraphCanvas } from '@/features/territory/graph-canvas'
import { useReplay } from './use-replay'

interface Props {
  title: string
  /** The raw (redacted) event log — from /hunts/:id/tracks/export or /share/:token/tracks. */
  raw: unknown[]
  /** Optional link back to the brief this replay belongs to. */
  briefHref?: string
  briefLabel?: string
}

/**
 * The Flight Recorder — replay a whole hunt, decision by decision, on the same canvas that
 * rendered it live. The event log is the single source of truth (append-only, redacted), so what
 * you watch here is what actually happened: every handoff, every challenge, every dollar.
 */
export function FlightRecorder({ title, raw, briefHref, briefLabel = 'Read the brief' }: Props) {
  const replay = useReplay(raw)
  const { events, index, seek, playing, toggle, state, currentSeq } = replay

  // The human-readable beats, synced to the scrubber: only beats at-or-before the current seq.
  const narrative = useMemo(() => deriveNarrative(raw as RawTrackEvent[]), [raw])
  const visibleBeats = useMemo(
    () => narrative.filter((n) => Number(n.id) <= currentSeq),
    [narrative, currentSeq],
  )
  const stats = useMemo(() => deriveTrackStats(raw as RawTrackEvent[], state.totals), [raw, state.totals])

  // Keep the newest beat in view while playing. (Optional-call: jsdom has no scrollIntoView.)
  const beatsEndRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    beatsEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [visibleBeats.length])

  const atEnd = index >= events.length

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-text">{title}</p>
          <p className="text-[12px] text-muted">
            Flight Recorder — the hunt’s full event log, replayed. {stats.costLabel}.
          </p>
        </div>
        {briefHref && (
          <Link
            to={briefHref}
            className="shrink-0 rounded-full border border-border px-4 py-1.5 text-[13px] text-text-dim transition-colors hover:text-text"
          >
            {briefLabel}
          </Link>
        )}
      </header>

      {/* Canvas + narrative */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <GraphCanvas huntState={state} />
        </div>
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-border">
          <p className="border-b border-border px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
            What happened
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {visibleBeats.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-muted">
                Press play to watch the pack work — the beats land here as they happened.
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {visibleBeats.map((b) => (
                  <li key={b.id} className="text-[13px] leading-snug">
                    <span className="font-medium" style={{ color: b.color }}>
                      {b.title}
                    </span>
                    {b.detail && <span className="block text-text-dim">{b.detail}</span>}
                  </li>
                ))}
              </ol>
            )}
            <div ref={beatsEndRef} />
          </div>
        </aside>
      </div>

      {/* Transport */}
      <footer className="flex shrink-0 items-center gap-4 border-t border-border px-5 py-3">
        <button
          onClick={toggle}
          aria-label={playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600"
        >
          {playing ? <Pause size={16} /> : atEnd ? <RotateCcw size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <input
          type="range"
          aria-label="Replay position"
          min={0}
          max={events.length}
          value={index}
          onChange={(e) => seek(Number(e.target.value))}
          className="min-w-0 flex-1 accent-brand-500"
        />
        <span className="shrink-0 text-[12px] tabular-nums text-muted">
          {index} / {events.length} events
        </span>
      </footer>
    </div>
  )
}
