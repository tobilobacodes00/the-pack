import { useState, useRef, useEffect, useCallback } from 'react'
import { useIntake, useCreateHunt, postMessage, type IntakeMessage } from '@/api/hunts'

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

export interface DoorLogicOptions {
  /** Start already in the territory (standalone hunt view / deep-link). */
  initialPhase?: DoorPhase
  initialHuntId?: string | null
  /** Server-stored transcript to seed the chat with, once, when it arrives. */
  seedMessages?: Array<{ role: Role; text: string }>
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

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const [phase, setPhase] = useState<DoorPhase>(opts?.initialPhase ?? 'intake')
  const [huntId, setHuntId] = useState<string | null>(opts?.initialHuntId ?? null)

  // Seed the durable transcript once, when it first arrives and the chat is empty
  // (deep-link into an existing hunt). After that, local state is the source of truth.
  const seed = opts?.seedMessages
  useEffect(() => {
    if (seed && seed.length > 0) {
      setMessages((prev) =>
        prev.length === 0
          ? seed.map((m) => ({ id: nextId(), role: m.role, text: m.text }))
          : prev,
      )
    }
  }, [seed])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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

    const fileNote = attachedFiles.map((f) => `[${f.name}]`).join(' ')
    const builtText = [text, fileNote].filter(Boolean).join(' ')

    // Fold the door open on the very first message — the chat slides aside and the
    // territory opens immediately. This is decoupled from the hunt launch: you keep
    // talking to Alpha in the side chat until there's a real job to run.
    if (phase === 'intake') setPhase('territory')

    // Once the hunt exists, further turns are mid-hunt chatter. Log durably; a live
    // Alpha reply mid-hunt is a later state (out of scope here).
    if (huntId) {
      setMessages((prev) => [...prev, { id: nextId(), role: 'user', text: builtText }])
      setInput('')
      setAttachedFiles([])
      void postMessage(huntId, { role: 'user', content: builtText })
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
      const res = await sendToAlpha({ messages: history })

      setMessages((prev) =>
        prev.map((m) =>
          m.id === thinkingId ? { ...m, text: res.reply, isThinking: false } : m,
        ),
      )

      if (res.ready) {
        const hunt = await createHunt({ input: res.brief })

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
  }, [input, attachedFiles, messages, phase, huntId, sendToAlpha, createHunt])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void send()
      }
    },
    [send],
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
    isPending,
    phase,
    huntId,
    send,
    pickFiles,
    addFiles,
    fileInputRef,
    textareaRef,
    messagesEndRef,
    handleKeyDown,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  }
}

/** Flush the intake transcript to the hunt's durable log, in order. */
async function flushConversation(
  huntId: string,
  msgs: Array<Pick<Message, 'role' | 'text'>>,
) {
  for (const m of msgs) {
    if (!m.text) continue
    try {
      await postMessage(huntId, { role: m.role, content: m.text })
    } catch (err) {
      console.error('[door] persist message failed', err)
    }
  }
}
