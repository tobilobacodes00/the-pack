import { Clock, Pause, Play, Plus, Square, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageBubble, type ChatMessage } from '../intake/message-bubble'
import { FileCard } from '../intake/file-chip'
import { useMicRecorder } from '../intake/use-mic-recorder'
import type { AttachedFile } from '../intake/use-intake'
import { WolfActivityLine } from '../territory/wolf-activity-line'
import type { ActivityItem } from '@/events/schema'
import StarBorder from '@/ui/star-border'

const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'webm'])
function isAudio(name: string) {
  return AUDIO_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '')
}

function formatTime(s: number): string {
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

// Live bars during recording — reacts to real mic levels at ~60fps
function LiveBars({ getLiveBars }: { getLiveBars: () => number[] }) {
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
        <Bar key={i} h={h} color={`rgba(255,255,255,${0.25 + h * 0.75})`} />
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
  send: () => void | Promise<void>
  pickFiles: () => void
  fileInputRef: React.RefObject<HTMLInputElement>
  textareaRef: React.RefObject<HTMLTextAreaElement>
  messagesEndRef: React.RefObject<HTMLDivElement>
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** Rendered between the message list and the composer (e.g. the plan card). */
  footer?: React.ReactNode
  /** Hide the composer entirely — e.g. once the plan card takes over the bottom. */
  hideComposer?: boolean
  /** The pack's live beats, rendered as inline replies after the conversation (territory only). */
  activity?: ActivityItem[]
  /** Composer placeholder override (state-aware — e.g. "Ask Alpha anything about this plan…"). */
  placeholder?: string
  /** Territory header history button → open Chat History (the Den). Omit to hide it. */
  onHistory?: () => void
}

/**
 * The chat — the through-line that stays mounted as the door morphs into the
 * territory. `variant` switches between the big centered intake composer and the
 * compact 320px side panel, but the message list + composer are the same code.
 */
export function ChatColumn(props: ChatColumnProps) {
  const {
    variant, messages, input, setInput, attachedFiles, removeFile, addFiles,
    isPending, send, pickFiles, fileInputRef, textareaRef, messagesEndRef,
    handleKeyDown, footer, hideComposer, activity, placeholder, onHistory,
  } = props

  const isTerritory = variant === 'territory'

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

  const audioUrl = useMemo(() => {
    if (!audioFile) return null
    return URL.createObjectURL(audioFile.file)
  }, [audioFile])

  useEffect(() => {
    return () => { if (audioUrl) URL.revokeObjectURL(audioUrl) }
  }, [audioUrl])

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
    if (!el || !el.duration) return
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
  const messageList = (messages.length > 0 || acts.length > 0) && (
    <div
      className={
        isTerritory
          ? 'flex-1 flex flex-col gap-4 overflow-y-auto min-h-0 px-4 py-4'
          : 'flex flex-col gap-5 overflow-y-auto max-h-[40vh] min-h-0'
      }
    >
      {messages.map((m, i) => <MessageBubble key={m.id ?? i} message={m} />)}
      {acts.map((a) => <WolfActivityLine key={`act-${a.seq}`} item={a} />)}
      <div ref={messagesEndRef} />
    </div>
  )

  const composer = (
    <StarBorder
      as="div"
      color="white"
      speed="5s"
      className={`shrink-0 ${isTerritory ? 'm-3' : 'w-full'} cursor-text focus-within:ring-2 focus-within:ring-white/20 transition-shadow duration-200`}
      innerClassName="relative z-1 flex flex-col rounded-[20px] px-5 pt-4 pb-3 bg-[#111111]"
      onClick={() => textareaRef.current?.focus()}
    >
      {docFiles.length > 0 && (
        <div className="flex gap-3 flex-wrap mb-4">
          {docFiles.map((f) => (
            <FileCard key={f.localId} file={f} onRemove={removeFile} />
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        placeholder={placeholder ?? (isTerritory ? 'Message Alpha…' : 'Describe your task, or drop a file')}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        className="w-full bg-transparent resize-none outline-none text-sm text-white
                   placeholder:text-[#555] max-h-[120px] overflow-y-auto leading-relaxed"
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        accept=".pdf,.csv,.txt,.md,.docx,.mp3,.wav,.ogg,.aac,.flac,.m4a"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {isRecording ? (
        /* ── Recording: red dot + timer + live bars + stop ── */
        <div className="flex items-center gap-3 mt-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-red-400 text-sm font-mono tabular-nums">
              {formatTime(recordingSeconds)}
            </span>
          </div>
          <LiveBars getLiveBars={getLiveBars} />
          <button
            onClick={toggleMic}
            className="text-muted hover:text-white transition-colors shrink-0"
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
              setPlayDuration((e.target as HTMLAudioElement).duration)
            }}
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={togglePlay}
              className="text-muted hover:text-white transition-colors shrink-0"
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
                  color={i / voicePeaks.length <= playProgress
                    ? 'rgba(255,255,255,0.9)'
                    : 'rgba(255,255,255,0.18)'}
                />
              ))}
            </div>

            <span className="text-[#555] text-xs font-mono tabular-nums shrink-0">
              {formatTime(Math.floor(playProgress * playDuration))} / {formatTime(Math.floor(playDuration))}
            </span>

            <button
              onClick={discardVoiceMemo}
              className="text-[#666] hover:text-white transition-colors shrink-0"
              aria-label="Delete recording"
            >
              <X size={16} />
            </button>

            <button
              onClick={() => void send()}
              disabled={isPending}
              className="w-9 h-9 rounded-full bg-white flex items-center justify-center
                         disabled:opacity-30 hover:bg-gray-200 transition-colors shrink-0"
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
            className="text-[#666] hover:text-white transition-colors shrink-0"
            aria-label="Attach files"
          >
            <Plus size={18} />
          </button>

          <div className="flex-1" />

          <button
            onClick={toggleMic}
            className="text-muted hover:text-white transition-colors shrink-0"
            aria-label="Record voice"
          >
            <img src="/icon-mic.svg" className="w-5 h-5" alt="" />
          </button>

          <button
            onClick={() => void send()}
            disabled={isPending || (input.trim() === '' && attachedFiles.length === 0)}
            className="w-9 h-9 rounded-full bg-white flex items-center justify-center
                       disabled:opacity-30 hover:bg-gray-200 transition-colors shrink-0"
            aria-label="Send"
          >
            {isPending
              ? <span className="w-3 h-3 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
              : <img src="/icon-send.svg" className="w-4 h-4" alt="" />
            }
          </button>
        </div>
      )}
    </StarBorder>
  )

  if (isTerritory) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div
          className="flex items-center justify-between px-4 h-[52px] shrink-0"
          style={{ borderBottom: '1px solid #404040' }}
        >
          <span className="text-[13px] font-semibold text-white">Chat session</span>
          {onHistory && (
            <button
              onClick={onHistory}
              aria-label="Chat history"
              title="Chat history"
              className="-mr-1 p-1 text-text-dim hover:text-text transition-colors"
            >
              <Clock size={15} />
            </button>
          )}
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
