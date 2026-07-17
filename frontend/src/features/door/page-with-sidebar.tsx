import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { HuntSidebar } from './hunt-sidebar'
import { color } from '@/lib/theme'

const SLIDE = { duration: 0.28, ease: [0.4, 0, 0.2, 1] as const }

/**
 * The shared shell for admin pages (Settings, Memory, Instincts): the Past-Hunts sidebar beside the
 * content on desktop, and a hamburger-triggered slide-in drawer (with a tap-to-close scrim) on mobile.
 * Fixes the "300px sidebar eats the screen" breakage in one place instead of per page.
 */
export function PageWithSidebar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: color.canvas }}>
      {/* Desktop: sidebar sits in the flow. */}
      <div className="hidden md:flex">
        <HuntSidebar onCollapse={() => setOpen(false)} />
      </div>

      {/* Mobile: a slide-in drawer + scrim. */}
      <AnimatePresence>
        {open && (
          <div className="md:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={SLIDE}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 bg-black/40"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={SLIDE}
              className="fixed left-0 top-0 bottom-0 z-50"
            >
              <HuntSidebar onCollapse={() => setOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto">
        {/* Mobile-only hamburger to open the drawer. */}
        <button
          onClick={() => setOpen(true)}
          className="md:hidden fixed left-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-full border shadow-sm"
          style={{ background: color.surface, borderColor: color.border }}
          aria-label="Open menu"
        >
          <img src="/icon-menu.svg" className="h-5 w-5" alt="" />
        </button>
        {children}
      </div>
    </div>
  )
}
