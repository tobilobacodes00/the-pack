import { Link, useParams } from 'react-router-dom'
import { Play } from 'lucide-react'
import type { Brief } from '@/api/hunts'
import { useShared } from '@/api/hunts'
import { ReadingView } from '@/features/reward/reading-view'

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-sm text-muted">
      {children}
    </div>
  )
}

/** Public, read-only view of a shared brief — the destination of a copied /share/:token link. */
export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, isError } = useShared(token)

  if (isLoading) return <Centered>Loading…</Centered>
  if (isError || !data?.content) return <Centered>This shared brief could not be found.</Centered>

  const brief: Brief = {
    artifact_id: '',
    hunt_id: '',
    kind: 'final',
    produced_by: 'howler',
    content: data.content,
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-[900px]">
        {/* The receipts-forward move: a shared brief always offers its own replay — how the
            answer was produced, not just the answer. */}
        <div className="flex justify-end px-6 pt-4">
          <Link
            to={`/share/${token}/replay`}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-[13px] text-text-dim transition-colors hover:text-text"
          >
            <Play size={13} />
            Watch how it was made
          </Link>
        </div>
        <ReadingView brief={brief} />
      </div>
    </div>
  )
}
