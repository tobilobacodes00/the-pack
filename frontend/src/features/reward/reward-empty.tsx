interface Props {
  kind: 'loading' | 'error' | 'missing'
  message?: string
}

const DEFAULTS: Record<Props['kind'], string> = {
  loading: 'Fetching the Reward…',
  error: 'Could not load the brief.',
  missing: 'No brief yet — the pack is still bringing this hunt home.',
}

export function RewardEmpty({ kind, message }: Props) {
  return (
    <div className="flex h-full items-center justify-center p-10 text-center text-sm text-muted">
      {message ?? DEFAULTS[kind]}
    </div>
  )
}
