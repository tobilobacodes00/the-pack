import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}
interface State {
  error: Error | null
}

/** Catches render/lifecycle throws so one broken subtree degrades to a recoverable panel, never a
 *  white screen. Wraps the router root and each lazy route (see `app.tsx`). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[pack] render error', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return this.props.fallback ?? <Fallback error={this.state.error} onReset={this.reset} />
    }
    return this.props.children
  }
}

function Fallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <p className="text-sm font-semibold text-text">Something broke here.</p>
      <p className="max-w-[420px] break-words text-xs text-text-dim">{error.message}</p>
      <div className="mt-1 flex gap-2">
        <button
          onClick={onReset}
          className="rounded-full border border-border px-4 py-1.5 text-xs text-text-dim transition-colors hover:text-text"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.assign('/')}
          className="rounded-full bg-brand-500 px-4 py-1.5 text-xs font-medium text-white"
        >
          Go home
        </button>
      </div>
    </div>
  )
}
