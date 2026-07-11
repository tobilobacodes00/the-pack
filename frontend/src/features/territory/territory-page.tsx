import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { color } from '@/lib/theme'
import { useTerritory } from './use-territory'
import { LeftPanel } from './left-panel'
import { GraphCanvas } from './graph-canvas'
import { RightPanel } from './right-panel'
import { FormationEditor } from './formation-editor/formation-editor'
import { useHuntStore } from '@/store/hunt-store'
import { RewardModal } from '@/features/reward/reward-modal'
import { useReward } from '@/features/reward/use-reward'
import { useHuntToast } from './use-hunt-toast'

export default function TerritoryPage() {
  const { huntId } = useParams<{ huntId: string }>()
  const { huntState, messages, approvePlan, isPending } = useTerritory(huntId!)
  const applyLocalEdits = useHuntStore((s) => s.applyLocalEdits)
  const [editing, setEditing] = useState(false)
  const canEdit = huntState.status === 'plan_ready' && huntState.plan !== null
  const reward = useReward(huntId!)
  useHuntToast(huntState.status)

  return (
    <div
      style={{
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: color.canvas,
      }}
    >
      {/* Full-bleed canvas; the sidebars float on top of it. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 0 }}>
        <GraphCanvas huntState={huntState} />
      </div>

      {/* Left roster — floating overlay */}
      <div style={{ position: 'absolute', left: 12, top: 12, bottom: 12, zIndex: 20, display: 'flex' }}>
        <LeftPanel huntState={huntState} />
      </div>

      {/* Chat — floating overlay */}
      <div style={{ position: 'absolute', right: 12, top: 12, bottom: 12, zIndex: 20, display: 'flex' }}>
        <RightPanel
          huntId={huntId!}
          huntState={huntState}
          messages={messages}
          onApprove={approvePlan}
          onEditFormation={() => setEditing(true)}
          onOpenReward={reward.openReward}
          approving={isPending}
        />
      </div>

      {/* Edit Formations — full-canvas editor overlay */}
      {editing && canEdit && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
          <FormationEditor
            plan={huntState.plan}
            onSave={(edits) => { applyLocalEdits(edits); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}

      {/* The Reward — a large reading-view modal, opened by clicking the inline result card in the chat. */}
      <RewardModal huntId={huntId!} open={reward.open} onClose={reward.close} />
    </div>
  )
}
