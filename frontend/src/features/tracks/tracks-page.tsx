import { useParams } from 'react-router-dom'
import { useHuntSnapshot, useTracks } from '@/api/hunts'
import { FlightRecorder } from './flight-recorder'

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-canvas px-6 text-center text-sm text-muted">
      {children}
    </div>
  )
}

/** /hunts/:huntId/tracks — the authenticated Flight Recorder: replay this hunt's full event log
 *  on the canvas, decision by decision. */
export default function TracksPage() {
  const { huntId = '' } = useParams<{ huntId: string }>()
  const tracks = useTracks(huntId, !!huntId)
  const snap = useHuntSnapshot(huntId, !!huntId)

  if (tracks.isLoading) return <Centered>Loading the flight record…</Centered>
  if (tracks.isError || !tracks.data) return <Centered>This hunt’s tracks could not be loaded.</Centered>

  const title = (snap.data?.task || '').trim().slice(0, 80) || 'A Pack hunt'
  return (
    <FlightRecorder
      title={title}
      raw={tracks.data}
      briefHref={`/hunts/${huntId}`}
      briefLabel="Back to the hunt"
    />
  )
}
