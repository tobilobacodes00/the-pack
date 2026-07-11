import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HuntState } from '@/events/schema'
import type { MessageItem, useApprovePlan } from '@/api/hunts'
import { useDoorLogic } from '../intake/use-intake'
import { ChatColumn } from '../door/chat-column'
import { TerritoryFooter, composerVisible } from './territory-footer'
import { color } from '@/lib/theme'

type ApproveFn = ReturnType<typeof useApprovePlan>['mutate']

interface RightPanelProps {
  huntId: string
  huntState: HuntState
  messages: MessageItem[]
  onApprove: ApproveFn
  onEditFormation: () => void
  onOpenReward: () => void
  approving: boolean
}

/**
 * Standalone territory chat panel (deep-link / refresh). Uses the same
 * `ChatColumn` as the live door, seeded with the durable transcript, so the
 * experience is identical however you arrived.
 */
export function RightPanel({ huntId, huntState, messages, onApprove, onEditFormation, onOpenReward, approving }: RightPanelProps) {
  const navigate = useNavigate()
  const seedMessages = useMemo(
    () => messages.map((m) => ({ role: m.role, text: m.text })),
    [messages],
  )

  const door = useDoorLogic({
    initialPhase: 'territory',
    initialHuntId: huntId,
    seedMessages,
  })

  const footer = (
    <TerritoryFooter
      huntId={huntId}
      huntState={huntState}
      onApprove={onApprove}
      approving={approving}
      onEditFormation={onEditFormation}
      onOpenReward={onOpenReward}
    />
  )

  return (
    <div
      className="w-[320px] shrink-0 h-full flex flex-col min-h-0 overflow-hidden"
      style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: 16 }}
    >
      <ChatColumn
        variant="territory"
        {...door}
        footer={footer}
        hideComposer={!composerVisible(huntState.status)}
        activity={huntState.activity}
        onHistory={() => navigate('/den', { state: { from: `/hunts/${huntId}` } })}
        placeholder={
          ['completed', 'failed', 'stopped'].includes(huntState.status)
            ? 'Ask Alpha anything about this plan…'
            : undefined
        }
      />
    </div>
  )
}
