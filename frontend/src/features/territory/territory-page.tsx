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
    <div className="relative h-dvh overflow-hidden" style={{ background: color.canvas }}>
      {/* Full-bleed canvas; the panels float on top of it. */}
      <div className="absolute inset-0 z-0 flex">
        <GraphCanvas huntState={huntState} />
      </div>

      {/* Left roster — floating overlay. Sizes itself (52px collapsed on mobile, 300px rail on desktop). */}
      <div className="absolute left-2 top-2 sm:left-3 sm:top-3 bottom-2 sm:bottom-3 z-20 flex overflow-visible">
        <LeftPanel huntState={huntState} />
      </div>

      {/* Chat — a bottom sheet on mobile, the right-side column on desktop. */}
      <div className="absolute inset-x-2 bottom-2 top-auto h-[62dvh] sm:inset-x-auto sm:right-3 sm:top-3 sm:bottom-3 sm:h-auto z-20 flex">
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
