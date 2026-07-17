import * as RadixDialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'

const EASE = [0.4, 0, 0.2, 1] as const

interface Props {
  open: boolean
  onClose: () => void
  header: ReactNode
  children: ReactNode
  drawer?: ReactNode
  /** Overlay pinned absolute against the body row (e.g. Refine card). */
  overlay?: ReactNode
}

// Radix Dialog + framer-motion, warm palette. Portals to body to escape Territory's z-40 stack; ui/dialog.tsx wrappers deliberately not reused (wrong palette + dead anim classes).
export function RewardShell({ open, onClose, header, children, drawer, overlay }: Props) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 bg-[rgba(26,26,26,0.45)] backdrop-blur-sm"
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 10 }}
                transition={{ duration: 0.28, ease: EASE }}
                // Mobile: full-screen. Desktop: a centered card.
                className="fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden border-border bg-white shadow-soft sm:left-1/2 sm:top-1/2 sm:inset-auto sm:h-[min(88vh,880px)] sm:w-[min(1040px,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
              >
                <RadixDialog.Title className="sr-only">The Reward</RadixDialog.Title>
                {header}
                <div className="relative flex min-h-0 flex-1">
                  <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                  {drawer}
                  {overlay}
                </div>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  )
}
