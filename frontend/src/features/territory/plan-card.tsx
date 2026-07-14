import { useState } from 'react'
import { Pencil, TriangleAlert } from 'lucide-react'
import type { PlanState, PlanDepth } from '@/events/schema'
import type { useApprovePlan } from '@/api/hunts'
import { useHuntStore } from '@/store/hunt-store'
import { formatUsd, formatDuration } from '@/lib/format'
import { color } from '@/lib/theme'

type ApproveFn = ReturnType<typeof useApprovePlan>['mutate']

// The Boundary the hunt authorizes: a floor of $1 (headroom for the largest default formation), else
// 2× the estimate (est_cost runs low). The backend re-clamps to first_hunt_cap_usd, so this is a
// request, not the enforced ceiling — no phantom fixed cap that diverges from the .env-tunable cap.
const BOUNDARY_FLOOR = 1.0

const DEPTHS: { id: PlanDepth; label: string; hint: string }[] = [
  { id: 'brief', label: 'Brief', hint: 'A tight answer — fewer sources, quick.' },
  { id: 'standard', label: 'Standard', hint: 'A normal briefing.' },
  { id: 'deep', label: 'Deep', hint: 'A comprehensive report — thorough but longer and pricier.' },
]

interface PlanCardProps {
  plan: PlanState
  onApprove: ApproveFn
  onEdit: () => void
  onEditFormation: () => void
  approving: boolean
}

/**
 * The "time to start a hunt" state — shown in the chat once Alpha has proposed a
 * formation (status === 'plan_ready'): a raised card with the depth control + est,
 * two numbered choices, and the Start Hunt pill.
 */
export function PlanCard({ plan, onApprove, onEdit, onEditFormation, approving }: PlanCardProps) {
  const pendingEdits = useHuntStore((s) => s.pendingEdits)
  // Seed from Beta's proposal; the user can dial it up or down before approving.
  const [depth, setDepth] = useState<PlanDepth>(plan.depth ?? 'standard')
  const boundary = Math.max(BOUNDARY_FLOOR, plan.est_cost * 2)
  const handleStart = () => {
    onApprove({
      mode: 'wild',
      boundary_usd: boundary,
      depth, // v3: the user's depth choice reaches the running Supervisor
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

      {/* Depth — how comprehensive the brief should be (editable before you approve). */}
      <div style={{ marginTop: 16 }}>
        <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: color.dim }}>
          Depth of the brief
        </p>
        <div
          role="radiogroup"
          aria-label="Depth of the brief"
          style={{
            display: 'flex', gap: 4, background: color.canvas, border: `1px solid ${color.border}`,
            borderRadius: 10, padding: 3,
          }}
        >
          {DEPTHS.map((d) => {
            const active = depth === d.id
            return (
              <button
                key={d.id}
                role="radio"
                aria-checked={active}
                aria-label={d.label}
                onClick={() => setDepth(d.id)}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: active ? color.text : 'transparent',
                  color: active ? color.canvas : color.dim,
                }}
              >
                {d.label}
              </button>
            )
          })}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: color.faint, lineHeight: 1.5 }}>
          {DEPTHS.find((d) => d.id === depth)?.hint}
        </p>
      </div>

      {/* Estimate + the authorized ceiling (est numbers are a preview, not a bill). */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 12,
          color: color.dim,
        }}
      >
        <span>~{formatUsd(plan.est_cost)}</span>
        <span style={{ color: color.border }}>·</span>
        <span>~{formatDuration(plan.est_time)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: color.faint }}>
          cap {formatUsd(boundary)}
        </span>
      </div>

      {/* Deep-hunt warning — qualitative so it never contradicts the est or the live counter. */}
      {depth === 'deep' && (
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12, padding: '9px 11px',
            background: 'rgba(234,179,8,0.10)', border: `1px solid ${color.warn}`, borderRadius: 10,
          }}
        >
          <TriangleAlert size={15} style={{ color: color.warn, flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: color.dim, lineHeight: 1.5 }}>
            Deep hunt — more thorough, but it runs longer and costs more.
          </span>
        </div>
      )}

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
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b6b6b',
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
