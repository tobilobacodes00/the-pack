import { Loader2, RotateCcw } from 'lucide-react'
import { color } from '@/lib/theme'
import type { HuntState } from '@/events/schema'
import type { useApprovePlan } from '@/api/hunts'
import { SpendTimer } from './spend-timer'
import { PlanCard } from './plan-card'
import { HoldCard } from './hold-card'
import { CompletionCards } from './completion-cards'
import { StandoffCard } from './standoff-card'
import { BoundaryCard } from './boundary-card'

type ApproveFn = ReturnType<typeof useApprovePlan>['mutate']

const RUNNING = new Set(['running', 'hold', 'standoff', 'halted_boundary'])
const DONE = new Set(['completed', 'failed', 'stopped'])

/** Composer shows before a hunt exists and once terminal; mid-flight the footer renders exactly
 *  one step control instead, replacing the box until that step resolves. */
export function composerVisible(status: string): boolean {
  return status === 'idle' || status === 'completed' || status === 'failed' || status === 'stopped'
}

/** Terminal-state composer placeholder — shared by the live door and standalone territory. */
export function composerPlaceholder(status: string): string | undefined {
  if (status === 'completed') return 'Ask Alpha anything about what the pack found…'
  if (status === 'failed' || status === 'stopped') return 'Ask Alpha what happened, or line up the next hunt…'
  return undefined
}

function StatusMessage({
  title,
  body,
  tone,
  onRetry,
  retrying,
}: {
  title: string
  body: string
  tone: 'fail' | 'idle'
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div style={{ padding: '4px 16px 12px' }}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: tone === 'fail' ? '#F87171' : '#D4D4D4' }}>{title}</p>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: color.dim, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{body}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retrying}
          style={{
            marginTop: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            border: `1px solid ${color.border}`,
            background: color.surface,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            color: color.text,
            cursor: retrying ? 'default' : 'pointer',
            opacity: retrying ? 0.6 : 1,
          }}
        >
          {retrying ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      )}
    </div>
  )
}

interface Props {
  huntId: string | null
  huntState: HuntState
  onApprove: ApproveFn
  approving: boolean
  onEditFormation: () => void
  onOpenReward: () => void
  /** Relaunch a failed/stopped hunt from the chat (fires the same "retry" path a typed retry takes). */
  onRetry?: () => void
  retrying?: boolean
}

/** The status-driven bottom of the chat: spend·time line plus the card for the moment
 *  (plan/hold/completion/failure). Shared by the live door and standalone territory. */
export function TerritoryFooter({ huntId, huntState, onApprove, approving, onEditFormation, onOpenReward, onRetry, retrying }: Props) {
  const s = huntState.status
  const showSpend = huntId && (RUNNING.has(s) || DONE.has(s))

  return (
    <>
      {showSpend && <SpendTimer huntId={huntId!} huntState={huntState} activity={huntState.activity} />}

      {s === 'planning' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 12px', color: color.dim, fontSize: 13 }}>
          <Loader2 size={14} className="animate-spin" />
          Beta is forming the pack…
        </div>
      )}

      {s === 'plan_ready' && huntState.plan && (
        <PlanCard
          huntId={huntId}
          plan={huntState.plan}
          onApprove={onApprove}
          onEdit={onEditFormation}
          onEditFormation={onEditFormation}
          approving={approving}
        />
      )}

      {s === 'hold' && huntState.holds[0] && huntId && (
        <HoldCard huntId={huntId} hold={huntState.holds[0]} />
      )}

      {s === 'standoff' && huntState.active_standoff && (
        <StandoffCard standoff={huntState.active_standoff} />
      )}

      {s === 'halted_boundary' && huntId && (
        <BoundaryCard huntId={huntId} boundary={huntState.boundary} />
      )}

      {s === 'completed' && huntId && <CompletionCards huntId={huntId} onOpenReward={onOpenReward} />}

      {s === 'failed' && (
        <StatusMessage
          title="Hunt failed"
          body="The pack couldn't finish this one."
          tone="fail"
          onRetry={onRetry}
          retrying={retrying}
        />
      )}

      {s === 'stopped' && (
        <StatusMessage
          title="Hunt stopped"
          body="You stopped the hunt before it finished."
          tone="idle"
          onRetry={onRetry}
          retrying={retrying}
        />
      )}
    </>
  )
}
