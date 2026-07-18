import { useEffect, useRef } from 'react'
import { env } from '@/env'
import { HuntEventSchema } from '@/events/schema'
import { useHuntStore, useHuntStoreApi } from '@/store/hunt-store'

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const

/**
 * Resolve the gateway base into an absolute ws(s):// URL. VITE_GATEWAY_URL may be absolute
 * (`ws://host`) or a same-origin relative path (`/ws`, proxied by nginx/a tunnel) — `new WebSocket()`
 * rejects a bare relative path, so rebase onto the page origin, matching wss to https (a `ws://`
 * socket from an https page is blocked as mixed content). Without this the stream never connects
 * behind a same-origin proxy and the hunt appears frozen.
 */
function resolveGatewayBase(raw: string): string {
  if (/^wss?:\/\//i.test(raw)) return raw // already absolute ws(s)://
  if (/^https?:\/\//i.test(raw)) return raw.replace(/^http/i, 'ws') // absolute http(s) → ws(s)
  // Same-origin relative path (e.g. "/ws"): rebase onto the page origin, http→ws / https→wss.
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${scheme}://${window.location.host}${path}`
}

type Status = 'connecting' | 'connected' | 'reconnecting' | 'closed'

interface UseHuntStreamOptions {
  onStatus?: (status: Status) => void
}

export function useHuntStream(huntId: string | null, options?: UseHuntStreamOptions) {
  const store = useHuntStoreApi()
  const dispatch = useHuntStore((s) => s.dispatch)
  const lastSeqRef = useRef(-1)
  // Read the latest onStatus via a ref, not the effect's deps — an inline callback is a new
  // reference every render, which would tear down and reconnect the socket every render.
  const onStatusRef = useRef(options?.onStatus)
  onStatusRef.current = options?.onStatus

  useEffect(() => {
    if (!huntId) return
    const onStatus = (s: Status) => onStatusRef.current?.(s)
    // If the store already holds this hunt, resume from its last seq instead of replaying from 0 —
    // a full replay re-runs hunt_created→idle→…→done and flashes the idle pack.
    const snap = store.getState().state
    lastSeqRef.current = snap.hunt_id === huntId ? snap.last_seq : -1

    let attempt = 0
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let dead = false

    function connect() {
      if (dead) return
      onStatus?.('connecting')

      const fromSeq = lastSeqRef.current + 1
      const base = resolveGatewayBase(env.VITE_GATEWAY_URL)
      const url = `${base}/hunts/${huntId}/stream?from_seq=${fromSeq}`
      ws = new WebSocket(url)

      ws.onopen = () => {
        attempt = 0
        onStatus?.('connected')
      }

      ws.onmessage = ({ data }: MessageEvent<string>) => {
        let raw: unknown
        try {
          raw = JSON.parse(data)
        } catch {
          return
        }
        const result = HuntEventSchema.safeParse(raw)
        if (!result.success) {
          console.warn('[ws] unrecognised event shape', raw)
          return
        }
        lastSeqRef.current = Math.max(lastSeqRef.current, result.data.seq)
        dispatch(result.data)
      }

      ws.onclose = ({ code }) => {
        if (dead || code === 1000) {
          onStatus?.('closed')
          return
        }
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 30_000
        attempt++
        onStatus?.('reconnecting')
        timer = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      dead = true
      if (timer !== null) clearTimeout(timer)
      ws?.close(1000)
    }
  }, [huntId, dispatch, store])
}