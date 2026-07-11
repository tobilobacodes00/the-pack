import { Pencil } from 'lucide-react'
import type { PlanState } from '@/events/schema'
import type { useApprovePlan } from '@/api/hunts'
import { useHuntStore } from '@/store/hunt-store'
import { color } from '@/lib/theme'

type ApproveFn = ReturnType<typeof useApprovePlan>['mutate']

interface PlanCardProps {
  plan: PlanState
  onApprove: ApproveFn
  onEdit: () => void
  onEditFormation: () => void
  approving: boolean
}

/**
 * The "time to start a hunt" state — shown in the chat once Alpha has proposed a
 * formation (status === 'plan_ready'). Matches the Frame 178 design: a raised
 * #272727 card floating on the panel, two numbered choices, and the Start Hunt pill.
 */
export function PlanCard({ plan, onApprove, onEdit, onEditFormation, approving }: PlanCardProps) {
  const pendingEdits = useHuntStore((s) => s.pendingEdits)
  const handleStart = () => {
    onApprove({
      mode: 'wild',
      boundary_usd: Math.max(5, (plan.est_cost ?? 0) * 2),
      // Carry the formation edits (extra agents + per-agent notes) saved in the editor.
      edits: pendingEdits ? { team: pendingEdits.team, notes: pendingEdits.notes } : undefined,
    })
  }

  return (
    <div
      style={{
        margin: 12,
        background: color.raised,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: color.text }}>
        Alpha proposed Formation
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: color.dim, lineHeight: 1.6 }}>
        This is a list of formation Alpha has proposed for this hunt. Would you like to start
        hunt or Edit formations
      </p>

      {/* Numbered choices */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '18px 0' }}>
        <button
          onClick={handleStart}
          disabled={approving}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'none',
            border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span
            style={{
              width: 32, height: 32, borderRadius: 16, flexShrink: 0, background: color.text,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600, color: color.canvas,
            }}
          >
            1
          </span>
          <span style={{ fontSize: 14, color: color.text }}>Yes, send it</span>
        </button>

        <button
          onClick={onEdit}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'none',
            border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span
            style={{
              width: 32, height: 32, borderRadius: 16, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#727272',
            }}
          >
            <Pencil size={15} />
          </span>
          <span style={{ fontSize: 14, color: color.dim, lineHeight: 1.4 }}>
            No, tell Alpha what to do differently
          </span>
        </button>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <button
          onClick={onEditFormation}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontSize: 13, color: color.dim,
          }}
        >
          Edit Formations
        </button>
        <button
          onClick={handleStart}
          disabled={approving}
          style={{
            background: color.text, color: color.canvas, fontSize: 13, fontWeight: 600,
            border: 'none', borderRadius: 20, padding: '9px 22px', cursor: 'pointer',
            opacity: approving ? 0.5 : 1,
          }}
        >
          {approving ? 'Starting…' : 'Start Hunt'}
        </button>
      </div>
    </div>
  )
}
