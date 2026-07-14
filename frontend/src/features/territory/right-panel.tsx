import { useMemo } from 'react'
import type { HuntState } from '@/events/schema'
import type { MessageItem, useApprovePlan } from '@/api/hunts'
import { useDoorLogic } from '../intake/use-intake'
import { ChatColumn } from '../door/chat-column'
import { HiddenFileInput } from '../door/hidden-file-input'
import { TerritoryFooter, composerVisible, composerPlaceholder } from './territory-footer'
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
        placeholder={composerPlaceholder(huntState.status)}
      />
      {/* The composer's `+` file input — hoisted out of ChatColumn so the ref stays attached. */}
      <HiddenFileInput inputRef={door.fileInputRef} onFiles={door.addFiles} />
    </div>
  )
}
