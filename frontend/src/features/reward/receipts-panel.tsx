import { AlertTriangle, BadgeCheck, CircleAlert, Download, FileSearch, ShieldX } from 'lucide-react'
import type { Receipts, ReceiptClaim } from '@/api/hunts'
import { wolfLabel } from './lib/wolf-label'

interface Props {
  receipts: Receipts | null | undefined
  loading: boolean
  onCancel: () => void
}

const STATUS: Record<ReceiptClaim['status'], { label: string; className: string }> = {
  verified: { label: 'Verified', className: 'bg-emerald-500/10 text-emerald-700' },
  cited: { label: 'Cited', className: 'bg-sky-500/10 text-sky-700' },
  challenged_kept: { label: 'Challenged · kept', className: 'bg-amber-500/10 text-amber-700' },
  unsourced: { label: 'Unsourced', className: 'bg-rose-500/10 text-rose-700' },
}

/** Render the receipts as a Markdown appendix the user can attach anywhere. */
export function receiptsMarkdown(r: Receipts): string {
  const lines: string[] = ['# Receipts', '']
  lines.push(
    `${r.totals.claims ?? r.claims.length} claims · ${r.totals.verified ?? 0} verified · ` +
      `${r.totals.challenged_kept ?? 0} challenged & kept · ${r.totals.dropped ?? 0} dropped in verification`,
    '',
  )
  if (!r.critique_ran) {
    lines.push(
      `> ⚠️ Verification didn't complete${r.review_note ? ` — ${r.review_note}` : ''}. These claims are unverified.`,
      '',
    )
  }
  for (const c of r.claims) {
    lines.push(`## ${c.text}`, `Status: ${STATUS[c.status].label}`)
    if (c.challenge?.problem) lines.push(`Challenge: ${c.challenge.problem}`)
    for (const s of c.sources) {
      const who = s.library ? 'your library' : s.by || 'the pack'
      lines.push(`- [${s.n}] ${s.title || s.url} — ${s.url} (found by ${who}${s.verified ? ', read in full' : ''})`)
    }
    lines.push('')
  }
  if (r.dropped.length) {
    lines.push('## Dropped in verification', '')
    for (const d of r.dropped) lines.push(`- ${d.text} — ${d.problem}`)
    lines.push('')
  }
  if (r.standoff) {
    lines.push(
      '## Standoff',
      `${r.standoff.challenger} challenged ${r.standoff.defendant} — outcome: ${r.standoff.outcome}.` +
        (r.standoff.rationale ? ` ${r.standoff.rationale}` : ''),
      '',
    )
  }
  if (r.documents.length) {
    lines.push('## Your documents used', '')
    for (const d of r.documents) lines.push(`- ${d.title || d.doc_id} — cited by ${d.cited_by_claims} claim(s)`)
    lines.push('')
  }
  return lines.join('\n')
}

function downloadMarkdown(r: Receipts) {
  const blob = new Blob([receiptsMarkdown(r)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'receipts.md'
  a.click()
  URL.revokeObjectURL(url)
}

function SourceLine({ s }: { s: Receipts['claims'][number]['sources'][number] }) {
  const who = s.library ? 'your library' : wolfLabel(s.by).label || s.by || 'the pack'
  return (
    <li className="flex items-baseline gap-2 text-[12.5px] leading-snug">
      <span className="shrink-0 tabular-nums text-text-faint">[{s.n}]</span>
      {s.library ? (
        <span className="min-w-0 truncate text-text-dim">{s.title || s.url}</span>
      ) : (
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-text-dim underline decoration-border underline-offset-2 hover:text-text"
        >
          {s.title || s.url}
        </a>
      )}
      <span className="shrink-0 text-[11.5px] text-text-faint">
        {who}
        {s.verified ? ' · read' : ''}
      </span>
    </li>
  )
}

/**
 * The Receipts — the brief's per-claim audit trail: every claim, its sources (who found each,
 * was the page actually read), the Sentinel's challenges, and what got dropped. The whole point:
 * an answer you can hand to someone with its proof attached.
 */
export function ReceiptsPanel({ receipts, loading, onCancel }: Props) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Pulling the receipts…
      </div>
    )
  }

  if (!receipts) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-5 sm:px-8 text-center">
          <div>
            <FileSearch size={22} className="mx-auto text-muted" />
            <p className="mt-3 text-[15px] font-semibold text-ink-900">No receipts yet</p>
            <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-muted">
              Receipts are composed from the delivered brief — finish the hunt first.
            </p>
          </div>
        </div>
        <footer className="flex shrink-0 justify-end border-t border-border px-6 py-4">
          <button
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-[13px] text-text-dim transition-colors hover:text-text"
          >
            Back to the brief
          </button>
        </footer>
      </div>
    )
  }

  const t = receipts.totals

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-8">
        <div className="mx-auto max-w-[620px]">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
              <BadgeCheck size={22} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-text">Receipts</p>
              <p className="text-[12.5px] text-muted">
                {t.claims ?? receipts.claims.length} claims · {t.verified ?? 0} verified ·{' '}
                {t.challenged_kept ?? 0} challenged &amp; kept · {t.dropped ?? 0} dropped
              </p>
            </div>
          </div>

          {/* Honest state: the Sentinel never completed its review — say so plainly, with the reason. */}
          {!receipts.critique_ran && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12.5px] text-amber-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                Verification didn’t complete
                {receipts.review_note ? ` — ${receipts.review_note}` : ''}. These claims are
                unverified.
              </span>
            </div>
          )}

          {/* Per-claim rows */}
          <ul className="mt-6 flex flex-col divide-y divide-border border-y border-border">
            {receipts.claims.map((c, i) => (
              <li key={i} className="py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13.5px] leading-relaxed text-text">{c.text}</p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS[c.status].className}`}
                  >
                    {STATUS[c.status].label}
                  </span>
                </div>
                {c.challenge?.problem && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-amber-700">
                    <CircleAlert size={13} className="mt-0.5 shrink-0" />
                    Sentinel: {c.challenge.problem}
                  </p>
                )}
                {c.sources.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {c.sources.map((s) => (
                      <SourceLine key={s.n} s={s} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {/* Enforcement on display — what did NOT make the brief. */}
          {receipts.dropped.length > 0 && (
            <div className="mt-6">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                <ShieldX size={14} className="text-rose-600" />
                Dropped in verification
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {receipts.dropped.map((d, i) => (
                  <li key={i} className="text-[12.5px] leading-snug text-text-dim">
                    <span className="line-through decoration-rose-300">{d.text}</span>
                    <span className="text-text-faint"> — {d.problem}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {receipts.standoff && (
            <p className="mt-6 rounded-xl bg-amber-500/5 px-4 py-3 text-[12.5px] leading-relaxed text-text-dim">
              <span className="font-semibold text-text">Standoff.</span>{' '}
              {wolfLabel(receipts.standoff.challenger).label} challenged{' '}
              {wolfLabel(receipts.standoff.defendant).label} — outcome:{' '}
              {receipts.standoff.outcome.replace('_', ' ')}.
              {receipts.standoff.rationale ? ` ${receipts.standoff.rationale}` : ''}
            </p>
          )}

          {receipts.documents.length > 0 && (
            <div className="mt-6">
              <p className="text-[13px] font-semibold text-text">Your documents used</p>
              <ul className="mt-2 flex flex-col gap-1">
                {receipts.documents.map((d) => (
                  <li key={d.doc_id} className="text-[12.5px] text-text-dim">
                    {d.title || `Document ${d.doc_id}`} · cited by {d.cited_by_claims} claim
                    {d.cited_by_claims === 1 ? '' : 's'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
        <button
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-[13px] text-text-dim transition-colors hover:text-text"
        >
          Back to the brief
        </button>
        <button
          onClick={() => downloadMarkdown(receipts)}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600"
        >
          <Download size={13} />
          Download .md
        </button>
      </footer>
    </div>
  )
}
