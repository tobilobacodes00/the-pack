import { Toast } from '@/ui/toast'
import { useToastStore } from '@/store/toast-store'

/** Renders the imperative toast queue (see `store/toast-store.ts`) through the Radix `<Toast>`. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          title={t.title}
          description={t.description}
          duration={t.duration ?? 4000}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id)
          }}
        />
      ))}
    </>
  )
}
