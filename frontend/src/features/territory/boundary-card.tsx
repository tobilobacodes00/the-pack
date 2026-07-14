import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { BoundaryState } from '@/events/schema'
import { useResumeHunt, useStopHunt } from '@/api/hunts'
import { color } from '@/lib/theme'

/** halted_boundary — the pack paused at its budget. Raise the boundary to resume, or stop here. */
export function BoundaryCard({ huntId, boundary }: { huntId: string; boundary: BoundaryState }) {
  const resume = useResumeHunt(huntId)
  const stop = useStopHunt(huntId)
  const [amount, setAmount] = useState(
    () => Math.max(boundary.budget_usd + 1, Math.round(boundary.budget_usd * 2 * 100) / 100),
  )

  return (
    <div style={{ margin: 12, background: color.raised, borderRadius: 14, padding: 18 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: color.text, display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={16} color="#F5B547" /> Budget reached
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: color.dim, lineHeight: 1.6 }}>
        The pack paused at ${boundary.spent_usd.toFixed(2)} of ${boundary.budget_usd.toFixed(2)}. Raise the
        boundary to let it finish, or stop here.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <span style={{ fontSize: 13, color: color.dim }}>New boundary $</span>
        <input
          type="number"
          min={boundary.budget_usd}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{ width: 90, background: '#ffffff', border: `1px solid ${color.border}`, borderRadius: 8, color: '#1a1a1a', fontSize: 13, padding: '6px 10px', outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
        <button
          onClick={() => stop.mutate()}
          disabled={stop.isPending}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: color.dim }}
        >
          Stop the hunt
        </button>
        <button
          onClick={() => resume.mutate({ boundary_usd: amount })}
          disabled={resume.isPending || amount <= boundary.budget_usd}
          style={{ background: color.text, color: color.canvas, fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 20, padding: '9px 22px', cursor: 'pointer', opacity: resume.isPending || amount <= boundary.budget_usd ? 0.5 : 1 }}
        >
          {resume.isPending ? 'Resuming…' : 'Raise & resume'}
        </button>
      </div>
    </div>
  )
}
