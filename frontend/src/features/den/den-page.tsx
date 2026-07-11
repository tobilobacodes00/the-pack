import { LeftPanel } from '../territory/left-panel'
import { GraphCanvas } from '../territory/graph-canvas'
import { DenChatPanel } from './den-chat-panel'
import { initialHuntState } from '@/events/reducer'
import { color } from '@/lib/theme'

/**
 * The Den (Entry Point 2) — the pack's idle home. The full idle formation sits on the canvas with the
 * roster on the left, and the right panel browses Past Hunts (Chat History) → a selected hunt's
 * transcript (Chat session). Renders from a LOCAL idle state and never touches the global hunt store,
 * so returning to the hunt you came from doesn't wipe/replay its state (no idle flash).
 */
export default function DenPage() {
  return (
    <div style={{ height: '100vh', position: 'relative', overflow: 'hidden', background: color.canvas }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 0 }}>
        <GraphCanvas huntState={initialHuntState} />
      </div>

      <div style={{ position: 'absolute', left: 12, top: 12, bottom: 12, zIndex: 20, display: 'flex' }}>
        <LeftPanel huntState={initialHuntState} />
      </div>

      <div style={{ position: 'absolute', right: 12, top: 12, bottom: 12, zIndex: 20, display: 'flex' }}>
        <DenChatPanel />
      </div>
    </div>
  )
}
