import { Loader2, Star, Swords } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Scorecard } from '@/api/hunts'
import { accuracyPct, deriveVerdict, hms, usd } from './lib/scorecard-copy'

interface Props {
  scorecard: Scorecard | null | undefined
  loading: boolean
  /** A benchmark run is in flight — POST accepted, scorecard not landed yet. */
  running: boolean
  /** Launch POST failed, or it landed but never produced a scorecard within the poll budget. */
  failed: boolean
  onRun: () => void
  onCancel: () => void
  onExport: () => void
}

function Row({ lone, label, pack }: { lone: ReactNode; label: string; pack: ReactNode }) {
  return (
    // Middle label column and gaps shrink on mobile so the value columns keep room for numbers.
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-3 sm:gap-4">
      <div className="text-right text-[13.5px] text-ink-700 tabular-nums sm:text-[15px]">{lone}</div>
      <div className="w-[76px] text-center text-[11px] text-muted sm:w-[112px] sm:text-[12px]">{label}</div>
      <div className="text-left text-[13.5px] font-medium text-text tabular-nums sm:text-[15px]">{pack}</div>
    </div>
  )
}

export function ScorecardPanel({ scorecard, loading, running, failed, onRun, onCancel, onExport }: Props) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Loading the Scorecard…
      </div>
    )
  }

  if (!scorecard) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center px-5 sm:px-8 text-center">
          {running ? (
            <div>
              <Loader2 size={22} className="mx-auto animate-spin text-brand-500" />
              <p className="mt-3 text-[15px] font-semibold text-ink-900">
                The Lone Wolf is running your task…
              </p>
              <p className="mx-auto mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-muted">
                One solo agent, same task, one pass — then a judge scores both briefs. Usually
                under a minute.
              </p>
            </div>
          ) : (
            <div>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10">
                <Swords size={22} className="text-brand-500" />
              </div>
              <p className="mt-3 text-[15px] font-semibold text-ink-900">Lone Wolf vs the Pack</p>
              <p className="mx-auto mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-muted">
                Re-run this exact task as a single solo agent and score it against the pack —
                sources, accuracy, time, and cost, side by side.
              </p>
              {failed && (
                <p className="mx-auto mt-2 max-w-[340px] text-[12.5px] text-[#DC2626]">
                  The benchmark didn’t finish — try again.
                </p>
              )}
              <button
                type="button"
                onClick={onRun}
                className="mt-5 rounded-full bg-brand-500 px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600"
              >
                Run the benchmark
              </button>
            </div>
          )}
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

  const { lone_wolf: lone, pack } = scorecard

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-5 sm:px-8 py-10">
        <div className="mx-auto max-w-[560px]">
          <div className="flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#F59E0B]/15">
              <Star size={26} className="fill-[#F59E0B] text-[#F59E0B]" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <p className="text-right text-[15px] font-semibold text-ink-700">Lone Wolf</p>
            <p className="text-[12px] uppercase tracking-wide text-text-faint">Vs</p>
            <p className="text-left text-[15px] font-semibold text-text">A Pack</p>
          </div>

          <div className="mt-6 flex flex-col divide-y divide-border border-y border-border">
            <Row lone={lone.sources} label="Sources found" pack={pack.sources} />
            <Row lone={`${accuracyPct(lone)}%`} label="Accuracy" pack={`${accuracyPct(pack)}%`} />
            <Row lone={hms(lone.time_s)} label="Time" pack={hms(pack.time_s)} />
            <Row lone={usd(lone.cost_usd)} label="Cost" pack={usd(pack.cost_usd)} />
          </div>

          <p className="mt-6 text-center text-[13.5px] leading-relaxed text-text-dim">
            {deriveVerdict(scorecard)}
          </p>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
        <button
          onClick={onCancel}
          className="rounded-full px-4 py-2 text-[13px] text-text-dim transition-colors hover:text-text"
        >
          Cancel
        </button>
        <button
          onClick={onExport}
          className="rounded-full bg-brand-500 px-5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Export
        </button>
      </footer>
    </div>
  )
}
