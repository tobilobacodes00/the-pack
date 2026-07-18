import { useState } from 'react'
import { ChevronLeft, PanelLeftClose, PanelLeftOpen, Loader2, SquarePen } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { color } from '@/lib/theme'
import type { HuntState, HuntStatus, WolfState } from '@/events/schema'
import { ROLE_DESC, numberWord } from './roles'
import { IdleGlyph } from './agent-node'
import type { AgentTone } from './agent-node'
import { planRoleList } from './formation-editor/formation-model'

interface LeftPanelProps {
  huntState: HuntState
}

/** Collapse the formation into ordered [role, count] pairs (first-seen order),
 *  so three scouts become a single "Scout" entry with the count noted. */
function rosterRoles(wolves: string[]): Array<[string, number]> {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const w of wolves) {
    if (!counts.has(w)) order.push(w)
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return order.map((role) => [role, counts.get(role)!])
}

function describe(role: string, count: number): string {
  const base = ROLE_DESC[role] ?? ''
  return count > 1 ? `${base} — ${numberWord(count)} running at once` : base
}

/** The live tone for a role, rolled up across its wolves: any working → active, any strayed/healing
 *  → that, all done → done, else grey idle. Empty (idle/plan states) → idle. */
function roleTone(role: string, wolves: Record<string, WolfState>): AgentTone {
  const list = Object.values(wolves).filter((w) => w.role === role)
  if (list.length === 0) return 'idle'
  if (list.some((w) => w.status === 'active')) return 'active'
  if (list.some((w) => w.status === 'strayed' || w.status === 'error')) return 'strayed'
  if (list.some((w) => w.status === 'healing')) return 'healing'
  if (list.every((w) => w.status === 'done')) return 'done'
  return 'idle'
}

type Badge = { label: string; color: string; bg: string; border: string; spinner?: boolean }

function statusBadge(status: HuntStatus): Badge | null {
  switch (status) {
    case 'idle':
      return { label: 'Ready to hunt', color: '#6b6b6b', bg: '#f2f2f0', border: '#dcdcd8' }
    case 'planning':
      return { label: 'Forming the pack…', color: '#6b6b6b', bg: '#f2f2f0', border: '#dcdcd8', spinner: true }
    case 'plan_ready':
      return { label: 'Ready to hunt', color: '#6b6b6b', bg: '#f2f2f0', border: '#dcdcd8' }
    case 'running':
    case 'hold':
    case 'standoff':
    case 'halted_boundary':
      return { label: 'On the move', color: '#F5B547', bg: 'rgba(245,158,11,0.13)', border: 'rgba(245,158,11,0.35)' }
    case 'completed':
      return { label: 'Hunt complete', color: '#4ADE80', bg: 'rgba(34,197,94,0.13)', border: 'rgba(34,197,94,0.35)' }
    case 'failed':
      return { label: 'Hunt failed', color: '#F87171', bg: 'rgba(239,68,68,0.13)', border: 'rgba(239,68,68,0.35)' }
    case 'stopped':
      return { label: 'Stopped', color: '#6b6b6b', bg: '#f2f2f0', border: '#dcdcd8' }
    default:
      return null
  }
}

const cardBase: React.CSSProperties = {
  background: color.surface,
  border: '1px solid #dcdcd8',
  borderRadius: 16,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  flexShrink: 0,
}

const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', color: '#6b6b6b', padding: 0, display: 'flex',
}

export function LeftPanel({ huntState }: LeftPanelProps) {
  const isMobile = useIsMobile()
  // Leave the territory with a hard navigation, NOT react-router's navigate('/'). This panel is shared
  // by the standalone /hunts/:id page AND the door-mounted territory. On the door, the territory phase
  // is local component state and the URL was set via raw history.replaceState — a plain navigate('/')
  // changes the URL but doesn't remount DoorPage, so the view stays stuck in territory (it just "strips
  // the slug"). A full document load guarantees a fresh Door + a clean hunt store in every context.
  const goToDoor = () => window.location.assign('/')
  // On a phone the roster starts as the compact corner square so it never covers the canvas/chat; on
  // desktop it opens as the full rail. The user can still toggle either way.
  const [collapsed, setCollapsed] = useState(isMobile)

  // Roles from the plan's canonical team (with leads), grouped by role — NOT plan.wolves (wolf-ids).
  const roles = rosterRoles(planRoleList(huntState.plan))
  const badge = statusBadge(huntState.status)
  const emptyCopy =
    huntState.status === 'idle' || huntState.status === 'planning'
      ? 'Alpha is scoping your task…'
      : 'Waiting for formation…'

  if (collapsed) {
    // A compact square pinned to the top-left corner (design), not a full-height rail.
    return (
      <div style={{ ...cardBase, width: 52, height: 52, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={() => setCollapsed(false)} title="Expand" style={iconBtn}>
          <PanelLeftOpen size={18} />
        </button>
      </div>
    )
  }

  return (
    <div style={{ ...cardBase, width: isMobile ? 'min(300px, 80vw)' : 300 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 16px 12px',
          borderBottom: '1px solid #dcdcd8',
        }}
      >
        <button onClick={goToDoor} style={iconBtn} title="Back">
          <ChevronLeft size={18} />
        </button>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>A Pack</span>
        <button onClick={() => setCollapsed(true)} style={{ ...iconBtn, color: '#555' }} title="Collapse">
          <PanelLeftClose size={17} />
        </button>
      </div>

      {/* New Hunt Button */}
      <div style={{ padding: '16px 16px 4px' }}>
        <button
          onClick={goToDoor}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(26,26,26,0.05)',
            border: `1px solid ${color.border}`,
            borderRadius: '8px',
            padding: '8px 12px',
            color: '#4a4a4a',
            fontSize: '13.5px',
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(26,26,26,0.07)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(26,26,26,0.05)'}
        >
          <SquarePen size={16} color="#A3A3A3" />
          New Hunt
        </button>
      </div>

      {/* Status badge */}
      {badge && (
        <div style={{ padding: '12px 16px 4px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 500,
              color: badge.color,
              background: badge.bg,
              border: `1px solid ${badge.border}`,
              borderRadius: 20,
              padding: '3px 12px',
            }}
          >
            {badge.spinner && <Loader2 size={11} className="animate-spin" />}
            {badge.label}
          </span>
        </div>
      )}

      {/* Agent roster — vertical stacks */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {roles.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#444', fontSize: 13 }}>
            {emptyCopy}
          </div>
        ) : (
          roles.map(([role, count]) => (
            <div key={role} style={{ padding: '12px 20px 16px', cursor: 'default' }}>
              <IdleGlyph role={role} size={56} tone={roleTone(role, huntState.wolves)} />
              <p
                style={{
                  margin: '10px 0 0',
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#1a1a1a',
                  textTransform: 'capitalize',
                }}
              >
                {role}
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b6b6b', lineHeight: 1.5 }}>
                {describe(role, count)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
