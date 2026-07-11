import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAskStream } from './use-ask-stream'
import { useToastStore } from '@/store/toast-store'

/** A fake fetch Response streaming the given SSE frames, then closing. */
function sseResponse(frames: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f))
      c.close()
    },
  })
  return { ok: true, body } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  useToastStore.setState({ toasts: [] })
})

describe('useAskStream', () => {
  it('accumulates token frames into the answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"type":"token","text":"Hel"}\n\n',
          'data: {"type":"token","text":"lo"}\n\n',
          'data: [DONE]\n\n',
        ]),
      ),
    )
    const { result } = renderHook(() => useAskStream())
    await act(async () => {
      await result.current.ask('hunt-1', 'hi')
    })
    expect(result.current.answer).toBe('Hello')
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('surfaces a danger toast on a backend error frame (previously silent)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['data: {"type":"error","kind":"rate_limit"}\n\n'])),
    )
    const { result } = renderHook(() => useAskStream())
    await act(async () => {
      await result.current.ask('hunt-1', 'hi')
    })
    const toasts = useToastStore.getState().toasts
    expect(toasts.some((t) => t.variant === 'danger')).toBe(true)
  })

  it('surfaces a danger toast when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() => useAskStream())
    await act(async () => {
      await result.current.ask('hunt-1', 'hi')
    })
    expect(useToastStore.getState().toasts.some((t) => t.variant === 'danger')).toBe(true)
  })
})
