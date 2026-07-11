import { useParams } from 'react-router-dom'
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
        <ReadingView brief={brief} />
      </div>
    </div>
  )
}
