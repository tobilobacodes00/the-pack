import { X } from 'lucide-react'
import type { WolfState } from '@/events/schema'
import { wolfLabel } from '@/features/reward/lib/wolf-label'
import { color } from '@/lib/theme'
import { IdleGlyph, toneColor, type AgentTone } from './agent-glyph'
import { wolfActivity } from './wolf-activity'

/** Tone for a wolf (mirrors graph-canvas.wolfTone), used for the inspector's colour + status pill. */
function tone(w: WolfState): AgentTone {
  if (w.status === 'done') return 'done'
  if (w.status === 'strayed' || w.status === 'error') return 'strayed'
  if (w.status === 'healing') return 'healing'
  return 'active'
}

const STATUS_PILL: Record<AgentTone, { text: string; bg: string; fg: string }> = {
  idle: { text: 'idle', bg: '#f0f0ee', fg: '#6b6b6b' },
  active: { text: 'working', bg: 'rgba(224,145,43,0.14)', fg: '#9a6a1a' },
  done: { text: 'done', bg: 'rgba(34,197,94,0.15)', fg: '#2f8f4f' },
  strayed: { text: 'recovering', bg: '#eeeeec', fg: '#7a7a7a' },
  healing: { text: 'being healed', bg: 'rgba(34,184,207,0.15)', fg: '#0f8a9c' },
}

// Human labels for the phases/tools that land in phaseHistory, for the timeline row.
const PHASE_LABEL: Record<string, string> = {
  thinking: 'thinking', searching: 'searched', reading: 'read sources',
  merging: 'cross-referenced', writing: 'drafted', critiquing: 'challenged claims',
  forge: 'made files', web_search: 'searched', web_fetch: 'read a page',
}

function phaseLabel(p: string): string {
  return PHASE_LABEL[p] ?? p.replace(/_/g, ' ')
}

const row: React.CSSProperties = { fontSize: 12, color: '#4a4a4a' }

export function WolfInspector({ wolf, onClose }: { wolf: WolfState; onClose: () => void }) {
  const t = tone(wolf)
  const lab = wolfLabel(wolf.wolf_id)
  const pill = STATUS_PILL[t]
  const accent = toneColor(wolf.role, t)
  const done = t === 'done'

  // Defensive: a wolf rehydrated from an older cached store may lack the enrichment fields.
  const phaseHistory = wolf.phaseHistory ?? []
  const toolCalls = wolf.toolCalls ?? 0

  const stats: string[] = []
  if (toolCalls > 0) stats.push(`${toolCalls} step${toolCalls === 1 ? '' : 's'}`)
  if (wolf.lastLatencyMs != null) stats.push(`${(wolf.lastLatencyMs / 1000).toFixed(1)}s last call`)
  if (wolf.lastTool) stats.push(wolf.lastTool.ok ? 'last tool ok' : 'last tool failed')
  if (wolf.cost_usd > 0) stats.push(`$${wolf.cost_usd.toFixed(3)}`)

  return (
    <div
      role="dialog"
      aria-label={`${lab.label} details`}
      style={{
        position: 'absolute', top: 16, right: 16, zIndex: 15, width: 300,
        background: color.surface, border: '1px solid #dcdcd8', borderRadius: 14,
        boxShadow: '0 8px 30px rgba(26,26,26,0.16)', overflow: 'hidden',
        animation: 'inspector-in 200ms cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      <style>{`
        @keyframes inspector-in { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }
      `}</style>

      {/* Header: glyph + name + live status pill + close */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderBottom: '1px solid #ececea' }}>
        <div style={{ width: 34, height: 34, flexShrink: 0 }}>
          <IdleGlyph role={wolf.role} size={34} tone={t} showDone />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1a1a1a' }}>{lab.label}</div>
          <div style={{ fontSize: 11.5, color: '#6b6b6b', textTransform: 'capitalize' }}>
            {wolf.role}{wolf.thinking ? ' · thinking' : ''} · {wolf.model_tier}
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: pill.fg, background: pill.bg, borderRadius: 20, padding: '3px 9px' }}>
          {pill.text}
        </span>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9a9a9a', display: 'flex', padding: 0 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* What it's doing right now */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9a9a9a', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
            {done ? 'Finished' : 'Doing now'}
          </div>
          <div style={{ fontSize: 13.5, color: '#2a2a2a', fontWeight: 500, textTransform: 'capitalize' }}>
            {wolfActivity(wolf).replace(/^is /, '')}
          </div>
        </div>

        {/* Phase timeline — the trail of what it has done, most-recent last. */}
        {phaseHistory.length > 0 && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9a9a9a', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>
              Trail
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {phaseHistory.map((p, i) => {
                const isLast = i === phaseHistory.length - 1
                const live = isLast && !done
                return (
                  <span key={`${p}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span
                      style={{
                        fontSize: 11.5, padding: '2px 8px', borderRadius: 12,
                        background: live ? accent : '#f0f0ee',
                        color: live ? '#fff' : '#5a5a5a',
                        fontWeight: live ? 600 : 500,
                      }}
                    >
                      {phaseLabel(p)}
                    </span>
                    {!isLast && <span style={{ color: '#c8c8c4', fontSize: 11 }}>→</span>}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* What it just produced — the wolf's actual latest output (last_text), never shown before. */}
        {wolf.last_text && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: '#9a9a9a', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 }}>
              Latest
            </div>
            <p style={{ ...row, margin: 0, lineHeight: 1.5, maxHeight: 88, overflow: 'hidden' }}>
              {wolf.last_text.length > 240 ? `${wolf.last_text.slice(0, 240)}…` : wolf.last_text}
            </p>
          </div>
        )}

        {/* Stats row */}
        {stats.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', paddingTop: 2, borderTop: '1px solid #ececea', marginTop: 2 }}>
            {stats.map((s, i) => (
              <span key={i} style={{ fontSize: 11.5, color: '#7a7a7a' }}>{s}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
