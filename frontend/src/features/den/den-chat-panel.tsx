import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Clock, Loader2, Bookmark, Settings } from 'lucide-react'
import { useHunts, useHuntMessages } from '@/api/hunts'
import { formatRelative } from '@/lib/format'
import { MessageBubble } from '@/features/intake/message-bubble'
import { color } from '@/lib/theme'

const LIVE = new Set(['planning', 'plan_ready', 'running', 'hold', 'standoff', 'halted_boundary'])

function spent(cost: number): string {
  if (!cost) return '$0.00'
  return cost < 0.01 ? `$${cost.toFixed(3)}` : `$${cost.toFixed(2)}`
}

/**
 * The Den's right panel. Two modes: "Chat History" (browse Past Hunts) and, on selecting a row,
 * "Chat session" (that hunt's durable transcript, read-only). Reuses the live chat's bubble styling.
 */
export function DenChatPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  // Return to the exact hunt the history was opened from (passed via router state), not a fuzzy history pop.
  const backTo = (location.state as { from?: string } | null)?.from
  const goBack = () => (backTo ? navigate(backTo) : navigate(-1))
  const [selected, setSelected] = useState<string | null>(null)
  const { data: huntData, isLoading } = useHunts(undefined, 50)
  const { data: messages } = useHuntMessages(selected ?? '')
  const hunts = huntData?.hunts ?? []

  const shell = 'w-[340px] h-full flex flex-col min-h-0'
  const shellStyle = { background: color.surface, border: `1px solid ${color.border}`, borderRadius: 16 } as const

  if (selected) {
    return (
      <div className={shell} style={shellStyle}>
        <div className="flex items-center gap-2 px-3 h-[52px] shrink-0" style={{ borderBottom: `1px solid ${color.border}` }}>
          <button onClick={() => setSelected(null)} className="p-1 text-text-dim hover:text-ink-900" aria-label="Back to history">
            <ChevronLeft size={18} />
          </button>
          <span className="flex-1 text-[13px] font-semibold text-ink-900">Chat session</span>
          <Clock size={14} className="text-text-dim" />
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 flex flex-col gap-4">
          {(messages ?? []).map((m, i) => (
            <MessageBubble key={i} message={{ role: m.role as 'user' | 'alpha', text: m.text }} />
          ))}
          {(messages ?? []).length === 0 && (
            <p className="text-[13px] text-text-faint">No conversation recorded for this hunt.</p>
          )}
        </div>
        <div className="p-3 shrink-0 border-t" style={{ borderColor: color.border }}>
          <button
            onClick={() => navigate(`/hunts/${selected}`)}
            className="w-full rounded-full bg-brand-500 py-2.5 text-[13px] font-semibold text-white shadow-chunk-sm transition-transform hover:-translate-y-0.5"
          >
            Open hunt
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={shell} style={shellStyle}>
      <div className="flex items-center gap-2 px-3 h-[52px] shrink-0" style={{ borderBottom: `1px solid ${color.border}` }}>
        <button onClick={goBack} className="p-1 text-text-dim hover:text-ink-900" aria-label="Back">
          <ChevronLeft size={18} />
        </button>
        <span className="flex-1 text-[13px] font-semibold text-ink-900">Chat History</span>
      </div>

      {hunts.length === 0 && !isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <p className="text-[13px] font-medium text-text-dim">No hunts yet</p>
          <p className="text-[12px] text-text-faint">Send the pack</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">Past Hunts</p>
          {hunts.map((h) => (
            <button
              key={h.hunt_id}
              onClick={() => setSelected(h.hunt_id)}
              className="group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-cream-100"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-text">{h.title}</p>
                <p className="text-[11.5px] text-ink-500">
                  {formatRelative(h.created_at)} · {spent(h.cost_usd)} spent
                </p>
              </div>
              {LIVE.has(h.state) && <Loader2 size={14} className="animate-spin shrink-0 text-text-dim" />}
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto border-t px-2 py-2 flex flex-col gap-0.5" style={{ borderColor: color.border }}>
        <button onClick={() => navigate('/instincts')} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-700 hover:bg-cream-100">
          <Bookmark size={16} className="text-muted" /> Saved Instincts
        </button>
        <button onClick={() => navigate('/settings')} className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-700 hover:bg-cream-100">
          <Settings size={16} className="text-muted" /> App Settings
        </button>
      </div>
    </div>
  )
}
