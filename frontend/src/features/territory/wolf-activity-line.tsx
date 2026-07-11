import { IdleGlyph } from './agent-node'
import { wolfLabel } from '@/features/reward/lib/wolf-label'
import type { ActivityItem } from '@/events/schema'

/** One inline pack beat in the chat — a small role avatar + the wolf's coloured name + what it did.
 *  Derived from the event stream (never the durable message log). */
export function WolfActivityLine({ item }: { item: ActivityItem }) {
  const w = wolfLabel(item.wolfId)
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 26, height: 26, flexShrink: 0, marginTop: 1 }}>
        <IdleGlyph role={w.role} size={26} />
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: '#B4B4B4', lineHeight: 1.5 }}>
        <span style={{ color: w.color, fontWeight: 600 }}>{w.label}</span> {item.text}
      </p>
    </div>
  )
}
