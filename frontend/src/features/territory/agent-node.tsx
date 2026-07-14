import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps, Node } from '@xyflow/react'
import type { WolfState } from '@/events/schema'
import { ROLE_DESC } from './roles'
import { wolfActivity } from './wolf-activity'
import { IdleGlyph, toneColor, type AgentTone } from './agent-glyph'

// Glyph rendering lives in agent-glyph (no @xyflow/react dep) so the landing can reuse it
// without dragging React Flow onto its critical path. Re-exported for existing importers.
export { IdleGlyph, toneColor } from './agent-glyph'
export type { AgentTone } from './agent-glyph'

export type AgentNodeData = { role: string; wolfId?: string; tone?: AgentTone; live?: WolfState }
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

export function AgentNode({ data }: NodeProps<AgentNodeType>) {
  const [hovered, setHovered] = useState(false)
  const tone = data.tone ?? 'idle'

  return (
    <div
      style={{ width: SIZE, height: SIZE, position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {tone === 'active' && <OrbitRing color={toneColor(data.role, tone)} />}
      <IdleGlyph role={data.role} tone={tone} />

      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            marginLeft: 10,
            background: '#ffffff',
            border: '1px solid #dcdcd8',
            borderRadius: 8,
            padding: '9px 13px',
            width: 240,
            pointerEvents: 'none',
            zIndex: 1000,
          }}
        >
          <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', textTransform: 'capitalize', margin: 0 }}>
            {data.role}
          </p>
          {/* While the hunt runs, show what this agent is doing right now; otherwise its role blurb. */}
          <p style={{ fontSize: 12.5, color: '#4a4a4a', margin: '3px 0 0', lineHeight: 1.45 }}>
            {data.live ? wolfActivity(data.live) : (ROLE_DESC[data.role] ?? '')}
          </p>
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
