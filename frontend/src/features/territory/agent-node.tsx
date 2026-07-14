import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { WolfState } from '@/events/schema'
import { wolfLabel } from '@/features/reward/lib/wolf-label'
import { IdleGlyph, toneColor, type AgentTone } from './agent-glyph'

// Glyph rendering lives in agent-glyph (no @xyflow/react dep) so the landing can reuse it
// without dragging React Flow onto its critical path. Re-exported for existing importers.
export { IdleGlyph, toneColor } from './agent-glyph'
export type { AgentTone } from './agent-glyph'

export type AgentNodeData = {
  role: string
  wolfId?: string
  tone?: AgentTone
  live?: WolfState
  /** True when this node is the one the user has clicked to inspect. */
  selected?: boolean
  /** Click handler — selects this wolf so the inspector card opens anchored to it. */
  onSelect?: (wolfId: string) => void
}
type AgentNodeType = Node<AgentNodeData, 'agentNode'>

const SIZE = 80

/** A slowly-rotating dashed orbit that marks the agent currently working. */
function OrbitRing({ color }: { color: string }) {
  return (
    <svg
      width={SIZE + 12}
      height={SIZE + 12}
      viewBox="0 0 92 92"
      className="animate-[spin_15s_linear_infinite]"
      style={{ position: 'absolute', top: -6, left: -6, pointerEvents: 'none' }}
    >
      <circle cx="46" cy="46" r="43" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="3 7" opacity="0.85" />
    </svg>
  )
}

/** One-word state label under the glyph so the pack's state is legible WITHOUT hovering. */
function toneWord(tone: AgentTone): { text: string; color: string } | null {
  switch (tone) {
    case 'active': return { text: 'working', color: '#8a7a4a' }
    case 'done': return { text: 'done', color: '#3f9d5a' }
    case 'strayed': return { text: 'recovering', color: '#9a9a9a' }
    case 'healing': return { text: 'healing', color: '#1a9aad' }
    default: return null
  }
}

export function AgentNode({ data }: NodeProps<AgentNodeType>) {
  const tone = data.tone ?? 'idle'
  const clickable = !!(data.wolfId && data.onSelect && data.live)
  const label = data.wolfId ? wolfLabel(data.wolfId) : null
  const word = toneWord(tone)
  const accent = toneColor(data.role, tone)

  return (
    <div
      style={{
        width: SIZE,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        cursor: clickable ? 'pointer' : 'default',
      }}
      onClick={clickable ? () => data.onSelect!(data.wolfId!) : undefined}
      title={label ? label.label : data.role}
    >
      <div style={{ width: SIZE, height: SIZE, position: 'relative' }}>
        {tone === 'active' && <OrbitRing color={accent} />}

        {/* Selected halo — a soft ring in the wolf's colour marking the inspected node. */}
        {data.selected && (
          <div
            className="node-selected-halo"
            style={{
              position: 'absolute', inset: -7, borderRadius: '50%',
              border: `2px solid ${accent}`, pointerEvents: 'none',
            }}
          />
        )}

        {/* The glyph itself. `.node-breathe` gently pulses an active wolf; `.node-done-settle`
            plays once when it finishes; a strayed wolf is dimmed (no shake — refined). */}
        <div
          className={
            tone === 'active' ? 'node-breathe' : tone === 'done' ? 'node-done-settle' : undefined
          }
          style={{ opacity: tone === 'strayed' ? 0.55 : 1, transition: 'opacity 400ms ease' }}
        >
          <IdleGlyph role={data.role} tone={tone} showDone />
        </div>
      </div>

      {/* Always-visible caption: which wolf + its state, so the pack reads at a glance without hover. */}
      {label && (
        <div style={{ marginTop: 5, textAlign: 'center', pointerEvents: 'none', width: SIZE + 40 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#2a2a2a', lineHeight: 1.1 }}>
            {label.label}
          </div>
          {word && (
            <div style={{ fontSize: 10, fontWeight: 500, color: word.color, marginTop: 1 }}>
              {word.text}
            </div>
          )}
        </div>
      )}

      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
      {/* Side handles: used only for the horizontal Elder→Alpha "tap" edge (a clean straight line). */}
      <Handle id="ls" type="source" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
      <Handle id="rt" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
    </div>
  )
}
