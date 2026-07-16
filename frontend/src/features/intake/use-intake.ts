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

/** Map a local chat message to the wire shape the backend intake gate expects
 *  (Alpha's turns become 'assistant' so the model reads them as its own). */
function toWire(m: Pick<Message, 'role' | 'text'>): IntakeMessage {
  return { role: m.role === 'alpha' ? 'assistant' : 'user', content: m.text }
}

/** Build the text the pack actually sees from the typed input + any attached files. Each file is
 *  parsed/transcribed server-side to real text and folded in under a `[name]` header — so the pack
 *  researches the CONTENT, not just the filename. A file that fails to read degrades to its bare
 *  `[name]` marker (the old behavior) rather than blocking the send. */
async function buildMessageWithFiles(text: string, files: AttachedFile[]): Promise<string> {
  if (files.length === 0) return text
  const parts = await Promise.all(
    files.map(async (f) => {
      try {
        const body = await extractFileText(f.file)
        return body ? `[${f.name}]\n${body}` : `[${f.name}]`
      } catch {
        // Couldn't read this file (network/parse error) — fall back to the filename marker so the
        // turn still sends; the pack just won't have this file's contents.
        return `[${f.name}]`
      }
    }),
  )
  return [text, ...parts].filter(Boolean).join('\n\n')
}

/** A proven formation the user chose to REUSE (from the Instincts library). The task is asked fresh
 *  via Alpha; only the SHAPE (team + strategy) rides along — carried onto the hunt as seed_team so the
 *  backend keeps this formation but researches the NEW task, not the instinct's baked-in one. `team`
 *  may be empty when the saved spec is malformed — callers treat that as "no seed" (Beta sizes it). */
export type ReusedInstinct = {
  label: string
  team: Array<{ role: string; count: number }>
  strategy?: string
}

/** Derive a reusable formation from a saved instinct's opaque `spec`, dropping its baked-in task (the
 *  task is asked fresh at the Door). The ONE place both instinct "Use This" entry points (the Instincts
 *  page and the Past-Hunts sidebar) build a ReusedInstinct, so they can't drift. A malformed spec
 *  yields an empty team, which downstream treats as "no seed_team" rather than launching the old job. */
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
  /** Fired after a chat turn on a live hunt when Alpha DID something beyond answering — 'refined'
   *  (the brief was re-worked → refresh the reward), or 'subhunt'/'new_hunt' (a follow-up launched,
   *  its id passed along so the caller can track/switch to it). */
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
  // True while attached files are being parsed/transcribed server-side (before the turn is sent) — so
  // the composer can show "Reading files…" and disable send instead of a silent pause on a big PDF.
  const [parsingFiles, setParsingFiles] = useState(false)

  const [phase, setPhase] = useState<DoorPhase>(opts?.initialPhase ?? 'intake')
  const [huntId, setHuntId] = useState<string | null>(opts?.initialHuntId ?? null)
  // Where the intake conversation ends and the hunt's live narration begins. The chat renders
  // intake turns → the pack's activity → post-hunt follow-up Q&A, so a reply after completion lands
  // BELOW the report, not back up in the intake thread. null until a hunt exists.
  // Deep-link nuance: the durable log carries no launch marker, so on refresh the WHOLE stored
  // transcript (intake + any past follow-ups, in their true relative order) seeds above the
  // narration, and only NEW follow-ups split below it. All turns are present and ordered within
  // their group — a per-message timestamp/marker in the log is the future fix if this ever matters.
  const [launchIndex, setLaunchIndex] = useState<number | null>(
    opts?.initialHuntId != null ? (opts?.seedMessages?.length ?? 0) : null,
  )

  // Seed the durable transcript once, when it first arrives (deep-link into an existing hunt) — and
  // set launchIndex alongside it, since it must describe THIS seed, not whatever seedMessages.length
  // happened to be at mount (that's frozen at 0 while the transcript query is still in flight, which
  // would otherwise invert the feed: the whole stored conversation rendering BELOW the live narration).
  // If the Packmaster manages to send a follow-up before the seed lands, prefer their live messages —
  // splice the seed in front of them rather than dropping the seed forever.
  const seed = opts?.seedMessages
  const seededRef = useRef(false)
  useEffect(() => {
    if (!seed || seed.length === 0 || seededRef.current) return
    seededRef.current = true
    const seedMsgs = seed.map((m) => ({ id: nextId(), role: m.role, text: m.text }))
    setMessages((prev) => (prev.length === 0 ? seedMsgs : [...seedMsgs, ...prev]))
    setLaunchIndex((prev) => (prev === null ? seed.length : seed.length + prev))
  }, [seed])

  // Reusing an Instinct: greet as Alpha naming the pack + its formation and ask for the new task. Flips
  // the door open (so the seeded formation shows on the canvas) without creating a hunt yet — the hunt
  // is minted only once the Packmaster gives a real task, carrying the instinct's team as seed_team.
  //
  // `token` is a per-navigation key (React Router's location.key): the SAME instinct reaching the door
  // via two different navigations should re-greet (the user clicked "Use This" again). A repeated call
  // with the same token is a no-op (StrictMode double-invoke / re-render). When a fresh instinct arrives
  // over an in-progress door session, we reset the conversation so it's a clean start, not a graft.
  const greetTokenRef = useRef<string | null>(null)
  const greetForInstinct = useCallback((inst: ReusedInstinct, token: string) => {
    if (greetTokenRef.current === token) return // same navigation (re-render / StrictMode) → no-op
    greetTokenRef.current = token
    // A clean door session for this instinct: reset any in-progress intake and open with just the
    // greeting turn. No hunt exists yet — it's minted only when the Packmaster gives the new task.
    setPhase('territory')
    setHuntId(null)
    setLaunchIndex(null)
    setInput('')
    setAttachedFiles([])
    setMessages([{ id: nextId(), role: 'alpha', text: instinctGreeting(inst) }])
  }, [])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // NOTE: the composer's textarea/scroll-anchor refs and the autosize effect live in ChatColumn now —
  // each instance owns its own (the door→territory morph remounts ChatColumn, so a ref threaded from
  // here would go stale the moment the old instance unmounts). ChatColumn also sees the live activity
  // feed, so its scroll effect follows the latest pack action, not just chat turns.

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

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text && attachedFiles.length === 0) return

    // Fold the door open on the very first message — the chat slides aside and the
    // territory opens immediately. This is decoupled from the hunt launch: you keep
    // talking to Alpha in the side chat until there's a real job to run.
    if (phase === 'intake') setPhase('territory')

    // Parse any attached files to real text BEFORE building the message, so the pack researches their
    // contents (not just "[report.pdf]"). Snapshot the files, then clear the composer so a slow parse
    // doesn't leave stale chips — the send owns them now. Degrades to the filename on a read failure.
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

    // The hunt already exists (the composer is only open again once it's terminal — completed /
    // failed / stopped). This is a follow-up question: log the turn, then stream Alpha's real answer
    // straight into the chat so the conversation continues past the report. Alpha gets the FULL
    // context — everything discussed so far goes as history, and the backend grounds the reply in
    // what the pack actually researched (the delivered brief + sources).
    if (huntId) {
      const askMsg: Message = { id: nextId(), role: 'user', text: builtText }
      const history = [...messages, askMsg].filter((m) => !m.isThinking && m.text).map(toWire)
      const replyId = nextId()
      setMessages((prev) => [...prev, askMsg, { id: replyId, role: 'alpha', text: '', isThinking: true }])
      setInput('')
      setAttachedFiles([])
      void persistMessage(huntId, 'user', builtText)

      // The one smart Alpha: it may just answer, OR it may have re-worked the brief / launched a
      // scoped follow-up hunt. `result.action` tells us which so the UI reacts.
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

    // No hunt yet: replay the whole conversation so Alpha keeps context, and launch
    // the moment Alpha signals a real job (ready).
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
      // Pass the current huntId (if any) so the front door is state-aware — it won't re-scope or
      // relaunch over a hunt that's already running or delivered.
      const res = await sendToAlpha({ messages: history, hunt_id: huntId })

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId ? { ...m, text: res.reply, isThinking: false } : m,
        ),
      )

      if (res.ready) {
        // If the Packmaster reused an Instinct, carry its proven formation as the hunt's seed_team
        // (and its strategy) while the freshly-gathered brief drives the research — reuse the SHAPE,
        // not the instinct's old baked-in task. Only seed a NON-EMPTY team: a malformed instinct with
        // no usable roles falls back to letting Beta size the pack, not to silently launching bare.
        const inst = opts?.instinct
        const hunt = await createHunt({
          input: res.brief,
          ...(inst && inst.team.length > 0 ? { team: inst.team } : {}),
          ...(inst?.strategy ? { strategy: inst.strategy } : {}),
        })

        // Persist the intake conversation so a refresh / deep-link into the
        // standalone territory shows the same chat. Best-effort, non-blocking.
        void flushConversation(hunt.hunt_id, [
          ...messages,
          userMsg,
          { id: thinkingId, role: 'alpha', text: res.reply },
        ])

        // Cosmetic URL sync — no React Router navigation, so nothing remounts
        // and the chat morphs in place.
        window.history.replaceState(null, '', `/hunts/${hunt.hunt_id}`)
        setHuntId(hunt.hunt_id)
        setPhase('territory')
        // Everything up to and including this launching turn is "intake"; the pack's live narration
        // and any later follow-ups render after it. (+2 = this user turn + Alpha's reply.)
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
        // The send button disables while a turn is in flight; mirror that on the keyboard path so a
        // fast double-Enter can't fire a second ask mid-stream (which would abort the first reply) or a
        // second send while files are still parsing.
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

/** A short, human summary of a reused formation for Alpha's greeting ("3 scouts, 2 trackers"). Leads
 *  and the standing Warden are implied — only the shape the user tuned is worth naming. */
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

/** Alpha's opening line when a saved Instinct is reused: name the pack + its shape, then ask for the
 *  new task. The formation is kept; only the job is gathered fresh. */
function instinctGreeting(inst: ReusedInstinct): string {
  return (
    `This is your **${inst.label}** pack — ${formationSummary(inst.team)}, ready to run. ` +
    `What should I point them at this time?`
  )
}

/** Best-effort persist — a durable-log write that never surfaces as an unhandled rejection (a
 *  network blip or backend restart here shouldn't crash the tab; the chat already has the turn). */
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
