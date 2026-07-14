import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Square } from 'lucide-react'
import { useStopHunt } from '@/api/hunts'
import { color } from '@/lib/theme'
import type { HuntState } from '@/events/schema'

function mmss(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// The clock ticks while the pack is actively working. `halted_boundary` is deliberately EXCLUDED:
// during a Boundary halt the hunt waits (unbounded) for the human to raise the cap — the backend
// re-anchors its measured clock on resume, so the live clock must freeze here too or it over-reads
// and the done-state snaps backward.
const RUNNING = new Set(['running', 'hold', 'standoff'])
const DONE = new Set(['completed', 'failed', 'stopped'])

/**
 * The "$0.28 spent · 02:14" line shown in the chat while a hunt runs (and "Worked for 10:12" once
 * done). Live spend from the authoritative `boundary.spent_usd`; elapsed anchored to `started_at`
 * (the plan_approved server ts, which matches the backend's measured runtime window) while running,
 * and the REAL measured `totals.time_s` once done. Expands to a Stop control while the hunt is live.
 */
export function SpendTimer({ huntId, huntState }: { huntId: string; huntState: HuntState }) {
  const running = RUNNING.has(huntState.status)
  const done = DONE.has(huntState.status)
  const { mutate: stop, isPending: stopping } = useStopHunt(huntId)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  // Defensive fallback: the first wall-clock time we observed this hunt in a running/live state.
  // The store-derived `started_at` (plan_approved ts) is the real anchor and is present in every
  // normal flow; this ref only backstops the pathological case where a live hunt is shown without
  // that event in state (e.g. a store rehydrated mid-run) so the clock never freezes at 0:00.
  const clientStartRef = useRef<number | null>(null)
  if ((running || done) && clientStartRef.current === null) clientStartRef.current = Date.now()

  const totals = huntState.totals
  const spent =
    done && totals && totals.cost_usd != null
      ? Number(totals.cost_usd)
      : huntState.boundary.spent_usd

  // Anchor priority: real measured totals once done → started_at..ended_at (both server timestamps,
  // for a done hunt with no measured time_s — failed/stopped never set totals) → started_at..now
  // while running → the client-observed fallback. There is always an anchor, so the timer can't
  // stick at 0:00 — and a done hunt is never measured against wall-clock "now" (which on a hunt
  // reopened long after it ended would read the whole elapsed gap as runtime, not its actual
  // duration).
  let elapsed = 0
  if (done && totals && totals.time_s != null) {
    elapsed = Number(totals.time_s)
  } else {
    const startMs =
      huntState.started_at != null
        ? new Date(huntState.started_at).getTime()
        : clientStartRef.current
    const endMs = done && huntState.ended_at != null ? new Date(huntState.ended_at).getTime() : now
    if (startMs != null && Number.isFinite(startMs) && Number.isFinite(endMs)) {
      elapsed = Math.max(0, (endMs - startMs) / 1000)
    }
  }

  const timeLabel = done ? `Worked for ${mmss(elapsed)}` : mmss(elapsed)

  return (
    <div style={{ padding: '2px 4px 0' }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
          color: color.dim, fontSize: 13, cursor: 'pointer', padding: '4px 8px',
        }}
      >
        <span>${spent.toFixed(2)} spent</span>
        <span style={{ color: '#555' }}>·</span>
        <span>{timeLabel}</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {expanded && running && (
        <div style={{ padding: '4px 8px 8px' }}>
          <button
            onClick={() => stop()}
            disabled={stopping}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none',
              border: '1px solid #dcdcd8', borderRadius: 8, color: '#F87171', fontSize: 12,
              padding: '5px 12px', cursor: stopping ? 'default' : 'pointer',
            }}
          >
            <Square size={12} /> {stopping ? 'Stopping…' : 'Stop the hunt'}
          </button>
        </div>
      )}
    </div>
  )
}
