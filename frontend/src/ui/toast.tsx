import * as RadixToast from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const ToastProvider = RadixToast.Provider
export const ToastViewport = () => (
  // Mobile: span the width with side insets so a toast never overflows a narrow screen. sm+: the fixed panel.
  <RadixToast.Viewport className="fixed inset-x-3 bottom-3 z-[100] flex max-h-screen w-auto flex-col gap-2 outline-none sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px]" />
)

interface ToastProps extends RadixToast.ToastProps {
  variant?: 'default' | 'warn' | 'danger' | 'success'
  title: string
  description?: string
}

const TIMER_COLOR: Record<NonNullable<ToastProps['variant']>, string> = {
  default: 'var(--color-brand-400)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
  success: 'var(--color-success)',
}

export function Toast({ variant = 'default', title, description, className, ...props }: ToastProps) {
  // The countdown bar mirrors the actual auto-dismiss time (`duration`, default 4000ms). A sticky toast
  // (duration Infinity / <=0) gets no bar. Radix pauses its own timer on hover; the bar pauses in step.
  const duration = props.duration ?? 4000
  const showTimer = Number.isFinite(duration) && duration > 0

  return (
    <RadixToast.Root
      className={cn(
        'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 shadow-soft',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-80 data-[state=open]:fade-in-0',
        'data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-right-full',
        {
          default: 'border-border bg-surface',
          warn: 'border-warn/30 bg-surface',
          danger: 'border-danger/30 bg-surface',
          success: 'border-success/30 bg-surface',
        }[variant],
        className,
      )}
      {...props}
    >
      <div className="flex-1 gap-1">
        <RadixToast.Title
          className={cn('text-sm font-semibold', {
            default: 'text-text',
            warn: 'text-warn',
            danger: 'text-danger',
            success: 'text-success',
          }[variant])}
        >
          {title}
        </RadixToast.Title>
        {description && (
          <RadixToast.Description className="mt-0.5 text-xs text-text-dim">
            {description}
          </RadixToast.Description>
        )}
      </div>
      <RadixToast.Close className="shrink-0 rounded-sm p-1 opacity-50 hover:opacity-100">
        <X className="h-4 w-4 text-text-dim" />
      </RadixToast.Close>

      {/* Countdown bar — shrinks over `duration`, pauses while the toast is hovered (as Radix does). */}
      {showTimer && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] origin-left group-hover:[animation-play-state:paused]"
          style={{
            background: TIMER_COLOR[variant],
            animation: `toast-timer ${duration}ms linear forwards`,
          }}
        />
      )}
    </RadixToast.Root>
  )
}
