import { useEffect, useRef } from 'react'
import { useToastStore } from '@/store/toast-store'
import type { HuntStatus } from '@/events/schema'

const WORKING = new Set<HuntStatus>(['running', 'hold', 'standoff', 'halted_boundary'])
const TERMINAL = new Set<HuntStatus>(['completed', 'failed', 'stopped'])

/** A sticky "the pack is on the hunt" toast that stays up the whole time the pack is working and is
 *  dismissed only when the hunt reaches a terminal state (or the view unmounts). */
export function useHuntToast(status: HuntStatus) {
  const push = useToastStore((s) => s.push)
  const dismiss = useToastStore((s) => s.dismiss)
  const idRef = useRef<string | null>(null)

  useEffect(() => {
    if (WORKING.has(status) && !idRef.current) {
      idRef.current = push({
        title: 'The pack is on the hunt',
        description: 'The Scouts are ranging — this stays up until they’re done.',
        duration: Infinity,
      })
    } else if (TERMINAL.has(status) && idRef.current) {
      dismiss(idRef.current)
      idRef.current = null
    }
  }, [status, push, dismiss])

  // Clean up if the page unmounts mid-hunt.
  useEffect(() => () => {
    if (idRef.current) {
      dismiss(idRef.current)
      idRef.current = null
    }
  }, [dismiss])
}
