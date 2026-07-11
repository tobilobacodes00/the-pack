import { useState } from 'react'
import type { PlanState } from '@/events/schema'
import type { useApprovePlan } from '@/api/hunts'
import { useHuntStore } from '@/store/hunt-store'
import { color } from '@/lib/theme'

type ApproveFn = ReturnType<typeof useApprovePlan>['mutate']

const ghost: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: color.dim,
}

/**
 * The plan-ready "Hunt Summary" (matches the "Plan Message" design): estimated time / cost / boundary
 * as numbered rows, with Edit Boundary (adjust the cap before sending), Edit Formations (the visual
 * editor), and Start Hunt — which carries any saved formation edits through the approve seam.
 */
export function HuntSummaryCard({
  plan, onApprove, onEditFormation, approving,
}: {
  plan: PlanState
  onApprove: ApproveFn
  onEditFormation: () => void
  approving: boolean
}) {
  const pendingEdits = useHuntStore((s) => s.pendingEdits)
  const [boundary, setBoundary] = useState(() => Math.max(5, (plan.est_cost ?? 0) * 2))
  const [editingBoundary, setEditingBoundary] = useState(false)

  const minutes = Math.max(1, Math.round((plan.est_time ?? 0) / 60))
  const rows = [
    `Estimated time: ${minutes} minute${minutes > 1 ? 's' : ''}`,
    `Estimated cost: $${(plan.est_cost ?? 0).toFixed(2)}`,
    `Boundary set at $${boundary.toFixed(2)}`,
  ]

  const start = () =>
    onApprove({
      mode: 'wild',
      boundary_usd: boundary,
      edits: pendingEdits ? { team: pendingEdits.team, notes: pendingEdits.notes } : undefined,
    })

  return (
    <div style={{ margin: 12, background: color.raised, borderRadius: 14, padding: 18 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: color.text }}>Hunt Summary</p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: color.dim, lineHeight: 1.6 }}>
        Review the estimate and boundary, then send the pack.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '16px 0 18px' }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600,
                border: `1px solid ${color.border}`, color: color.dim,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 14, color: '#D4D4D4' }}>{r}</span>
          </div>
        ))}
      </div>

      {editingBoundary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ color: color.dim, fontSize: 13 }}>$</span>
          <input
            type="number"
            min={1}
            step={0.5}
            value={boundary}
            onChange={(e) => setBoundary(Math.max(1, Number(e.target.value) || 1))}
            style={{
              width: 100, background: '#111111', border: `1px solid ${color.border}`, borderRadius: 8,
              color: '#fff', fontSize: 13, padding: '6px 10px', outline: 'none',
            }}
          />
          <button
            onClick={() => setEditingBoundary(false)}
            style={{ background: 'none', border: `1px solid ${color.border}`, borderRadius: 8, color: color.dim, fontSize: 12, padding: '6px 12px', cursor: 'pointer' }}
          >
            Done
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <button onClick={() => setEditingBoundary((v) => !v)} style={ghost}>Edit Boundary</button>
          <button onClick={onEditFormation} style={ghost}>Edit Formations</button>
        </div>
        <button
          onClick={start}
          disabled={approving}
          style={{
            background: color.text, color: color.canvas, fontSize: 13, fontWeight: 600, border: 'none',
            borderRadius: 20, padding: '9px 22px', cursor: 'pointer', opacity: approving ? 0.5 : 1,
          }}
        >
          {approving ? 'Starting…' : 'Start Hunt'}
        </button>
      </div>
    </div>
  )
}
