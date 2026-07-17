import { useParams } from 'react-router-dom'
import { useSharedTracks } from '@/api/hunts'
import { FlightRecorder } from '@/features/tracks/flight-recorder'

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 text-center text-sm text-muted">
      {children}
    </div>
  )
}

/** Public /share/:token/replay — the Flight Recorder behind a shared brief: anyone with the link
 *  can watch HOW the answer was produced (every decision, challenge, and dollar), not just read
 *  the result. The token scopes the replay to exactly one hunt. */
export default function ShareReplayPage() {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, isError } = useSharedTracks(token)

  if (isLoading) return <Centered>Loading the flight record…</Centered>
  if (isError || !data) return <Centered>This shared replay could not be found.</Centered>

  return (
    <FlightRecorder
      title={data.title}
      raw={data.events}
      briefHref={`/share/${token}`}
      briefLabel="Read the brief"
    />
  )
}
