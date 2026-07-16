import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { HuntState } from '@/events/schema'
import type { MessageItem, useApprovePlan } from '@/api/hunts'
import type { AskAction } from '@/hooks/use-ask-stream'
import { toast } from '@/store/toast-store'
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

  const qc = useQueryClient()
  const navigate = useNavigate()
  // React to what the chat's Alpha DID beyond replying: a refine re-worked the brief (refresh the
  // reward's reading view + format tabs), a follow-up hunt was launched (surface it so the Packmaster
  // can jump to the new hunt as it runs).
  const onAskAction = useCallback(
    (action: AskAction, newHuntId: string | null) => {
      if (action === 'refined') {
        void qc.invalidateQueries({ queryKey: ['hunts', huntId, 'artifact'] })
        void qc.invalidateQueries({ queryKey: ['hunts', huntId, 'artifacts'] })
        toast({ title: 'Brief updated', description: 'Alpha re-worked the brief above.', variant: 'default' })
      } else if ((action === 'subhunt' || action === 'new_hunt') && newHuntId) {
        // A follow-up is a NEW hunt that lands in plan_ready awaiting approval — navigate there (like
        // retry below) so the Packmaster approves the plan and watches it run, instead of leaving it to
        // starve at the approval gate and get reaped as failed on the next engine restart.
        void qc.invalidateQueries({ queryKey: ['hunts'] })
        toast({
          title: action === 'subhunt' ? 'Digging deeper' : 'New hunt launched',
          description:
            action === 'subhunt'
              ? "Taking you to it — approve the plan and the pack folds it into your brief."
              : 'Taking you to the new hunt.',
          variant: 'default',
        })
        navigate(`/hunts/${newHuntId}`)
      } else if (action === 'retry' && newHuntId) {
        // Alpha re-ran the job — navigate to the fresh hunt so the Packmaster watches it run.
        void qc.invalidateQueries({ queryKey: ['hunts'] })
        toast({ title: 'Running it again', description: 'Taking you to the new run.', variant: 'default' })
        navigate(`/hunts/${newHuntId}`)
      }
    },
    [qc, huntId, navigate],
  )

  const door = useDoorLogic({
    initialPhase: 'territory',
    initialHuntId: huntId,
    seedMessages,
    onAskAction,
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
