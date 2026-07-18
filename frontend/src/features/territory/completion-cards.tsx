import { useState } from 'react'
import { FileText, MoreVertical, Download, Copy, Bookmark, Check } from 'lucide-react'
import { useHuntArtifacts, useDownloadArtifact, useHuntBrief, useHuntSnapshot } from '@/api/hunts'
import type { ArtifactMeta } from '@/api/hunts'
import { useCreateInstinct } from '@/api/instincts'
import { buildInstinctPayload } from '../reward/lib/instinct-spec'
import { useHuntStore } from '@/store/hunt-store'
import { toast } from '@/store/toast-store'
import { ChoiceCard } from './choice-card'
import { color } from '@/lib/theme'

// A subset of the Forge's real exports (docx == "Docs"). PNG excluded — a flattened image of a
// text brief isn't a format anyone wants.
const PICKER: Array<{ kind: string; label: string }> = [
  { kind: 'pdf', label: 'PDF' },
  { kind: 'docx', label: 'Docs' },
]

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        background: 'none', border: 'none', color: '#4a4a4a', fontSize: 13, padding: '8px 10px',
        borderRadius: 7, cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(26,26,26,0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ color: '#6b6b6b', display: 'flex' }}>{icon}</span>
      {label}
    </button>
  )
}

/**
 * The completion surface (matches "Hunt complete" → "Finished"): first a format picker (real Forge
 * exports), then a result file card with a ⋮ menu — Download, Copy (brief text), Save Instinct. The
 * full reading view (provenance + sources) opens on demand via the reward modal.
 */
export function CompletionCards({ huntId, onOpenReward }: { huntId: string; onOpenReward: () => void }) {
  const { data: artifacts, isLoading: artifactsLoading } = useHuntArtifacts(huntId, true)
  const { data: brief } = useHuntBrief(huntId, true)
  const { data: snap } = useHuntSnapshot(huntId, true)
  const download = useDownloadArtifact(huntId)
  const createInstinct = useCreateInstinct()
  const plan = useHuntStore((s) => s.state.plan)

  const [stage, setStage] = useState<'pick' | 'result'>('pick')
  const [sel, setSel] = useState<number | null>(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  const artFor = (kind: string): ArtifactMeta | undefined => (artifacts ?? []).find((a) => a.kind === kind)
  const title = (snap?.task ?? 'Your brief').slice(0, 48)

  if (stage === 'pick') {
    // Only advance once the download is actually underway — a missing artifact used to silently
    // no-op and still flip to the result stage, discarding the picker with no way back.
    const submit = () => {
      if (sel == null) {
        setStage('result')
        return
      }
      if (artifactsLoading) {
        toast({ title: 'Still finishing up the exports — try again in a moment.', variant: 'warn' })
        return
      }
      const art = artFor(PICKER[sel].kind)
      if (!art) {
        toast({ title: `No ${PICKER[sel].label} export for this hunt — try another format.`, variant: 'warn' })
        return
      }
      download.mutate(art, { onSuccess: () => setStage('result') })
    }
    return (
      <ChoiceCard
        title="How would you like your result?"
        description="Your hunt is done, choose a format for your results"
        options={PICKER.map((p) => ({ label: p.label }))}
        selected={sel}
        onSelect={setSel}
        onSubmit={submit}
        onSkip={() => setStage('result')}
        submitting={download.isPending}
        submitLabel="Download"
      />
    )
  }

  const doCopy = () => {
    void navigator.clipboard.writeText(brief?.content?.text ?? '')
    setCopied(true)
    setMenuOpen(false)
  }
  const doDownload = () => {
    const art = artFor('pdf') ?? (artifacts ?? [])[0]
    if (art) download.mutate(art)
    setMenuOpen(false)
  }
  const doSaveInstinct = () => {
    createInstinct.mutate(buildInstinctPayload('', snap?.task ?? '', plan))
    setSaved(true)
    setMenuOpen(false)
  }

  return (
    <div style={{ margin: 12 }}>
      <p style={{ margin: '0 0 10px', fontSize: 13, color: '#4a4a4a', lineHeight: 1.6 }}>
        The hunt is done. Here's what the pack brought back.
      </p>

      {/* The whole card opens the reading view — no separate button. The ⋮ menu stops propagation. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenReward}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpenReward() }}
        style={{
          position: 'relative', background: color.surface, border: `1px solid ${color.border}`, borderRadius: 12,
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#5a5a5a')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#dcdcd8')}
      >
        <span
          style={{
            width: 36, height: 36, borderRadius: 8, flexShrink: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.14)', color: '#F87171',
          }}
        >
          <FileText size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: color.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b6b6b' }}>Open to read the full brief →</p>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
          style={{ background: 'none', border: 'none', color: '#6b6b6b', cursor: 'pointer', padding: 4, display: 'flex' }}
          aria-label="More"
        >
          <MoreVertical size={18} />
        </button>

        {menuOpen && (
          <>
            <div 
              style={{ position: 'fixed', inset: 0, zIndex: 10 }} 
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} 
            />
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', top: '100%', right: 8, marginTop: 4, background: color.borderSubtle,
                border: `1px solid ${color.border}`, borderRadius: 10, padding: 4, minWidth: 156, zIndex: 20,
                boxShadow: '0 8px 24px rgba(26,26,26,0.14)',
              }}
            >
              <MenuItem icon={<Download size={14} />} label="Download" onClick={doDownload} />
              <MenuItem icon={copied ? <Check size={14} /> : <Copy size={14} />} label={copied ? 'Copied' : 'Copy'} onClick={doCopy} />
              <MenuItem icon={saved ? <Check size={14} /> : <Bookmark size={14} />} label={saved ? 'Saved' : 'Save Instinct'} onClick={doSaveInstinct} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
