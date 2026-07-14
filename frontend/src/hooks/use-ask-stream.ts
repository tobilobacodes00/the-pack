import { useState, useCallback, useEffect, useRef } from 'react'
import { env } from '@/env'
import { toast } from '@/store/toast-store'

const ERROR_COPY: Record<string, string> = {
  rate_limit: 'Alpha is rate-limited right now — give it a moment and try again.',
  content_filter: "That request tripped the model's content filter.",
  unknown: "Alpha's reply stopped unexpectedly. Please try again.",
}

/** One prior turn, in the wire shape the ask endpoints expect ('assistant' = Alpha). */
export type AskTurn = { role: 'user' | 'assistant'; content: string }

/** What Alpha DID with the turn, so the caller can react — refresh the brief on a refine, track a
 *  spawned follow-up hunt, etc. Mirrors the backend AskReply.action. */
export type AskAction = 'answer' | 'refined' | 'subhunt' | 'new_hunt' | 'steer' | 'retry'

/** The result of an ask: the streamed reply plus what Alpha did and any new hunt it spun off. */
export type AskResult = { reply: string; action: AskAction; huntId: string | null }

// The backend caps AskAlpha.messages at 200 and question at 10k chars — trim client-side so a long
// session degrades (drops oldest turns) instead of 422ing.
const MAX_TURNS = 200
const MAX_QUESTION = 10_000

interface UseAskStreamResult {
  answer: string
  streaming: boolean
  /** Stream Alpha's answer for `question`. `history` is the full conversation so far (ending with
   *  the question itself) so Alpha keeps the context of everything discussed; `onToken` fires per
   *  chunk (so callers can render it into their own chat bubble); resolves with the full reply
   *  text ('' if it errored/aborted). */
  ask: (
    huntId: string,
    question: string,
    onToken?: (chunk: string) => void,
    history?: AskTurn[],
  ) => Promise<AskResult>
  reset: () => void
}

export function useAskStream(): UseAskStreamResult {
  const [answer, setAnswer] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setAnswer('')
    setStreaming(false)
  }, [])

  // Abort an in-flight ask if the consumer unmounts (navigating away mid-stream) — otherwise the
  // fetch/reader keeps pulling tokens nobody will render, and the hunt's ask/stream call runs to
  // completion for no reason.
  useEffect(() => () => abortRef.current?.abort(), [])

  const ask = useCallback(async (
    huntId: string,
    question: string,
    onToken?: (chunk: string) => void,
    history?: AskTurn[],
  ): Promise<AskResult> => {
    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    setAnswer('')
    setStreaming(true)
    let full = ''
    let action: AskAction = 'answer'
    let newHuntId: string | null = null

    try {
      const res = await fetch(`${env.VITE_ENGINE_URL}/hunts/${huntId}/ask/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.slice(0, MAX_QUESTION),
          messages: (history ?? []).slice(-MAX_TURNS),
        }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error(`ask/stream failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''

        for (const part of parts) {
          if (!part.startsWith('data:')) continue
          const json = part.slice('data:'.length).trim()
          if (!json || json === '[DONE]') continue
          try {
            const msg = JSON.parse(json) as {
              type: string
              text?: string
              kind?: string
              reply?: string
              action?: AskAction
              hunt_id?: string | null
            }
            if (msg.type === 'token' && msg.text) {
              full += msg.text
              onToken?.(msg.text)
              setAnswer((prev) => prev + msg.text)
            } else if (msg.type === 'done') {
              // The dispatcher tells us what it did (refined the brief, spawned a follow-up hunt, …)
              // and, if it launched one, that hunt's id — so the caller can refresh/track it.
              action = msg.action ?? 'answer'
              newHuntId = msg.hunt_id ?? null
              if (!full && msg.reply) full = msg.reply
            } else if (msg.type === 'error') {
              toast({
                title: 'Ask Alpha failed',
                description: ERROR_COPY[msg.kind ?? 'unknown'] ?? ERROR_COPY.unknown,
                variant: 'danger',
              })
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      // AbortError is a deliberate cancel (reset / new question) — not a failure to surface.
      if ((err as Error).name !== 'AbortError') {
        console.error('[ask-stream]', err)
        toast({
          title: 'Ask Alpha failed',
          description: "Couldn't reach Alpha. Check your connection and try again.",
          variant: 'danger',
        })
      }
    } finally {
      setStreaming(false)
    }
    return { reply: full, action, huntId: newHuntId }
  }, [])

  return { answer, streaming, ask, reset }
}