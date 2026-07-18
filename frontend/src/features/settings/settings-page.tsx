import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, FileText, Trash2, Upload } from 'lucide-react'
import { useDocuments, useDocument, useUploadDocument, useDeleteDocument } from '@/api/documents'
import { useSpendSummary, useClearHunts, useResetData } from '@/api/hunts'
import { toast } from '@/store/toast-store'
import { color } from '@/lib/theme'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'
import { PageWithSidebar } from '@/features/door/page-with-sidebar'

function money(n: number): string {
  return `$${(n ?? 0).toFixed(2)}`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[15px] font-semibold text-ink-900">{title}</h2>
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
  // The KB doc whose full extracted text is open in the viewer (null = closed).
  const [viewDocId, setViewDocId] = useState<number | null>(null)
  const { data: viewDoc, isLoading: viewLoading } = useDocument(viewDocId)

  const onClear = () => {
    if (!window.confirm("Clear this browser's hunt history? Your documents and instincts are kept.")) return
    clearHunts.mutate(undefined, { onSuccess: () => toast({ title: 'Hunt history cleared', variant: 'success' }) })
  }
  const onReset = () => {
    if (!window.confirm("Reset this browser's history and spend? This clears the hunts shown here on this device. It cannot be undone.")) return
    resetData.mutate(undefined, { onSuccess: () => toast({ title: 'History reset', variant: 'success' }) })
  }

  return (
    <PageWithSidebar>
        <div className="mx-auto w-full max-w-[720px] px-5 py-8 sm:px-6 sm:py-10">
          {/* Header — extra left room on mobile so it clears the fixed hamburger. */}
          <div className="flex items-start gap-3 border-b pb-5 pl-12 md:pl-0" style={{ borderColor: '#dcdcd8' }}>
          <button onClick={() => navigate(-1)} className="mt-0.5 p-1 text-text-dim hover:text-ink-900" aria-label="Back">
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
              <div key={d.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: '#ffffff', border: '1px solid #dcdcd8' }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: '#f2f2f0', color: '#4a4a4a' }}>
                  <FileText size={17} />
                </span>
                {/* Click to see the full text the pack actually extracted from this upload. */}
                <button
                  onClick={() => setViewDocId(d.id)}
                  className="min-w-0 flex-1 text-left"
                  title="View extracted text"
                >
                  <p className="truncate text-[13.5px] font-medium text-text group-hover:underline">{d.name}</p>
                  <p className="text-[11.5px] uppercase text-ink-500">{d.kind} · {d.chars.toLocaleString()} chars</p>
                </button>
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
            className="mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-ink-700 transition-colors hover:text-ink-900 disabled:opacity-50"
            style={{ background: color.borderSubtle, border: '1px solid #dcdcd8' }}
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
              <div key={h.hunt_id} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-[rgba(26,26,26,0.04)]">
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-900">{h.title}</span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-ink-500">{money(h.cost_usd)}</span>
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
              className="rounded-full px-4 py-2 text-[13px] text-ink-700 transition-colors hover:text-ink-900 disabled:opacity-50"
              style={{ background: color.borderSubtle, border: '1px solid #dcdcd8' }}
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

      {/* Extracted-text viewer — "what the pack actually read from this file". Opens on a doc-row click. */}
      <Dialog open={viewDocId != null} onOpenChange={(o) => !o && setViewDocId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewDoc?.name ?? 'Document'}</DialogTitle>
            {viewDoc && (
              <p className="text-[12px] uppercase text-ink-500">
                {viewDoc.kind} · {viewDoc.chars.toLocaleString()} chars
              </p>
            )}
          </DialogHeader>
          <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-canvas p-4">
            {viewLoading ? (
              <p className="text-[13px] text-text-faint">Loading…</p>
            ) : viewDoc?.text ? (
              <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink-900">
                {viewDoc.text}
              </pre>
            ) : (
              <p className="text-[13px] text-text-faint">No text was extracted from this file.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageWithSidebar>
  )
}
