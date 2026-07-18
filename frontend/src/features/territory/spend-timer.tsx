import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronUp, Square } from 'lucide-react'
import { useStopHunt } from '@/api/hunts'
import { color } from '@/lib/theme'
import type { HuntState, ActivityItem } from '@/events/schema'
import { beatTitle } from './beat-title'

function mmss(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// `halted_boundary` is deliberately excluded: the hunt waits unbounded for the human to raise the
// cap, and the backend re-anchors its clock on resume, so the live clock must freeze here too or
// it over-reads and the done-state snaps backward.
const RUNNING = new Set(['running', 'hold', 'standoff'])
const DONE = new Set(['completed', 'failed', 'stopped'])

/**
 * The "$0.28 spent · 02:14" line shown in the chat while a hunt runs (and "Worked for 10:12" once
 * done). Live spend from the authoritative `boundary.spent_usd`; elapsed anchored to `started_at`
 * (the plan_approved server ts, which matches the backend's measured runtime window) while running,
 * and the REAL measured `totals.time_s` once done. Expands to a Stop control while the hunt is live.
 */
export function SpendTimer({
  huntId,
  huntState,
  activity = [],
}: {
  huntId: string
  huntState: HuntState
  /** The pack's live beats — revealed (plain text) when this line is expanded via its chevron. */
  activity?: ActivityItem[]
}) {
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

  // Fallback anchor for the pathological case where a live hunt is shown without `started_at` in
  // state (e.g. a store rehydrated mid-run) — so the clock never freezes at 0:00.
  const clientStartRef = useRef<number | null>(null)
  if ((running || done) && clientStartRef.current === null) clientStartRef.current = Date.now()

  const totals = huntState.totals
  const spent =
    done && totals && totals.cost_usd != null
      ? Number(totals.cost_usd)
      : huntState.boundary.spent_usd

  // Anchor priority: measured totals once done → started_at..ended_at → started_at..now while
  // running → client-observed fallback. A done hunt is never measured against wall-clock "now",
  // which on a hunt reopened long after it ended would read the whole gap as runtime.
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

      {/* Expanded: the pack's beats as a plain-text log, plus Stop while the hunt runs. */}
      {expanded && (
        <div style={{ padding: '4px 8px 10px' }}>
          {activity.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: running ? 12 : 0 }}>
              {activity.map((a) => (
                <div key={a.seq}>
                  <p style={{ margin: 0, fontSize: 12.5, fontWeight: 500, color: color.faint }}>
                    {beatTitle(a.wolfId, a.text)}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 13.5, color: color.text, lineHeight: 1.5 }}>
                    {a.text}
                  </p>
                </div>
              ))}
            </div>
          )}
          {running && (
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
          )}
        </div>
      )}
    </div>
  )
}
