import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, MoreVertical } from 'lucide-react'
import { useInstincts, useDeleteInstinct } from '@/api/instincts'
import { useCreateHunt } from '@/api/hunts'
import { color } from '@/lib/theme'
import { AnimatePresence, motion } from 'framer-motion'
import { HuntSidebar } from '../door/hunt-sidebar'

type Builtin = { id: string; title: string; desc: string; inHint: string; out: string[]; prompt: string }

/** Ready-made packs. `prompt` seeds the Door composer so the user adds their specifics before sending. */
const BUILTINS: Builtin[] = [
  {
    id: 'deep-research',
    title: 'Deep Research',
    desc: 'Investigate a topic across many sources. The pack ranges wide, cross-references everything, and hands back a sourced report you can trust.',
    inHint: 'A topic, a question, or a brief',
    out: ['DOCX', 'PDF', 'MD'],
    prompt: 'Research and write a sourced report on: ',
  },
  {
    id: 'summarize-extract',
    title: 'Summarize & Extract',
    desc: 'Drop in your files. The pack reads them, pulls out what matters, and answers your questions.',
    inHint: 'Documents, PDFs, or notes',
    out: ['DOCX', 'MD'],
    prompt: 'Summarize and extract the key points from: ',
  },
]

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((f) => (
        <span key={f} className="rounded-md px-2 py-0.5 text-[11px] font-medium text-ink-700" style={{ background: '#f2f2f0' }}>
          {f}
        </span>
      ))}
    </div>
  )
}

function UseThis({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] text-ink-700 transition-colors hover:text-ink-900"
      style={{ borderColor: color.border }}
    >
      Use This
    </button>
  )
}

function Tabs({ tab, setTab }: { tab: 'builtin' | 'yours'; setTab: (t: 'builtin' | 'yours') => void }) {
  return (
    <div className="flex gap-1 border-b pb-3" style={{ borderColor: '#dcdcd8' }}>
      {(['builtin', 'yours'] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTab(t)}
          className="rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"
          style={tab === t ? { background: color.raised, color: color.text } : { background: 'none', color: '#7A7A7A' }}
        >
          {t === 'builtin' ? 'Built-in instincts' : 'Your instincts'}
        </button>
      ))}
    </div>
  )
}

export default function InstinctsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'builtin' | 'yours'>('builtin')
  const [menuId, setMenuId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { data: instincts, isLoading } = useInstincts()
  const deleteInstinct = useDeleteInstinct()
  const createHunt = useCreateHunt()

  const applyBuiltin = (b: Builtin) => navigate('/', { state: { seed: b.prompt } })
  const applyInstinct = (id: string) =>
    createHunt.mutate({ instinct_id: id }, { onSuccess: (r) => navigate(`/hunts/${r.hunt_id}`) })

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: color.canvas }}>
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 300, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="shrink-0 h-full border-r z-30 overflow-hidden"
            style={{ borderColor: color.border, background: color.surface }}
          >
            <HuntSidebar onCollapse={() => setSidebarOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 py-10">
          {/* Header */}
          <div className="flex items-start gap-3">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="mt-1.5 p-1 text-text-dim hover:text-ink-900 transition-opacity" aria-label="Open sidebar">
                <img src="/icon-menu.svg" className="w-5 h-5" alt="Menu" />
              </button>
            )}
            <button onClick={() => navigate(-1)} className="mt-1 p-1 text-text-dim hover:text-ink-900" aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-[22px] font-bold text-text">Instincts</h1>
            <p className="mt-1 text-[13.5px] text-muted">
              Ready-made packs for the jobs you reach for most. Pick one, tailor it, send it.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Tabs tab={tab} setTab={setTab} />
        </div>

        {tab === 'builtin' ? (
          <div className="mt-1 flex flex-col divide-y" style={{ borderColor: color.borderSubtle }}>
            {BUILTINS.map((b) => (
              <div key={b.id} className="flex flex-col gap-3 py-5" style={{ borderColor: color.borderSubtle }}>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-[15px] font-semibold text-text">{b.title}</h3>
                  <UseThis onClick={() => applyBuiltin(b)} />
                </div>
                <p className="text-[13.5px] leading-relaxed text-ink-500">{b.desc}</p>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-text-faint">In</span>
                    <span className="rounded-md px-2 py-0.5 text-[11.5px] text-ink-700" style={{ background: '#f2f2f0' }}>{b.inHint}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-text-faint">Out</span>
                    <Chips items={b.out} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : instincts && instincts.length === 0 && !isLoading ? (
          <div className="mt-16 flex flex-col items-center gap-1 text-center">
            <p className="text-[14px] font-medium text-text-dim">No instincts yet</p>
            <p className="text-[12.5px] text-text-faint">Save one from a finished hunt</p>
          </div>
        ) : (
          <div className="mt-1 flex flex-col divide-y" style={{ borderColor: color.borderSubtle }}>
            {(instincts ?? []).map((it) => {
              const rawTask = it.spec?.task
              const task = typeof rawTask === 'string' ? rawTask : ''
              return (
                <div key={it.instinct_id} className="relative flex flex-col gap-2 py-5" style={{ borderColor: color.borderSubtle }}>
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text">{it.label}</h3>
                    <div className="flex items-center gap-2">
                      <UseThis onClick={() => applyInstinct(it.instinct_id)} />
                      <button
                        onClick={() => setMenuId(menuId === it.instinct_id ? null : it.instinct_id)}
                        className="p-1 text-muted hover:text-ink-900"
                        aria-label="More"
                      >
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </div>
                  {task && <p className="text-[13.5px] leading-relaxed text-ink-500">{task}</p>}
                  {menuId === it.instinct_id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuId(null)} />
                      <div
                        className="absolute right-0 top-12 z-[41] rounded-lg p-1"
                        style={{ background: color.borderSubtle, border: '1px solid #dcdcd8', boxShadow: '0 10px 24px rgba(26,26,26,0.12)' }}
                      >
                        <button
                          onClick={() => { deleteInstinct.mutate(it.instinct_id); setMenuId(null) }}
                          className="rounded-md px-3 py-1.5 text-[13px] text-[#EF4444] hover:bg-[rgba(26,26,26,0.05)]"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
