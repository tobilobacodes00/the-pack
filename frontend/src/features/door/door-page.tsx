import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useDoorLogic } from '../intake/use-intake'
import { PresetCard, PRESETS } from '../intake/preset-card'
import { FileDropOverlay } from '../intake/file-drop-overlay'
import { LeftPanel } from '../territory/left-panel'
import { TerritoryFooter, composerVisible } from '../territory/territory-footer'
import { useReward } from '../reward/use-reward'
import { useHuntToast } from '../territory/use-hunt-toast'
import { ChatColumn } from './chat-column'
import { HuntSidebar } from './hunt-sidebar'
import { DoorLanding } from './door-landing'
import { useHuntStore } from '@/store/hunt-store'
import { useHuntStream } from '@/hooks/use-hunt-stream'
import { useApprovePlan } from '@/api/hunts'
import { color } from '@/lib/theme'

// Territory-only surfaces (and the fluid smoke) load on demand: keeps @xyflow/react and the
// reward flow out of the landing bundle entirely, so the Door paints with chat+landing code only.
const GraphCanvas = lazy(() => import('../territory/graph-canvas').then((m) => ({ default: m.GraphCanvas })))
const FormationEditor = lazy(() =>
  import('../territory/formation-editor/formation-editor').then((m) => ({ default: m.FormationEditor })),
)
const RewardModal = lazy(() => import('../reward/reward-modal').then((m) => ({ default: m.RewardModal })))
const SplashCursor = lazy(() => import('@/ui/splash-cursor'))

const MORPH = { duration: 0.55, ease: [0.4, 0, 0.2, 1] as const }

// Centered intake chat that morphs in place into territory when Alpha signals a real
// job — one continuous animation, chat stays mounted, no route change (see useDoorLogic).
export default function DoorPage() {
  const door = useDoorLogic()
  const { phase, huntId, isDragging, onDragEnter, onDragOver, onDragLeave, onDrop } = door

  const huntState = useHuntStore((s) => s.state)
  const resetHunt = useHuntStore((s) => s.reset)
  const applyLocalEdits = useHuntStore((s) => s.applyLocalEdits)
  const [editing, setEditing] = useState(false)
  // First paint leads with the chat: sidebar starts collapsed (the top-nav hamburger opens
  // Past Hunts on demand), so the intake chat renders centered and full-width.
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Tracks whether you've scrolled into the landing sections (hides the scroll-to-explore cue).
  const [pastHero, setPastHero] = useState(false)
  useEffect(() => {
    if (phase === 'territory') return
    const onScroll = () => setPastHero(window.scrollY > window.innerHeight * 0.6)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [phase])
  useHuntStream(huntId)

  // Smoke is a cursor effect — only mount it where a real cursor exists. Touch devices skip
  // the full-screen fluid sim entirely (their scroll stays butter).
  const finePointer = useMemo(() => window.matchMedia('(pointer: fine)').matches, [])

  // Quietly warm the territory chunks once the landing has settled, so the intake→territory
  // morph never waits on the network even though the landing didn't pay for them up front.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void import('../territory/graph-canvas')
      void import('../reward/reward-modal')
    }, 3500)
    return () => window.clearTimeout(t)
  }, [])

  // Fresh door session: clear any hunt state left over from a prior visit (the store
  // is a global singleton and survives SPA nav back to '/'), so the canvas that opens
  // on the first message doesn't flash a previous hunt's formation.
  useEffect(() => {
    resetHunt()
  }, [resetHunt])

  const navigate = useNavigate()
  // Seed the composer when arriving from a built-in Instinct's "Use This".
  const location = useLocation()
  useEffect(() => {
    const seed = (location.state as { seed?: string } | null)?.seed
    if (seed) door.setInput(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { mutate: approvePlan, isPending: approving } = useApprovePlan(huntId ?? '')
  const reward = useReward(huntId)
  useHuntToast(huntState.status)

  const isTerritory = phase === 'territory'
  const canEdit = huntState.status === 'plan_ready' && huntState.plan !== null

  const planFooter = (
    <TerritoryFooter
      huntId={huntId}
      huntState={huntState}
      onApprove={approvePlan}
      approving={approving}
      onEditFormation={() => setEditing(true)}
      onOpenReward={reward.openReward}
    />
  )
  const hideComposer = !composerVisible(huntState.status)

  return (
    <div
      className={isTerritory ? 'h-screen flex flex-col overflow-hidden' : 'min-h-screen flex flex-col'}
      style={{ backgroundColor: color.canvas }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* The wolf (hero emblem → pack → big lone wolf) lives entirely in DoorLanding's PackReveal
          now — one continuous fixed element across the whole scroll, so there's no separate hero
          wolf to hand off from. */}
      {/* Fluid smoke rides the cursor across the ENTIRE landing (hero + every section below).
          Desktop-only (needs a cursor) and lazy — it never blocks the landing's first paint. */}
      {!isTerritory && finePointer && (
        <Suspense fallback={null}>
        <SplashCursor
          SIM_RESOLUTION={96}
          DYE_RESOLUTION={720}
          PRESSURE_ITERATIONS={12}
          DENSITY_DISSIPATION={8}
          VELOCITY_DISSIPATION={2.5}
          PRESSURE={0.1}
          CURL={25}
          SPLAT_RADIUS={0.08}
          SPLAT_FORCE={4500}
          COLOR_UPDATE_SPEED={10}
          SHADING={true}
          RAINBOW_MODE={false}
          COLOR="#6b6b6b"
        />
        </Suspense>
      )}

      {/* HERO — always exactly one viewport; the landing (intake only) scrolls in below it. */}
      <div className={isTerritory ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : 'relative h-screen flex flex-col'}>
      {/* Top nav — intake only, and only while the sidebar is collapsed (the sidebar carries its own
          header). The roster carries the branding once we're in territory. */}
      <AnimatePresence>
        {!isTerritory && !sidebarOpen && (
          <motion.nav
            key="nav"
            exit={{ opacity: 0, height: 0 }}
            transition={MORPH}
            className="h-[52px] flex items-stretch shrink-0 overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5" style={{ backgroundColor: color.surface }}>
              <img src="/pack-logo.svg" className="w-[22px] h-[26px]" alt="Pack" />
              <span className="text-sm font-semibold text-white tracking-wide">The Pack</span>
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1 opacity-70 hover:opacity-100 transition-opacity"
                aria-label="Open past hunts"
              >
                <img src="/icon-menu.svg" className="w-5 h-5" alt="" />
              </button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      <div className="flex-1 relative overflow-hidden min-h-0">
        {/* Past-Hunts sidebar — intake only, slides in from the left when the hamburger is tapped. */}
        <AnimatePresence>
          {!isTerritory && sidebarOpen && (
            <motion.div
              key="sidebar"
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={MORPH}
              className="absolute left-0 top-0 bottom-0 z-30"
            >
              <HuntSidebar onCollapse={() => setSidebarOpen(false)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Full-bleed canvas — the sidebars float on top of it. */}
        <AnimatePresence>
          {isTerritory && (
            <motion.div
              key="graph"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={MORPH}
              className="absolute inset-0 z-0 flex"
            >
              <Suspense fallback={null}>
                <GraphCanvas huntState={huntState} />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Left roster — floating overlay on top of the canvas */}
        <AnimatePresence>
          {isTerritory && (
            <motion.div
              key="roster"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={MORPH}
              className="absolute left-3 top-3 bottom-3 z-20 overflow-hidden flex"
            >
              <LeftPanel huntState={huntState} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat — rendered differently depending on phase. Standard page transition. */}
        <AnimatePresence mode="popLayout">
          {isTerritory ? (
            <motion.div
              key="territory-chat"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MORPH}
              className="absolute right-3 top-3 bottom-3 w-[320px] z-20 flex flex-col min-h-0 overflow-hidden"
              style={{ background: color.surface, border: '1px solid #404040', borderRadius: 16 }}
            >
              <ChatColumn
                variant="territory"
                {...door}
                footer={planFooter}
                hideComposer={hideComposer}
                activity={huntState.activity}
                onHistory={() => navigate('/den', { state: { from: huntId ? `/hunts/${huntId}` : '/' } })}
                placeholder={
                  ['completed', 'failed', 'stopped'].includes(huntState.status)
                    ? 'Ask Alpha anything about this plan…'
                    : undefined
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key="intake-chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={MORPH}
              className={`absolute top-0 bottom-0 right-0 ${sidebarOpen ? 'left-[300px]' : 'left-0'} flex flex-col items-center justify-center px-4 pb-10 min-h-0`}
            >
              <div className="w-full max-w-[700px] flex flex-col gap-6">
                <h1 className="text-[30px] font-semibold text-white text-center leading-tight">
                  What should the pack hunt down?
                </h1>

                <ChatColumn variant="intake" {...door} />

                <div className="grid grid-cols-3 gap-3">
                  {PRESETS.map((p) => (
                    <PresetCard key={p.id} preset={p} onClick={() => door.setInput(p.prompt)} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Edit Formations — full-canvas editor overlay, over the roster + chat. */}
        {editing && canEdit && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
            <Suspense fallback={null}>
              <FormationEditor
                plan={huntState.plan}
                onSave={(edits) => { applyLocalEdits(edits); setEditing(false) }}
                onCancel={() => setEditing(false)}
              />
            </Suspense>
          </div>
        )}
      </div>

        {/* Scroll-to-explore cue — intake hero only. */}
        {!isTerritory && (
          <motion.button
            onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
            initial={{ opacity: 0 }}
            // Stop the infinite bob once it's invisible — framer keeps a rAF alive for it otherwise.
            animate={{ opacity: pastHero ? 0 : 1, y: pastHero ? 0 : [0, 6, 0] }}
            transition={{ opacity: { duration: 0.4 }, y: pastHero ? { duration: 0.2 } : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } }}
            style={{ pointerEvents: pastHero ? 'none' : 'auto' }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-1 text-text-faint transition-colors hover:text-text-dim"
            aria-label="Scroll to explore"
          >
            <span className="text-[11px] font-medium uppercase tracking-[0.2em]">Scroll to explore</span>
            <ChevronDown size={18} />
          </motion.button>
        )}
      </div>
      {/* /hero */}

      {!isTerritory && <DoorLanding door={door} />}

      {huntId && (
        <Suspense fallback={null}>
          <RewardModal huntId={huntId} open={reward.open} onClose={reward.close} />
        </Suspense>
      )}
      {isDragging && <FileDropOverlay />}
    </div>
  )
}
