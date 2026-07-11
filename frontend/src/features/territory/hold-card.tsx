import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { ChoiceCard } from './choice-card'
import type { ChoiceOption } from './choice-card'
import { useResolveHold } from '@/api/hunts'
import type { HoldState } from '@/events/schema'

/** Split the hold's question into a punchy title + body, matching the design's card layout. */
function splitQuestion(q: string): { title: string; body?: string } {
  const nl = q.indexOf('\n')
  if (nl > 0) return { title: q.slice(0, nl).trim(), body: q.slice(nl + 1).trim() }
  return { title: q }
}

/**
 * The pack is blocked awaiting the user's call — a clarifying question, a conflicting-data hold, or a
 * permission-to-send. All three are the same backend hold mechanism; Submit resolves it with the
 * chosen option (Skip resolves with Alpha's recommended one), unblocking the hunt.
 */
export function HoldCard({ huntId, hold }: { huntId: string; hold: HoldState }) {
  const recIdx = hold.options.findIndex((o) => o === hold.recommended)
  const [selected, setSelected] = useState<number | null>(recIdx >= 0 ? recIdx : null)
  const { mutate, isPending } = useResolveHold(huntId)

  const { title, body } = splitQuestion(hold.question)
  const options: ChoiceOption[] = hold.options.map((label) => ({
    label,
    icon: /tell alpha|differently|add something|myself|i'?ll add/i.test(label) ? <Pencil size={14} /> : undefined,
  }))

  const submit = () => {
    if (selected != null) mutate({ holdId: hold.hold_id, resolution: hold.options[selected] })
  }
  const skip = () => mutate({ holdId: hold.hold_id, resolution: hold.recommended })

  return (
    <ChoiceCard
      title={title}
      description={body}
      options={options}
      selected={selected}
      onSelect={setSelected}
      onSubmit={submit}
      onSkip={skip}
      submitting={isPending}
    />
  )
}
