import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { getHuntStore, HuntStoreContext } from '@/store/hunt-store'
import { useHuntStream } from './use-hunt-stream'

// A controllable WebSocket stand-in — jsdom has none, and we need to fire lifecycle events by hand.
class FakeWS {
  static instances: FakeWS[] = []
  url: string
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    FakeWS.instances.push(this)
  }
  static last() {
    return FakeWS.instances.at(-1)!
  }
}

const HUNT_CREATED = {
  event_id: 'evt_a0000',
  hunt_id: 'hunt_a',
  seq: 0,
  ts: '2026-06-12T10:00:00.000Z',
  type: 'hunt_created',
  actor: 'user',
  payload: { source: 'typed', raw_input_ref: 'art_a_raw' },
}

let keyN = 0

function harness() {
  const key = `ws-test-${++keyN}`
  const store = getHuntStore(key)
  const onStatus = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(HuntStoreContext.Provider, { value: store }, children)
  const view = renderHook(() => useHuntStream('hunt_a', { onStatus }), { wrapper })
  return { store, onStatus, ...view }
}

beforeEach(() => {
  FakeWS.instances = []
  vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useHuntStream', () => {
  it('connects from seq 0 for a fresh hunt and reports status', () => {
    const { onStatus } = harness()
    const ws = FakeWS.last()
    expect(ws.url).toContain('/hunts/hunt_a/stream?from_seq=0')
    expect(onStatus).toHaveBeenCalledWith('connecting')
    act(() => ws.onopen?.())
    expect(onStatus).toHaveBeenCalledWith('connected')
  })

  it('dispatches a valid event and ignores malformed frames', () => {
    const { store } = harness()
    const ws = FakeWS.last()
    act(() => ws.onmessage?.({ data: 'not json' })) // bad JSON → ignored
    act(() => ws.onmessage?.({ data: JSON.stringify({ nonsense: true }) })) // bad shape → ignored
    expect(store.getState().state.hunt_id).toBeNull()
    act(() => ws.onmessage?.({ data: JSON.stringify(HUNT_CREATED) })) // valid → dispatched
    expect(store.getState().state.hunt_id).toBe('hunt_a')
  })

  it('reconnects after a non-1000 close and backs off', () => {
    const { onStatus } = harness()
    act(() => FakeWS.last().onclose?.({ code: 1006 })) // abnormal close
    expect(onStatus).toHaveBeenCalledWith('reconnecting')
    expect(FakeWS.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1000)) // first backoff step
    expect(FakeWS.instances).toHaveLength(2) // a new socket opened
  })

  it('does not reconnect on a clean 1000 close', () => {
    const { onStatus } = harness()
    act(() => FakeWS.last().onclose?.({ code: 1000 }))
    expect(onStatus).toHaveBeenCalledWith('closed')
    act(() => vi.advanceTimersByTime(60_000))
    expect(FakeWS.instances).toHaveLength(1) // no reconnect
  })

  it('closes the socket cleanly on unmount', () => {
    const { unmount } = harness()
    const ws = FakeWS.last()
    unmount()
    expect(ws.close).toHaveBeenCalledWith(1000)
  })
})
