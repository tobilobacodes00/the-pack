import { useEffect, useMemo, useState } from 'react'
import { HuntEventSchema, type HuntEvent, type HuntState } from '@/events/schema'
import { huntReducer, initialHuntState } from '@/events/reducer'

/**
 * The Flight Recorder's engine: turn a raw event log into a scrubbable timeline of HuntStates.
 *
 * The reducer is replay-safe by design (the same pure function the live canvas runs), so
 * states[i] is exactly what the canvas showed after the first i events. Unknown/malformed
 * events are skipped with the same policy as the live stream (safeParse → drop), so a log
 * from a newer backend replays instead of crashing.
 */
export interface Replay {
  /** The parsed, replayable events (unknown types already skipped). */
  events: HuntEvent[]
  /** Scrubber position: 0 = before anything happened, events.length = the full hunt. */
  index: number
  /** Manual scrub — pauses playback. */
  seek: (i: number) => void
  playing: boolean
  /** Play/pause. Pressing play at the end restarts from the beginning. */
  toggle: () => void
  /** The canvas state at the current position. */
  state: HuntState
  /** seq of the last applied event (-1 before the first). */
  currentSeq: number
}

export function useReplay(raw: unknown[] | undefined, stepMs = 350): Replay {
  const events = useMemo(() => {
    const out: HuntEvent[] = []
    for (const r of raw ?? []) {
      const parsed = HuntEventSchema.safeParse(r)
      if (parsed.success) out.push(parsed.data)
    }
    return out
  }, [raw])

  // Precompute every intermediate state once — the reducer is pure, the log is finite, and this
  // makes scrubbing O(1) instead of re-reducing on every drag tick.
  const states = useMemo(() => {
    const arr: HuntState[] = [initialHuntState]
    let s = initialHuntState
    for (const e of events) {
      s = huntReducer(s, e)
      arr.push(s)
    }
    return arr
  }, [events])

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  // A different log (new fetch) resets the recorder to the start.
  useEffect(() => {
    setIndex(0)
    setPlaying(false)
  }, [events])

  // The playback clock: one event per tick, stopping cleanly at the end.
  useEffect(() => {
    if (!playing) return
    if (index >= events.length) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex((i) => Math.min(i + 1, events.length)), stepMs)
    return () => clearTimeout(t)
  }, [playing, index, events.length, stepMs])

  const seek = (i: number) => {
    setPlaying(false)
    setIndex(Math.max(0, Math.min(i, events.length)))
  }

  const toggle = () => {
    setPlaying((p) => {
      if (!p && index >= events.length) setIndex(0) // replay from the top
      return !p
    })
  }

  return {
    events,
    index,
    seek,
    playing,
    toggle,
    state: states[index] ?? initialHuntState,
    currentSeq: index > 0 ? events[index - 1].seq : -1,
  }
}
