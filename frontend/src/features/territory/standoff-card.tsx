import { Swords } from 'lucide-react'
import type { StandoffState } from '@/events/schema'
import { wolfLabel } from '@/features/reward/lib/wolf-label'
import { color } from '@/lib/theme'

/** standoff — two wolves disagree on a claim; Alpha adjudicates. Informational (resolves itself). */
export function StandoffCard({ standoff }: { standoff: StandoffState }) {
  const a = wolfLabel(standoff.challenger)
  const b = wolfLabel(standoff.defendant)
  return (
    <div style={{ margin: 12, background: color.raised, borderRadius: 14, padding: 18 }}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: color.text, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Swords size={16} color="#A3A3A3" /> Settling a disagreement
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: color.dim, lineHeight: 1.6 }}>
        <span style={{ color: a.color, fontWeight: 600 }}>{a.label}</span> is challenging{' '}
        <span style={{ color: b.color, fontWeight: 600 }}>{b.label}</span> on a claim. Alpha will make the
        call — no action needed.
      </p>
    </div>
  )
}
