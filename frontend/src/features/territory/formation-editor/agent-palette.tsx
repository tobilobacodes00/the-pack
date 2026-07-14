import { IdleGlyph } from '../agent-node'
import { ROLE_DESC } from '../roles'
import { SPAWNABLE_ROLES } from './formation-model'
import { color } from '@/lib/theme'
import type { FormationEditorApi } from './use-formation-editor'

const card: React.CSSProperties = {
  position: 'absolute', right: 12, top: 12, bottom: 12, width: 320, zIndex: 5,
  background: color.surface, border: `1px solid ${color.border}`, borderRadius: 16,
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
}

const stepBtn = (disabled: boolean): React.CSSProperties => ({
  width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: disabled ? color.raised : color.text, color: disabled ? '#555' : color.canvas,
  border: `1px solid ${color.border}`, borderRadius: 8, fontSize: 18, fontWeight: 600, lineHeight: 1,
  cursor: disabled ? 'default' : 'pointer',
})

/** Right-hand panel: add extra agents (per-role, clamped) and, when an added agent is selected,
 *  write its handler note or remove it. */
export function AgentPalette({ ed }: { ed: FormationEditorApi }) {
  const info = ed.selectedInfo

  return (
    <div style={card}>
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${color.border}` }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: color.text }}>Edit Formation</p>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: color.dim, lineHeight: 1.5 }}>
          Add agents to the pack. Core roles always run. Select an added agent to give it a note.
        </p>
      </div>

      {/* Add agents */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {SPAWNABLE_ROLES.map((role) => {
          const cap = ed.capacity(role)
          const full = cap.count >= cap.max
          return (
            <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px' }}>
              <IdleGlyph role={role} size={40} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: color.text, textTransform: 'capitalize' }}>
                  {role} <span style={{ color: '#6b6b6b', fontWeight: 500 }}>{cap.count}/{cap.max}</span>
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b6b6b', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ROLE_DESC[role] ?? ''}
                </p>
              </div>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={() => ed.removeRole(role)}
                  disabled={cap.count <= cap.min}
                  title={`Remove a ${role}`}
                  aria-label={`Remove a ${role}`}
                  style={stepBtn(cap.count <= cap.min)}
                >
                  −
                </button>
                <button
                  onClick={() => ed.spawn(role)}
                  disabled={full}
                  title={`Add a ${role}`}
                  aria-label={`Add a ${role}`}
                  style={stepBtn(full)}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Selected-agent inspector */}
      <div style={{ borderTop: `1px solid ${color.border}`, padding: 16, minHeight: 132 }}>
        {!info ? (
          <p style={{ margin: 0, fontSize: 13, color: '#6b6b6b', lineHeight: 1.5 }}>
            Select an added agent on the canvas to write its note.
          </p>
        ) : info.added ? (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: color.text }}>
              Note for <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{info.role}</span>{' '}
              <span style={{ color: '#6b6b6b' }}>({info.wolfId})</span>
            </p>
            <textarea
              value={info.note}
              onChange={(e) => ed.setNote(info.wolfId, e.target.value)}
              placeholder="e.g. focus on primary sources from the last 6 months"
              rows={3}
              style={{
                width: '100%', resize: 'none', background: '#ffffff', border: `1px solid ${color.border}`,
                borderRadius: 10, color: '#1a1a1a', fontSize: 13, padding: '8px 10px', outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.4,
              }}
            />
            <button
              onClick={() => ed.removeRole(info.role)}
              style={{
                marginTop: 8, background: 'none', border: `1px solid ${color.border}`, borderRadius: 8,
                color: '#F87171', fontSize: 12, padding: '5px 12px', cursor: 'pointer',
              }}
            >
              Remove this agent
            </button>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: color.dim, lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, textTransform: 'capitalize', color: color.text }}>{info.role}</span> is a
            core agent — it always runs. Add extra agents to give them notes.
          </p>
        )}
      </div>
    </div>
  )
}
