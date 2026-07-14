import { IdleGlyph } from './agent-node'
import { wolfLabel } from '@/features/reward/lib/wolf-label'
import type { ActivityItem } from '@/events/schema'

/** One pack beat in the chat feed — the pack narrating what they're doing, in the same conversational
 *  style as Alpha's turns: the wolf's lit avatar + its coloured name + the action, in readable ink.
 *  Derived from the event stream (never the durable message log). */
export function WolfActivityLine({ item }: { item: ActivityItem }) {
  const w = wolfLabel(item.wolfId)
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 26, height: 26, flexShrink: 0, marginTop: 1 }}>
        <IdleGlyph role={w.role} size={26} tone="active" />
      </div>
      <p style={{ margin: 0, fontSize: 13.5, color: '#3a3a3a', lineHeight: 1.55 }}>
        <span style={{ color: w.color, fontWeight: 700 }}>{w.label}</span> {item.text}
      </p>
    </div>
  )
}
