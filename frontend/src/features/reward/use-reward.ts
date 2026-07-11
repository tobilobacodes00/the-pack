import { useCallback, useEffect, useState } from 'react'
import { useHuntStore } from '@/store/hunt-store'

/**
 * Owns the Reward modal's open state. The result now lives IN-CHAT (CompletionCards); the full reading
 * view opens ON DEMAND — from the result card's "Open the full reading view" link and the gift button —
 * rather than auto-popping the modal on completion.
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
