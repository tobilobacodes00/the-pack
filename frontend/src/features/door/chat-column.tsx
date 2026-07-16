import { Mic, Pause, Play, Plus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageBubble, type ChatMessage } from '../intake/message-bubble'
import { FileCard } from '../intake/file-chip'
import { useMicRecorder } from '../intake/use-mic-recorder'
import type { AttachedFile } from '../intake/use-intake'
import { WolfActivityLine } from '../territory/wolf-activity-line'
import type { ActivityItem } from '@/events/schema'

const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'webm'])
function isAudio(name: string) {
  return AUDIO_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '')
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00' // MediaRecorder webm blobs can report Infinity/NaN
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// Bubbly rounded-rectangle bar. Live bars (fixed=false) vary width with volume.
// Playback bars (fixed=true) use constant width so 40 bars fill the row evenly.
function Bar({ h, color, fixed = false }: { h: number; color: string; fixed?: boolean }) {
  const height = Math.max(4, h * 34)
  const width = fixed ? 3 : Math.max(3, 3 + h * 3)
  return (
    <div
      className="shrink-0"
      style={{ width, height, borderRadius: width, backgroundColor: color }}
    />
  )
}

// Live bars during recording — reacts to real mic levels at ~60fps. `tintRgb` tints the bars in
// navy ink so they read on the cream/white composer.
function LiveBars({ getLiveBars, tintRgb = '26,26,26' }: { getLiveBars: () => number[]; tintRgb?: string }) {
  const [bars, setBars] = useState<number[]>(() => Array(40).fill(0))
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const tick = () => {
      setBars(getLiveBars())
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [getLiveBars])

  return (
    <div className="flex-1 flex items-center gap-[3px] h-9 overflow-hidden">
      {bars.map((h, i) => (
        <Bar key={i} h={h} color={`rgba(${tintRgb},${0.25 + h * 0.75})`} />
      ))}
    </div>
  )
}

export interface ChatColumnProps {
  variant: 'intake' | 'territory'
  messages: ChatMessage[]
  input: string
  setInput: (v: string) => void
  attachedFiles: AttachedFile[]
  removeFile: (localId: string) => void
  addFiles: (files: FileList | File[]) => void
  isPending: boolean
  /** True while attached files are being parsed/transcribed before the turn sends — shows a hint. */
  parsingFiles?: boolean
  send: () => void | Promise<void>
  pickFiles: () => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** Rendered between the message list and the composer (e.g. the plan card). */
  footer?: React.ReactNode
  /** Hide the composer entirely — e.g. once the plan card takes over the bottom. */
  hideComposer?: boolean
  /** The pack's live beats, rendered as the pack's own narration inside the feed (territory only). */
  activity?: ActivityItem[]
  /** Index into `messages` where intake ends: turns before it are the intake convo, the pack's
   *  activity renders next, and turns from here on are post-hunt follow-up Q&A (so they sit below
   *  the report, not back up in the intake thread). null/undefined = no hunt yet (all intake). */
  launchIndex?: number | null
  /** Composer placeholder override (state-aware — e.g. "Ask Alpha anything about this plan…"). */
  placeholder?: string
}

/**
 * The chat — the through-line that stays mounted as the door morphs into the
 * territory. `variant` switches between the big centered intake composer and the
 * compact 320px side panel, but the message list + composer are the same code.
 */
export function ChatColumn(props: ChatColumnProps) {
  const {
    variant, messages, input, setInput, attachedFiles, removeFile, addFiles,
    isPending, parsingFiles, send, pickFiles,
    handleKeyDown, footer, hideComposer, activity, launchIndex, placeholder,
  } = props

  const isTerritory = variant === 'territory'

  // These refs belong to THIS ChatColumn instance. The door→territory morph remounts ChatColumn
  // (AnimatePresence popLayout, different keys), so a ref shared from the parent hook would get
  // nulled when the exiting instance unmounts. Owning them here keeps autosize/scroll/focus alive.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-grow the composer with its content (capped), following `input`.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  // The composer is shared and warm-brutalist (cream + navy ink) in both variants.
  const textCls = 'text-ink-900 placeholder:text-ink-400'
  const ghostBtn = 'text-ink-500 hover:text-ink-900'
  const mutedBtn = 'text-ink-500 hover:text-ink-900'
  const timeCls = 'text-ink-400'
  const sendBtn =
    'w-9 h-9 rounded-full bg-white border-[2px] border-ink-900 shadow-chunk-sm flex items-center justify-center disabled:opacity-30 hover:-translate-y-0.5 transition-all shrink-0'
  const waveRgb = '26,26,26'
  const waveActive = 'rgba(26,26,26,0.9)'
  const waveIdle = 'rgba(26,26,26,0.22)'

  // Voice recorder + playback state
  const [voicePeaks, setVoicePeaks] = useState<number[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [playProgress, setPlayProgress] = useState(0)
  const [playDuration, setPlayDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playRafRef = useRef<number>(0)

  const handleRecordingComplete = useCallback((file: File, peaks: number[]) => {
    addFiles([file])
    setVoicePeaks(peaks)
  }, [addFiles])

  const { isRecording, toggle: toggleMic, getLiveBars, recordingSeconds } =
    useMicRecorder(handleRecordingComplete)

  const audioFile = attachedFiles.find((f) => isAudio(f.name))
  const docFiles = attachedFiles.filter((f) => !isAudio(f.name))

  // Object URLs are a side effect — mint in an effect (not in render) so a discarded/StrictMode
  // render can't leak a URL the cleanup never revokes.
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!audioFile) {
      setAudioUrl(null)
      return
    }
    const u = URL.createObjectURL(audioFile.file)
    setAudioUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [audioFile])

  // Reset all voice state when the audio file is removed
  useEffect(() => {
    if (!audioFile) {
      audioRef.current?.pause()
      cancelAnimationFrame(playRafRef.current)
      setIsPlaying(false)
      setPlayProgress(0)
      setPlayDuration(0)
      setVoicePeaks([])
    }
  }, [audioFile])

  const startTracking = useCallback(() => {
    const tick = () => {
      const el = audioRef.current
      if (el && !el.paused && el.duration > 0) {
        setPlayProgress(el.currentTime / el.duration)
        playRafRef.current = requestAnimationFrame(tick)
      }
    }
    playRafRef.current = requestAnimationFrame(tick)
  }, [])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (isPlaying) {
      el.pause()
      cancelAnimationFrame(playRafRef.current)
      setIsPlaying(false)
    } else {
      void el.play()
      setIsPlaying(true)
      startTracking()
    }
  }, [isPlaying, startTracking])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current
    // Bail on a non-finite duration (webm blobs) — el.currentTime = ratio * Infinity throws.
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    el.currentTime = ratio * el.duration
    setPlayProgress(ratio)
  }, [])

  const discardVoiceMemo = useCallback(() => {
    if (audioFile) removeFile(audioFile.localId)
    cancelAnimationFrame(playRafRef.current)
    setIsPlaying(false)
    setPlayProgress(0)
    setPlayDuration(0)
    setVoicePeaks([])
  }, [audioFile, removeFile])

  const acts = activity ?? []
  // One feed, in time order: intake conversation → the pack narrating what they're doing → any
  // post-hunt follow-up Q&A. `launchIndex` marks where intake ends; before a hunt it's all intake.
  const cut = launchIndex ?? messages.length
  const intakeMsgs = messages.slice(0, cut)
  const followMsgs = messages.slice(cut)

  // Follow the latest turn AND the latest pack action — keep the newest thing in view as it streams.
  const lastMsgText = messages[messages.length - 1]?.text
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, acts.length, lastMsgText, messagesEndRef])

  const messageList = (messages.length > 0 || acts.length > 0) && (
    <div
      className={
        isTerritory
          ? 'flex-1 flex flex-col gap-4 overflow-y-auto min-h-0 px-4 py-4'
          : 'flex flex-col gap-5 overflow-y-auto max-h-[40vh] min-h-0'
      }
    >
      {intakeMsgs.map((m, i) => <MessageBubble key={m.id ?? i} message={m} />)}
      {acts.map((a) => <WolfActivityLine key={`act-${a.seq}`} item={a} />)}
      {followMsgs.map((m, i) => <MessageBubble key={m.id ?? `f-${i}`} message={m} />)}
      <div ref={messagesEndRef} />
    </div>
  )

  const composerBody = (
    <>
      {docFiles.length > 0 && (
        <div className="flex gap-3 flex-wrap mb-4">
          {docFiles.map((f) => (
            <FileCard key={f.localId} file={f} onRemove={removeFile} />
          ))}
        </div>
      )}
      {parsingFiles && (
        <div className="flex items-center gap-2 mb-4 text-[12.5px] text-ink-500">
          <span className="w-3 h-3 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
          Reading your files…
        </div>
      )}

      <textarea
        ref={textareaRef}
        placeholder={placeholder ?? (isTerritory ? 'Message Alpha…' : 'Describe your task, or drop a file')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        className={`w-full bg-transparent resize-none outline-none text-sm ${textCls} max-h-[120px] overflow-y-auto leading-relaxed`}
      />

      {isRecording ? (
        /* ── Recording: red dot + timer + live bars + stop ── */
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-500 text-sm font-mono tabular-nums">
              {formatTime(recordingSeconds)}
            </span>
          </div>
          <LiveBars getLiveBars={getLiveBars} tintRgb={waveRgb} />
          <button
            onClick={toggleMic}
            className={`${mutedBtn} transition-colors shrink-0`}
            aria-label="Stop recording"
          >
            <Square size={16} />
          </button>
        </div>
      ) : audioFile ? (
        /* ── Playback: play/pause + waveform + time + delete + send ── */
        <>
          <audio
            ref={audioRef}
            src={audioUrl ?? undefined}
            onEnded={() => {
              cancelAnimationFrame(playRafRef.current)
              setIsPlaying(false)
              setPlayProgress(0)
            }}
            onLoadedMetadata={(e) => {
              const el = e.target as HTMLAudioElement
              if (Number.isFinite(el.duration)) setPlayDuration(el.duration)
              // MediaRecorder webm/ogg blobs report duration === Infinity (no metadata). Nudge the
              // playhead to the end to force the browser to compute the real length → durationchange.
              else el.currentTime = 1e7
            }}
            onDurationChange={(e) => {
              const el = e.target as HTMLAudioElement
              if (!Number.isFinite(el.duration)) return
              setPlayDuration(el.duration)
              if (el.currentTime > el.duration) el.currentTime = 0 // undo the 1e7 nudge
            }}
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={togglePlay}
              className={`${mutedBtn} transition-colors shrink-0`}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>

            <div
              className="flex-1 flex items-center justify-between h-9 overflow-hidden cursor-pointer"
              onClick={handleSeek}
            >
              {voicePeaks.map((h, i) => (
                <Bar
                  key={i}
                  h={h}
                  fixed
                  color={i / voicePeaks.length <= playProgress ? waveActive : waveIdle}
                />
              ))}
            </div>

            <span className={`${timeCls} text-xs font-mono tabular-nums shrink-0`}>
              {formatTime(Math.floor(playProgress * playDuration))} / {formatTime(Math.floor(playDuration))}
            </span>

            <button
              onClick={discardVoiceMemo}
              className={`${mutedBtn} transition-colors shrink-0`}
              aria-label="Delete recording"
            >
              <X size={16} />
            </button>

            <button
              onClick={() => void send()}
              disabled={isPending}
              className={sendBtn}
              aria-label="Send"
            >
              {isPending
                ? <span className="w-3 h-3 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
                : <img src="/icon-send.svg" className="w-4 h-4" alt="" />
              }
            </button>
          </div>
        </>
      ) : (
        /* ── Normal action row ── */
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={pickFiles}
            className={`${ghostBtn} transition-colors shrink-0`}
            aria-label="Attach files"
          >
            <Plus size={18} />
          </button>

          <div className="flex-1" />

          <button
            onClick={toggleMic}
            className={`${mutedBtn} transition-colors shrink-0`}
            aria-label="Record voice"
          >
            {isTerritory ? <img src="/icon-mic.svg" className="w-5 h-5" alt="" /> : <Mic size={18} />}
          </button>

          <button
            onClick={() => void send()}
            disabled={isPending || (input.trim() === '' && attachedFiles.length === 0)}
            className={sendBtn}
            aria-label="Send"
          >
            {isPending
              ? <span className="w-3 h-3 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
              : <img src="/icon-send.svg" className="w-4 h-4" alt="" />
            }
          </button>
        </div>
      )}
    </>
  )

  // Warm-brutalist composer: chunky navy-ink outline + offset shadow on cream/white — shared by both variants.
  const composer = (
    <div
      className={`shrink-0 flex flex-col cursor-text rounded-[20px] px-5 pt-4 pb-3 bg-white border-[2.5px] border-ink-900 shadow-chunk transition-shadow focus-within:shadow-chunk-lg ${isTerritory ? 'm-3' : 'w-full'}`}
      onClick={() => textareaRef.current?.focus()}
    >
      {composerBody}
    </div>
  )

  if (isTerritory) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center justify-between px-4 h-[52px] shrink-0 border-b border-border">
          <span className="text-[13px] font-semibold text-ink-900">Chat session</span>
        </div>
        {messageList || <div className="flex-1" />}
        {footer}
        {!hideComposer && composer}
      </div>
    )
  }

  // Intake variant: message list (if any) sits above the composer; the parent
  // supplies the surrounding centered column, title, and presets.
  return (
    <div className="flex flex-col gap-6 min-h-0">
      {messageList}
      {composer}
      {footer}
    </div>
  )
}
