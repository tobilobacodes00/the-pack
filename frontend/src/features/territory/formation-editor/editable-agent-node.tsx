import { Handle, NodeToolbar, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { IdleGlyph } from '../agent-node'
import { color } from '@/lib/theme'

const SIZE = 80

export type EditableNodeData = {
  role: string
  wolfId: string
  selected: boolean
  added: boolean
  hasNote: boolean
  canAdd: boolean
  onSelect: (wolfId: string) => void
  onSpawn: (role: string) => void
  onRemove: (role: string) => void
}

type EditableNode = Node<EditableNodeData, 'editableAgent'>

const toolBtn: React.CSSProperties = {
  background: color.raised, border: `1px solid ${color.border}`, color: color.text,
  borderRadius: 8, padding: '4px 9px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

/** The Edit-mode node: same grey glyph as the read-only canvas, plus a click-to-select ring, a
 *  note badge, and a hover/selected toolbar to spawn one more of this role or remove an added one. */
export function EditableAgentNode({ data }: NodeProps<EditableNode>) {
  const d = data
  return (
    <div
      onClick={(e) => { e.stopPropagation(); d.onSelect(d.wolfId) }}
      style={{ width: SIZE, height: SIZE, position: 'relative', cursor: 'pointer' }}
    >
      {d.selected && (
        <div style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: `2px solid ${color.dim}`, pointerEvents: 'none' }} />
      )}

      <IdleGlyph role={d.role} />

      {d.hasNote && (
        <div
          title="Has a note"
          style={{
            position: 'absolute', top: 0, right: 0, width: 18, height: 18, borderRadius: '50%',
            background: color.text, color: color.canvas, fontSize: 10, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${color.raised}`,
          }}
        >
          ✎
        </div>
      )}

      <NodeToolbar isVisible={d.selected} position={Position.Right} offset={10}>
        <div style={{ display: 'flex', gap: 6 }}>
          {d.canAdd && (
            <button onClick={(e) => { e.stopPropagation(); d.onSpawn(d.role) }} style={toolBtn} title={`Add another ${d.role}`}>
              +1
            </button>
          )}
          {d.added && (
            <button
              onClick={(e) => { e.stopPropagation(); d.onRemove(d.role) }}
              style={{ ...toolBtn, color: '#F87171' }}
              title="Remove this agent"
            >
              Remove
            </button>
          )}
        </div>
      </NodeToolbar>

      {/* Hidden handles so the derived dashed spine edges render (never user-connectable). */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
      <Handle id="ls" type="source" position={Position.Left} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
      <Handle id="rt" type="target" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} isConnectable={false} />
    </div>
  )
}
