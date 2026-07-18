import { useCallback, useEffect, useState } from 'react'
import { useHuntStore } from '@/store/hunt-store'

/**
 * Owns the Reward modal's open state. Result lives in-chat (CompletionCards); this modal opens on
 * demand, not auto-popped on completion.
 */
export function useReward(huntId: string | null) {
  const status = useHuntStore((s) => s.state.status)
  const [open, setOpen] = useState(false)

  // New hunt → close any stale modal.
  useEffect(() => {
    setOpen(false)
  }, [huntId])

  const close = useCallback(() => setOpen(false), [])
  const openReward = useCallback(() => setOpen(true), [])

  return { open, openReward, close, completed: status === 'completed' }
}
