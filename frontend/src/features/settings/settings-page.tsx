import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, FileText, Trash2, Upload } from 'lucide-react'
import { useDocuments, useUploadDocument, useDeleteDocument } from '@/api/documents'
import { useSpendSummary, useClearHunts, useResetData } from '@/api/hunts'
import { toast } from '@/store/toast-store'
import { color } from '@/lib/theme'
import { HuntSidebar } from '@/features/door/hunt-sidebar'

function money(n: number): string {
  return `$${(n ?? 0).toFixed(2)}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[15px] font-semibold text-[#EDEDED]">{title}</h2>
      {children}
    </section>
  )
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: documents } = useDocuments()
  const { data: spend } = useSpendSummary()
  const upload = useUploadDocument()
  const deleteDoc = useDeleteDocument()
  const clearHunts = useClearHunts()
  const resetData = useResetData()

  const onClear = () => {
    if (!window.confirm('Clear all hunt history? Documents, memory and instincts are kept.')) return
    clearHunts.mutate(undefined, { onSuccess: () => toast({ title: 'Hunt history cleared', variant: 'success' }) })
  }
  const onReset = () => {
    if (!window.confirm('Reset ALL local data? This wipes hunts, memory, documents, instincts and projects. This cannot be undone.')) return
    resetData.mutate(undefined, { onSuccess: () => toast({ title: 'All data reset', variant: 'success' }) })
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: color.canvas }}>
      <HuntSidebar onCollapse={() => navigate('/')} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 py-10">
          {/* Header */}
          <div className="flex items-start gap-3 border-b pb-5" style={{ borderColor: '#242424' }}>
          <button onClick={() => navigate(-1)} className="mt-0.5 p-1 text-text-dim hover:text-white" aria-label="Back">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-[20px] font-bold text-text">App Settings</h1>
            <p className="mt-1 text-[13px] text-muted">Manage your knowledge base, spend, and local data.</p>
          </div>
        </div>

        {/* Knowledge base */}
        <Section title="Knowledge base">
          <div className="flex flex-col gap-1.5">
            {(documents ?? []).map((d) => (
              <div key={d.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: '#141414', border: '1px solid #202020' }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(239,68,68,0.14)', color: '#F87171' }}>
                  <FileText size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-text">{d.name}</p>
                  <p className="text-[11.5px] uppercase text-[#7A7A7A]">{d.kind} · {d.chars.toLocaleString()} chars</p>
                </div>
                <button
                  onClick={() => deleteDoc.mutate(d.id)}
                  className="shrink-0 p-1 text-[#666] opacity-0 group-hover:opacity-100 transition-opacity hover:text-[#EF4444]"
                  aria-label="Delete document"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {(documents ?? []).length === 0 && (
              <p className="px-1 py-2 text-[13px] text-text-faint">No documents in the knowledge base yet.</p>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".pdf,.csv,.txt,.md,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f, { onSuccess: () => toast({ title: 'Document added', variant: 'success' }) })
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
            className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-[#D4D4D4] transition-colors hover:text-white disabled:opacity-50"
            style={{ background: color.borderSubtle, border: '1px solid #404040' }}
          >
            <Upload size={15} /> {upload.isPending ? 'Adding…' : 'Add Document'}
          </button>
        </Section>

        {/* Spend */}
        <Section title="Spend">
          <div className="mb-3 inline-block rounded-full px-3.5 py-1.5 text-[13px] font-semibold" style={{ background: color.text, color: color.canvas }}>
            Total spent: {money(spend?.total_usd ?? 0)}
          </div>
          <div className="flex flex-col gap-1">
            {(spend?.hunts ?? []).map((h) => (
              <div key={h.hunt_id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[rgba(255,255,255,0.03)]">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#E4E4E4]">{h.title}</span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-[#9A9A9A]">{money(h.cost_usd)}</span>
              </div>
            ))}
            {(spend?.hunts ?? []).length === 0 && (
              <p className="px-1 py-2 text-[13px] text-text-faint">No spend recorded yet.</p>
            )}
          </div>
        </Section>

        {/* Local data */}
        <Section title="Local data">
          <div className="flex items-center gap-3">
            <button
              onClick={onClear}
              disabled={clearHunts.isPending}
              className="rounded-full px-4 py-2 text-[13px] text-[#D4D4D4] transition-colors hover:text-white disabled:opacity-50"
              style={{ background: color.borderSubtle, border: '1px solid #404040' }}
            >
              Clear hunt history
            </button>
            <button
              onClick={onReset}
              disabled={resetData.isPending}
              className="ml-auto rounded-full px-4 py-2 text-[13px] font-medium text-white transition-colors disabled:opacity-50"
              style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.4)', color: '#F87171' }}
            >
              Reset Data
            </button>
          </div>
        </Section>
      </div>
      </div>
    </div>
  )
}
