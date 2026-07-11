import { type ReactNode } from 'react'
import { getHuntStore, HuntStoreContext } from './hunt-store'

/**
 * Provides the store for one hunt scope. `storeKey` is the hunt id (or 'intake' for the pre-hunt door
 * session); the registry hands back the same instance for a given key, so navigating away and back to
 * a hunt restores its exact state instead of replaying from scratch.
 */
export function HuntStoreProvider({ storeKey, children }: { storeKey: string; children: ReactNode }) {
  return <HuntStoreContext.Provider value={getHuntStore(storeKey)}>{children}</HuntStoreContext.Provider>
}
