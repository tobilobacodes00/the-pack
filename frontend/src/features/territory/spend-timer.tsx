import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Square } from 'lucide-react'
import { useHuntSnapshot, useStopHunt } from '@/api/hunts'
import { color } from '@/lib/theme'
import type { HuntState } from '@/events/schema'

function mmss(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const RUNNING = new Set(['running', 'hold', 'standoff', 'halted_boundary'])
const DONE = new Set(['completed', 'failed', 'stopped'])

/**
 * The "$0.28 spent · 02:14" line shown in the chat while a hunt runs (and "Worked for 10:12" once
 * done). Live spend from `boundary.spent_usd`; elapsed derived from the hunt's `created_at` (or the
 * final `totals` once complete). Expands to a Stop control while the hunt is live.
 */
export function SpendTimer({ huntId, huntState }: { huntId: string; huntState: HuntState }) {
  const running = RUNNING.has(huntState.status)
  const done = DONE.has(huntState.status)
  const { data: snap } = useHuntSnapshot(huntId, true)
  const { mutate: stop, isPending: stopping } = useStopHunt(huntId)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  const totals = huntState.totals
  const spent =
    done && totals && totals.cost_usd != null
      ? Number(totals.cost_usd)
      : huntState.boundary.spent_usd

  let elapsed = 0
  if (done && totals && totals.time_s != null) elapsed = Number(totals.time_s)
  else if (snap?.created_at) elapsed = Math.max(0, (now - new Date(snap.created_at).getTime()) / 1000)

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
              border: '1px solid #404040', borderRadius: 8, color: '#F87171', fontSize: 12,
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
