import { useState, useRef, useEffect, useCallback } from 'react'
import { useIntake, useCreateHunt, postMessage, type IntakeMessage } from '@/api/hunts'
import { useAskStream, type AskAction } from '@/hooks/use-ask-stream'
import { extractFileText } from '@/api/tools'

export type Role = 'user' | 'alpha'

export type Message = {
  id: string
  role: Role
  text: string
  isThinking?: boolean
}

export type AttachedFile = {
  localId: string
  file: File
  name: string
}

export type DoorPhase = 'intake' | 'territory'

let _msgId = 0
function nextId() {
  return String(++_msgId)
}

/** Alpha's turns become 'assistant' so the intake model reads them as its own. */
function toWire(m: Pick<Message, 'role' | 'text'>): IntakeMessage {
  return { role: m.role === 'alpha' ? 'assistant' : 'user', content: m.text }
}

/** Parses each file to real text so the pack researches the CONTENT, not just the filename. */
async function buildMessageWithFiles(text: string, files: AttachedFile[]): Promise<string> {
  if (files.length === 0) return text
  const parts = await Promise.all(
    files.map(async (f) => {
      try {
        const body = await extractFileText(f.file)
        return body ? `[${f.name}]\n${body}` : `[${f.name}]`
      } catch {
        // Parse failed — degrade to the filename marker so the turn still sends.
        return `[${f.name}]`
      }
    }),
  )
  return [text, ...parts].filter(Boolean).join('\n\n')
}

/** A proven formation reused from the Instincts library — only the SHAPE rides along as seed_team;
 *  the task is asked fresh. `team` may be empty on a malformed spec, treated downstream as "no seed". */
export type ReusedInstinct = {
  label: string
  team: Array<{ role: string; count: number }>
  strategy?: string
}

/** Derives a reusable formation from a saved instinct's opaque spec, dropping its baked-in task. The
 *  one place both "Use This" entry points build a ReusedInstinct, so they can't drift. */
export function toReusedInstinct(it: {
  label?: string
  spec?: Record<string, unknown>
}): ReusedInstinct {
  const spec = (it.spec ?? {}) as { team?: unknown; strategy?: unknown }
  const rawTeam = Array.isArray(spec.team) ? spec.team : []
  const team = rawTeam
    .map((t) => {
      const e = (t ?? {}) as Record<string, unknown>
      return { role: String(e.role ?? ''), count: Number(e.count ?? 0) }
    })
    .filter((t) => t.role && Number.isFinite(t.count) && t.count > 0)
  return {
    label: it.label || 'Saved pack',
    team,
    strategy: typeof spec.strategy === 'string' ? spec.strategy : undefined,
  }
}

export interface DoorLogicOptions {
  /** Start already in the territory (standalone hunt view / deep-link). */
  initialPhase?: DoorPhase
  initialHuntId?: string | null
  /** Server-stored transcript to seed the chat with, once, when it arrives. */
  seedMessages?: Array<{ role: Role; text: string }>
  /** A reused Instinct's formation — carried onto the created hunt as its seed_team. */
  instinct?: ReusedInstinct | null
  /** Fired when Alpha did something beyond answering: 'refined' the brief, or launched a
   *  'subhunt'/'new_hunt' (id passed along so the caller can track/switch to it). */
  onAskAction?: (action: AskAction, newHuntId: string | null) => void
}

/**
 * The brain behind the door. Owns the Alpha conversation, then — once Alpha
 * signals a real job — mints the hunt and flips `phase` to 'territory' so the
 * page can morph in place (no route change, chat stays mounted).
 *
 * Reused by the standalone territory view via `opts` to start in territory phase
 * and seed the durable transcript.
 */
export function useDoorLogic(opts?: DoorLogicOptions) {
  const { mutateAsync: sendToAlpha, isPending } = useIntake()
  const { mutateAsync: createHunt } = useCreateHunt()
  const { ask: askAlpha, streaming: asking } = useAskStream()

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  // True while files are parsed/transcribed server-side — composer shows "Reading files…" instead
  // of a silent pause on a big PDF.
  const [parsingFiles, setParsingFiles] = useState(false)

  const [phase, setPhase] = useState<DoorPhase>(opts?.initialPhase ?? 'intake')
  const [huntId, setHuntId] = useState<string | null>(opts?.initialHuntId ?? null)
  // Where intake ends and the hunt's live narration begins — a reply after completion renders BELOW
  // the report, not back in the intake thread. null until a hunt exists.
  // Deep-link nuance: the durable log carries no launch marker, so on refresh the whole stored
  // transcript seeds above the narration and only new follow-ups split below it.
  const [launchIndex, setLaunchIndex] = useState<number | null>(
    opts?.initialHuntId != null ? (opts?.seedMessages?.length ?? 0) : null,
  )

  // Seed the durable transcript once it arrives (deep-link into an existing hunt), and set
  // launchIndex alongside it — seedMessages.length is frozen at 0 while the query is in flight,
  // which would otherwise invert the feed (stored conversation rendering below live narration).
  // Splice the seed in front of any follow-up the Packmaster already sent, rather than dropping it.
  const seed = opts?.seedMessages
  const seededRef = useRef(false)
  useEffect(() => {
    if (!seed || seed.length === 0 || seededRef.current) return
    seededRef.current = true
    const seedMsgs = seed.map((m) => ({ id: nextId(), role: m.role, text: m.text }))
    setMessages((prev) => (prev.length === 0 ? seedMsgs : [...seedMsgs, ...prev]))
    setLaunchIndex((prev) => (prev === null ? seed.length : seed.length + prev))
  }, [seed])

  // Reusing an Instinct: greet as Alpha naming the pack + formation, flip the door open without
  // creating a hunt yet (minted only once the Packmaster gives a real task).
  // `token` is React Router's location.key: same instinct via a new navigation re-greets; a repeat
  // call with the same token is a no-op (StrictMode double-invoke / re-render).
  const greetTokenRef = useRef<string | null>(null)
  const greetForInstinct = useCallback((inst: ReusedInstinct, token: string) => {
    if (greetTokenRef.current === token) return
    greetTokenRef.current = token
    // Reset any in-progress intake for a clean start, not a graft.
    setPhase('territory')
    setHuntId(null)
    setLaunchIndex(null)
    setInput('')
    setAttachedFiles([])
    setMessages([{ id: nextId(), role: 'alpha', text: instinctGreeting(inst) }])
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Composer's textarea/scroll refs live in ChatColumn — a ref threaded from here would go stale
  // when the door→territory morph remounts it.

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).map((f) => ({
      localId: nextId(),
      file: f,
      name: f.name,
    }))
    setAttachedFiles((prev) => [...prev, ...incoming])
  }, [])

  const removeFile = useCallback((localId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.localId !== localId))
  }, [])

  const pickFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const send = useCallback(async (override?: string) => {
    // `override` lets a button (e.g. failed-hunt "Try again") fire a message without routing
    // through the composer's input state.
    const text = (override ?? input).trim()
    if (!text && attachedFiles.length === 0) return

    // Territory opens on the first message, decoupled from the hunt launch — you keep talking to
    // Alpha until there's a real job to run.
    if (phase === 'intake') setPhase('territory')

    // Snapshot files then clear the composer so a slow parse doesn't leave stale chips.
    const files = attachedFiles
    let builtText = text
    if (files.length > 0) {
      setAttachedFiles([])
      setParsingFiles(true)
      try {
        builtText = await buildMessageWithFiles(text, files)
      } finally {
        setParsingFiles(false)
      }
    }

    // Hunt already exists (composer reopens only once terminal): a follow-up question, streamed
    // straight into the chat with full history so the backend grounds the reply in what the
    // pack actually researched.
    if (huntId) {
      const askMsg: Message = { id: nextId(), role: 'user', text: builtText }
      const history = [...messages, askMsg].filter((m) => !m.isThinking && m.text).map(toWire)
      const replyId = nextId()
      setMessages((prev) => [...prev, askMsg, { id: replyId, role: 'alpha', text: '', isThinking: true }])
      setInput('')
      setAttachedFiles([])
      void persistMessage(huntId, 'user', builtText)

      // Alpha may just answer, or may have re-worked the brief / launched a follow-up hunt —
      // `result.action` tells us which so the UI reacts.
      const result = await askAlpha(
        huntId,
        builtText,
        (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, text: m.text + chunk, isThinking: false } : m)),
          )
        },
        history,
      )
      const finalText = result.reply.trim() || "Alpha couldn't answer that one — please try again."
      setMessages((prev) =>
        prev.map((m) => (m.id === replyId ? { ...m, text: finalText, isThinking: false } : m)),
      )
      if (result.reply.trim()) void persistMessage(huntId, 'alpha', result.reply)
      opts?.onAskAction?.(result.action, result.huntId)
      return
    }

    // No hunt yet: replay the whole conversation so Alpha keeps context, launch once ready.
    const userMsg: Message = { id: nextId(), role: 'user', text: builtText }
    const history: IntakeMessage[] = [...messages, userMsg]
      .filter((m) => !m.isThinking && m.text)
      .map(toWire)

    const thinkingId = nextId()
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: thinkingId, role: 'alpha', text: '', isThinking: true },
    ])
    setInput('')
    setAttachedFiles([])

    try {
      // Pass current huntId so the front door won't re-scope or relaunch over a running/delivered hunt.
      const res = await sendToAlpha({ messages: history, hunt_id: huntId })

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId ? { ...m, text: res.reply, isThinking: false } : m,
        ),
      )

      if (res.ready) {
        // Carry a reused instinct's team/strategy as seed_team — only when non-empty, so a
        // malformed instinct falls back to Beta sizing the pack rather than launching bare.
        const inst = opts?.instinct
        const hunt = await createHunt({
          input: res.brief,
          ...(inst && inst.team.length > 0 ? { team: inst.team } : {}),
          ...(inst?.strategy ? { strategy: inst.strategy } : {}),
        })

        // Persist so a refresh / deep-link into standalone territory shows the same chat.
        void flushConversation(hunt.hunt_id, [
          ...messages,
          userMsg,
          { id: thinkingId, role: 'alpha', text: res.reply },
        ])

        // Cosmetic URL sync — no React Router navigation, so nothing remounts.
        window.history.replaceState(null, '', `/hunts/${hunt.hunt_id}`)
        setHuntId(hunt.hunt_id)
        setPhase('territory')
        // +2 = this user turn + Alpha's reply; live narration renders after it.
        setLaunchIndex(messages.length + 2)
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId
            ? { ...m, text: 'Something went wrong. Try again.', isThinking: false }
            : m,
        ),
      )
      console.error('[door]', err)
    }
  }, [input, attachedFiles, messages, phase, huntId, sendToAlpha, createHunt, askAlpha, opts])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        // Mirror the send button's disabled state so a fast double-Enter can't fire a second ask
        // mid-stream (would abort the first reply).
        if (!isPending && !asking && !parsingFiles) void send()
      }
    },
    [send, isPending, asking, parsingFiles],
  )

  // Drag handlers attached to the outer container
  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.relatedTarget || !(e.currentTarget as Element).contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles],
  )

  return {
    messages,
    input,
    setInput,
    attachedFiles,
    removeFile,
    isDragging,
    // Composer is "busy" during a live turn OR while attached files are still being parsed.
    isPending: isPending || asking || parsingFiles,
    parsingFiles,
    phase,
    huntId,
    launchIndex,
    send,
    greetForInstinct,
    pickFiles,
    addFiles,
    fileInputRef,
    handleKeyDown,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  }
}

/** Human summary of a reused formation for Alpha's greeting ("3 scouts, 2 trackers"). Leads and the
 *  standing Warden are implied. */
export function formationSummary(team: Array<{ role: string; count: number }>): string {
  const named = team
    .filter((t) => t.role !== 'alpha' && t.role !== 'beta' && t.role !== 'warden' && t.count > 0)
    .map((t) => {
      const label = t.count > 1 ? `${t.role}s` : t.role
      return `${t.count} ${label}`
    })
  if (named.length === 0) return 'your saved pack'
  if (named.length === 1) return named[0]
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`
}

/** Alpha's opening line when a saved Instinct is reused: name the pack + shape, ask for the new task. */
function instinctGreeting(inst: ReusedInstinct): string {
  return (
    `This is your **${inst.label}** pack — ${formationSummary(inst.team)}, ready to run. ` +
    `What should I point them at this time?`
  )
}

/** Best-effort persist — never surfaces as an unhandled rejection; the chat already has the turn. */
async function persistMessage(huntId: string, role: Role, content: string): Promise<void> {
  try {
    await postMessage(huntId, { role, content })
  } catch (err) {
    console.error('[door] persist message failed', err)
  }
}

/** Flush the intake transcript to the hunt's durable log, in order. */
async function flushConversation(
  huntId: string,
  msgs: Array<Pick<Message, 'role' | 'text'>>,
) {
  for (const m of msgs) {
    if (!m.text) continue
    await persistMessage(huntId, m.role, m.text)
  }
}
