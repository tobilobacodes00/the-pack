interface Props {
  kind: 'loading' | 'error' | 'missing' | 'ended'
  message?: string
}

const DEFAULTS: Record<Props['kind'], string> = {
  loading: 'Fetching the Reward…',
  error: 'Could not load the brief.',
  missing: 'No brief yet — the pack is still bringing this hunt home.',
  // A terminal hunt (failed / stopped) that never produced a brief: be honest, not optimistic.
  // The old copy said "still bringing this hunt home" for a hunt that had already died.
  ended: 'This hunt ended before it produced a brief. Start a new one to try again.',
}

export function RewardEmpty({ kind, message }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted">
      {message ?? DEFAULTS[kind]}
    </div>
  )
}
