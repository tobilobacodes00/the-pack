import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  Brain,
  ChevronLeft,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  useClearMemory,
  useDeleteMemoryEntry,
  useMemory,
  usePatchMemory,
  type MemoryEntry,
} from '@/api/memory'
import { toast } from '@/store/toast-store'
import { color } from '@/lib/theme'
import { HuntSidebar } from '@/features/door/hunt-sidebar'

// Display labels for the Elder's lesson kinds (mirrors backend tools/memory.py KINDS).
const KIND_LABEL: Record<string, string> = {
  preference: 'Preference',
  'what-worked': 'What worked',
  'what-failed': 'What failed',
  'topic-insight': 'Topic insight',
  takeaway: 'Takeaway',
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="shrink-0 rounded-full bg-cream-100 px-2.5 py-0.5 text-[11px] font-semibold text-ink-700">
      {KIND_LABEL[kind] ?? 'Takeaway'}
    </span>
  )
}

function LessonRow({ entry }: { entry: MemoryEntry }) {
  const patch = usePatchMemory()
  const remove = useDeleteMemoryEntry()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  const archived = entry.status === 'archived'

  const save = () => {
    const text = draft.trim()
    if (!text || text === entry.text) {
      setEditing(false)
      setDraft(entry.text)
      return
    }
    patch.mutate(
      { id: entry.id, text },
      {
        onSuccess: () => {
          setEditing(false)
          toast({ title: 'Lesson updated', variant: 'success' })
        },
      },
    )
  }

  return (
    <div
      className={`rounded-xl border border-border bg-white px-4 py-3 ${archived ? 'opacity-55' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KindBadge kind={entry.kind} />
            {archived && (
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
                vetoed — never recalled
              </span>
            )}
          </div>
          {editing ? (
            <div className="mt-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Edit lesson"
                rows={2}
                className="w-full rounded-lg border border-border bg-cream-50 px-3 py-2 text-[13px] leading-relaxed text-text outline-none focus:border-brand-500"
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  onClick={save}
                  className="rounded-full bg-brand-500 px-3.5 py-1 text-[12px] font-semibold text-white hover:bg-brand-600"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(false)
                    setDraft(entry.text)
                  }}
                  className="rounded-full px-3 py-1 text-[12px] text-text-dim hover:text-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-text">{entry.text}</p>
          )}
          {entry.hunt_id && (
            <Link
              to={`/hunts/${entry.hunt_id}`}
              className="mt-1 inline-block text-[11.5px] text-text-faint underline-offset-2 hover:underline"
            >
              from hunt {entry.hunt_id.slice(0, 12)}…
            </Link>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!archived && !editing && (
            <button
              onClick={() => setEditing(true)}
              aria-label={`Edit lesson ${entry.id}`}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-cream-100 hover:text-text"
            >
              <Pencil size={15} />
            </button>
          )}
          <button
            onClick={() =>
              patch.mutate(
                { id: entry.id, status: archived ? 'active' : 'archived' },
                {
                  onSuccess: () =>
                    toast({
                      title: archived ? 'Lesson restored' : 'Lesson vetoed',
                      description: archived
                        ? 'The pack will weigh it again on future hunts.'
                        : 'Kept for the record; the pack will never recall it.',
                      variant: 'success',
                    }),
                },
              )
            }
            aria-label={archived ? `Restore lesson ${entry.id}` : `Veto lesson ${entry.id}`}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-cream-100 hover:text-text"
          >
            {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          </button>
          <button
            onClick={() => {
              if (!window.confirm('Forget this lesson for good? This cannot be undone.')) return
              remove.mutate(entry.id, {
                onSuccess: () => toast({ title: 'Lesson forgotten', variant: 'success' }),
              })
            }}
            aria-label={`Delete lesson ${entry.id}`}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-cream-100 hover:text-[#DC2626]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * /memory — the Den's memory shelf: everything the Elder learned across hunts, visible and under
 * the Packmaster's control. Every lesson can be edited, vetoed (archived — never recalled again),
 * or forgotten outright; active lessons steer future hunts AND become citable memory:// sources
 * in briefs. Memory you can see and veto — not a black box.
 */
export default function MemoryPage() {
  const navigate = useNavigate()
  const { data, isLoading } = useMemory()
  const clear = useClearMemory()

  const lessons = data ?? []
  const active = lessons.filter((l) => l.status === 'active')
  const archived = lessons.filter((l) => l.status === 'archived')

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: color.canvas }}>
      <HuntSidebar onCollapse={() => navigate('/')} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 py-10">
          {/* Header */}
          <div className="flex items-start gap-3 border-b pb-5" style={{ borderColor: '#dcdcd8' }}>
            <button
              onClick={() => navigate(-1)}
              className="mt-0.5 p-1 text-text-dim hover:text-ink-900"
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 text-[20px] font-bold text-text">
                <Brain size={20} className="text-brand-500" />
                Pack Memory
              </h1>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                What the Elder learned across hunts. Active lessons steer future plans and are
                cited in briefs as <code className="text-[12px]">memory://</code> sources — you can
                edit, veto, or forget any of them. Nothing here is a black box.
              </p>
            </div>
            {lessons.length > 0 && (
              <button
                onClick={() => {
                  if (!window.confirm('Forget EVERYTHING the pack learned? This cannot be undone.'))
                    return
                  clear.mutate(undefined, {
                    onSuccess: () => toast({ title: 'Memory cleared', variant: 'success' }),
                  })
                }}
                className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-[12px] text-text-dim transition-colors hover:text-[#DC2626]"
              >
                Forget everything
              </button>
            )}
          </div>

          {isLoading ? (
            <p className="mt-10 text-center text-[13px] text-muted">Waking the Elder…</p>
          ) : lessons.length === 0 ? (
            <div className="mt-14 text-center">
              <Brain size={26} className="mx-auto text-text-faint" />
              <p className="mt-3 text-[15px] font-semibold text-ink-900">Nothing learned yet</p>
              <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-muted">
                After each hunt the Elder distills one durable lesson — what worked, what failed,
                what you prefer. They land here, and you stay in charge of every one.
              </p>
            </div>
          ) : (
            <>
              <section className="mt-7">
                <h2 className="mb-3 text-[14px] font-semibold text-ink-900">
                  Active — steering future hunts ({active.length})
                </h2>
                <div className="flex flex-col gap-2">
                  {active.map((l) => (
                    <LessonRow key={l.id} entry={l} />
                  ))}
                  {active.length === 0 && (
                    <p className="text-[13px] text-muted">
                      No active lessons — everything is vetoed.
                    </p>
                  )}
                </div>
              </section>

              {archived.length > 0 && (
                <section className="mt-8">
                  <h2 className="mb-3 text-[14px] font-semibold text-ink-900">
                    Vetoed — kept for the record ({archived.length})
                  </h2>
                  <div className="flex flex-col gap-2">
                    {archived.map((l) => (
                      <LessonRow key={l.id} entry={l} />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
