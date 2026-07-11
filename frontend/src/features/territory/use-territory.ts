import { useEffect } from 'react'
import { useHuntStore, useHuntStoreApi } from '@/store/hunt-store'
import { useHuntStream } from '@/hooks/use-hunt-stream'
import { useHuntMessages, useApprovePlan } from '@/api/hunts'

export function useTerritory(huntId: string) {
  const store = useHuntStoreApi()
  const reset = useHuntStore((s) => s.reset)
  // Safety net: the store is already scoped per hunt id, so this only fires on a brand-new (empty)
  // store — a no-op — but it guards against ever showing a stale hunt's card.
  useEffect(() => {
    if (store.getState().state.hunt_id !== huntId) reset()
  }, [huntId, reset, store])
  useHuntStream(huntId)
  const huntState = useHuntStore((s) => s.state)
  const { data: messages = [] } = useHuntMessages(huntId)
  const { mutate: approvePlan, isPending } = useApprovePlan(huntId)
  return { huntState, messages, approvePlan, isPending }
}
