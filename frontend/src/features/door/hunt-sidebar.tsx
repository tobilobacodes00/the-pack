import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, MoreVertical, Bookmark, Settings, Trash2, PanelLeft, SquarePen } from 'lucide-react'
import { useHunts, useDeleteHuntById } from '@/api/hunts'
import { useInstincts, useDeleteInstinct } from '@/api/instincts'
import { toReusedInstinct } from '../intake/use-intake'
import { formatRelative } from '@/lib/format'
import { color } from '@/lib/theme'

/** Hunts still working (spinner on the row) vs terminal. */
const LIVE = new Set(['planning', 'plan_ready', 'running', 'hold', 'standoff', 'halted_boundary'])

function spent(cost: number): string {
  if (!cost) return '$0.00'
  return cost < 0.01 ? `$${cost.toFixed(3)}` : `$${cost.toFixed(2)}`
}

function RowMenu({ items, onClose }: { items: Array<{ label: string; danger?: boolean; onClick: () => void }>; onClose: () => void }) {
  return (
    <>
      {/* click-catcher */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div
        style={{
          position: 'absolute', top: '100%', right: 8, marginTop: 2, zIndex: 41,
          background: color.borderSubtle, border: `1px solid ${color.border}`, borderRadius: 10, padding: 4,
          minWidth: 150, boxShadow: '0 8px 24px rgba(26,26,26,0.14)',
        }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            onClick={(e) => { e.stopPropagation(); it.onClick(); onClose() }}
            style={{
              display: 'flex', width: '100%', textAlign: 'left', background: 'none', border: 'none',
              color: it.danger ? '#EF4444' : '#3a3a3a', fontSize: 13, padding: '8px 10px',
              borderRadius: 7, cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(26,26,26,0.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  )
}

function Header({ onCollapse }: { onCollapse: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center gap-3 px-4 h-[52px] shrink-0 border-b" style={{ borderColor: color.border }}>
      <button 
        onClick={() => navigate('/')} 
        className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity"
      >
        <img src="/pack-logo.svg" className="w-[20px] h-[24px]" alt="Pack" />
        <span className="text-sm font-semibold text-ink-900 tracking-wide">A Pack</span>
      </button>
      <button onClick={onCollapse} className="p-1 opacity-70 hover:opacity-100 transition-opacity text-text-dim hover:text-ink-900" aria-label="Collapse sidebar">
        <PanelLeft size={18} />
      </button>
    </div>
  )
}

function Tabs({ tab, setTab }: { tab: 'hunts' | 'instincts'; setTab: (t: 'hunts' | 'instincts') => void }) {
  return (
    <div className="flex gap-1 px-3 pt-3 pb-2">
      {(['hunts', 'instincts'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className="rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors"
          style={
            tab === t
              ? { background: color.raised, color: color.text }
              : { background: 'none', color: '#6b6b6b' }
          }
        >
          {t === 'hunts' ? 'Past Hunts' : 'Saved instincts'}
        </button>
      ))}
    </div>
  )
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
      <p className="text-[13px] font-medium text-text-dim">{title}</p>
      <p className="text-[12px] text-text-faint">{sub}</p>
    </div>
  )
}

interface Props {
  onCollapse: () => void
}

/** The Door's Past-Hunts / Saved-instincts sidebar (Entry Point 1). */
export function HuntSidebar({ onCollapse }: Props) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'hunts' | 'instincts'>('hunts')
  const [menuId, setMenuId] = useState<string | null>(null)

  const { data: huntData, isLoading: huntsLoading } = useHunts(undefined, 50)
  const { data: instincts, isLoading: instLoading } = useInstincts()
  const deleteHunt = useDeleteHuntById()
  const deleteInstinct = useDeleteInstinct()

  const hunts = huntData?.hunts ?? []

  return (
    <div className="w-[85vw] max-w-[300px] sm:w-[300px] h-full flex flex-col min-h-0" style={{ background: color.surface, borderRight: `1px solid ${color.border}` }}>
      <Header onCollapse={onCollapse} />
      
      <div className="px-3 pt-4 pb-1">
        <button
          onClick={() => navigate('/')}
          className="w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium text-text bg-[rgba(26,26,26,0.04)] hover:bg-[rgba(26,26,26,0.08)] transition-colors border"
          style={{ borderColor: color.border }}
        >
          <SquarePen size={16} className="text-text-dim" />
          <span>New Hunt</span>
        </button>
      </div>

      <Tabs tab={tab} setTab={setTab} />
      <div className="h-px mx-3" style={{ background: color.border }} />

      {tab === 'hunts' ? (
        hunts.length === 0 && !huntsLoading ? (
          <Empty title="No hunts yet" sub="Send the pack" />
        ) : (
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-text-faint">Past Hunts</p>
            {hunts.map((h) => (
              <div
                key={h.hunt_id}
                onClick={() => navigate(`/hunts/${h.hunt_id}`)}
                className="group relative flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors hover:bg-cream-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-text">{h.title}</p>
                  <p className="text-[11.5px] text-ink-500">
                    {formatRelative(h.created_at)} · {spent(h.cost_usd)} spent
                  </p>
                </div>
                {LIVE.has(h.state) ? (
                  <Loader2 size={14} className="animate-spin shrink-0 text-text-dim" />
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setMenuId(menuId === h.hunt_id ? null : h.hunt_id) }}
                    className="shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 text-muted hover:text-text"
                    aria-label="More"
                  >
                    <MoreVertical size={16} />
                  </button>
                )}
                {menuId === h.hunt_id && (
                  <RowMenu
                    onClose={() => setMenuId(null)}
                    items={[
                      // Saving an Instinct lives in the Reward modal — a row here has no pack shape,
                      // only the title.
                      {
                        label: 'Delete',
                        danger: true,
                        onClick: () => deleteHunt.mutate(h.hunt_id),
                      },
                    ]}
                  />
                )}
              </div>
            ))}
          </div>
        )
      ) : instincts && instincts.length === 0 && !instLoading ? (
        <Empty title="No instincts yet" sub="Save one from a hunt" />
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {(instincts ?? []).map((it) => (
            <div
              key={it.instinct_id}
              className="group relative flex items-center gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-cream-100"
            >
              <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{it.label}</p>
              <button
                onClick={() => navigate('/', { state: { instinct: toReusedInstinct(it) } })}
                className="shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] text-ink-700 hover:text-ink-900"
                style={{ borderColor: color.border }}
              >
                Use This
              </button>
              <button
                onClick={() => deleteInstinct.mutate(it.instinct_id)}
                className="shrink-0 opacity-60 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 text-muted hover:text-[#EF4444]"
                aria-label="Delete instinct"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto border-t px-2 py-2 flex flex-col gap-0.5" style={{ borderColor: color.border }}>
        <button
          onClick={() => navigate('/instincts')}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-700 hover:bg-cream-100 transition-colors"
        >
          <Bookmark size={16} className="text-muted" /> Saved Instincts
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-700 hover:bg-cream-100 transition-colors"
        >
          <Settings size={16} className="text-muted" /> App Settings
        </button>
      </div>
    </div>
  )
}
