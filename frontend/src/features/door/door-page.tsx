import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { toast } from '@/store/toast-store'
import type { AskAction } from '@/hooks/use-ask-stream'
import { useDoorLogic, type ReusedInstinct } from '../intake/use-intake'
import { PresetCard, PRESETS } from '../intake/preset-card'
import { FileDropOverlay } from '../intake/file-drop-overlay'
import { LeftPanel } from '../territory/left-panel'
import { TerritoryFooter, composerVisible, composerPlaceholder } from '../territory/territory-footer'
import { useReward } from '../reward/use-reward'
import { useHuntToast } from '../territory/use-hunt-toast'
import { ChatColumn } from './chat-column'
import { HeroTypewriter } from './hero-typewriter'
import { HiddenFileInput } from './hidden-file-input'
import { HuntSidebar } from './hunt-sidebar'
import { DoorLanding } from './door-landing'
import { useHuntStore } from '@/store/hunt-store'
import { useHuntStream } from '@/hooks/use-hunt-stream'
import { useApprovePlan } from '@/api/hunts'
import { rememberHunt } from '@/lib/local-history'
import { color, warm } from '@/lib/theme'

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
  const qc = useQueryClient()
  // Reacts to chat-driven brief iteration / follow-up hunts (see RightPanel for the territory-view twin).
  const onAskAction = useCallback(
    (action: AskAction, newHuntId: string | null) => {
      if (action === 'refined') {
        void qc.invalidateQueries({ queryKey: ['hunts'], predicate: (q) => q.queryKey.includes('artifact') || q.queryKey.includes('artifacts') })
        toast({ title: 'Brief updated', description: 'Alpha re-worked the brief.', variant: 'default' })
      } else if ((action === 'subhunt' || action === 'new_hunt') && newHuntId) {
        // A follow-up lands in plan_ready waiting for approval — without navigating there it starves
        // at the gate and gets reaped as failed on the next engine restart.
        // Claim it for this browser (created outside useCreateHunt) so it stays in local history.
        rememberHunt(newHuntId)
        void qc.invalidateQueries({ queryKey: ['hunts'] })
        toast({
          title: action === 'subhunt' ? 'Digging deeper' : 'New hunt launched',
          description:
            action === 'subhunt'
              ? 'Taking you to it. Approve the plan and the pack folds it into your brief.'
              : 'Taking you to the new hunt.',
          variant: 'default',
        })
        window.location.assign(`/hunts/${newHuntId}`)
      } else if (action === 'retry' && newHuntId) {
        // Alpha re-ran the job as a fresh hunt — send the Packmaster to it so they watch it run.
        rememberHunt(newHuntId)
        void qc.invalidateQueries({ queryKey: ['hunts'] })
        toast({ title: 'Running it again', description: 'Taking you to the new run.', variant: 'default' })
        window.location.assign(`/hunts/${newHuntId}`)
      }
    },
    [qc],
  )
  // A reused Instinct arrives via router state; its formation rides as seed_team but the task is
  // gathered fresh. Held as state (not a mount-only memo) so a same-path nav while the Door is
  // already mounted — the sidebar's own "Use This" — still activates it (React Router won't remount).
  const location = useLocation()
  const [reusedInstinct, setReusedInstinct] = useState<ReusedInstinct | null>(
    () => (location.state as { instinct?: ReusedInstinct } | null)?.instinct ?? null,
  )
  const door = useDoorLogic({ onAskAction, instinct: reusedInstinct })
  const { phase, huntId, isDragging, onDragEnter, onDragOver, onDragLeave, onDrop } = door

  const huntState = useHuntStore((s) => s.state)
  const resetHunt = useHuntStore((s) => s.reset)
  const applyLocalEdits = useHuntStore((s) => s.applyLocalEdits)
  const seedPreviewPlan = useHuntStore((s) => s.seedPreviewPlan)
  const [editing, setEditing] = useState(false)
  // Sidebar starts collapsed so the intake chat renders centered and full-width.
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

  // Touch devices skip the full-screen fluid sim entirely (their scroll stays butter).
  const finePointer = useMemo(() => window.matchMedia('(pointer: fine)').matches, [])

  // Warm the territory chunks once the landing settles, so the intake→territory morph never
  // waits on the network.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void import('../territory/graph-canvas')
      void import('../reward/reward-modal')
    }, 3500)
    return () => window.clearTimeout(t)
  }, [])

  // Store is a global singleton that survives SPA nav — clear leftover hunt state so the canvas
  // doesn't flash a previous hunt's formation.
  useEffect(() => {
    resetHunt()
  }, [resetHunt])

  // Keyed on location.key so it fires on every navigation to the door, incl. the sidebar's own
  // "Use This" while already mounted (same-path nav → no remount).
  useEffect(() => {
    const st = location.state as { seed?: string; instinct?: ReusedInstinct } | null
    if (st?.seed) door.setInput(st.seed)
    if (st?.instinct) {
      setReusedInstinct(st.instinct)
      resetHunt()
      door.greetForInstinct(st.instinct, location.key)
      seedPreviewPlan(st.instinct.team) // show the reused formation on the canvas straight away
    }
    // location.key changes per navigation; door/seedPreviewPlan/resetHunt are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  const { mutate: approvePlan, isPending: approving } = useApprovePlan(huntId ?? '')
  const reward = useReward(huntId)
  useHuntToast(huntState.status)

  const isTerritory = phase === 'territory'
  const canEdit = huntState.status === 'plan_ready' && huntState.plan !== null

  // Raw History API (not React Router nav) so the morph keeps animating without a remount.
  // `!huntId` is load-bearing: once use-intake writes /hunts/<id>, huntId (not pathname) gates this.
  useEffect(() => {
    if (isTerritory && !huntId && location.pathname === '/') {
      window.history.replaceState(null, '', '/new')
    }
  }, [isTerritory, huntId, location.pathname])

  const planFooter = (
    <TerritoryFooter
      huntId={huntId}
      huntState={huntState}
      onApprove={approvePlan}
      approving={approving}
      onEditFormation={() => setEditing(true)}
      onOpenReward={reward.openReward}
      // Fires the same "retry" the chat understands, routing to the backend retry intent.
      onRetry={() => void door.send('retry')}
      retrying={door.isPending}
    />
  )
  const hideComposer = !composerVisible(huntState.status)

  return (
    <div
      className={isTerritory ? 'h-dvh flex flex-col overflow-hidden' : 'min-h-dvh flex flex-col'}
      style={{ backgroundColor: isTerritory ? color.canvas : warm.cream }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* The wolf lives entirely in DoorLanding's PackReveal — one continuous fixed element
          across the whole scroll. */}
      {/* Fluid smoke rides the cursor across the landing. Desktop-only, lazy. */}
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
          COLOR="#9a9a9a"
        />
        </Suspense>
      )}

      {/* HERO — always exactly one viewport. `z-20` lifts it above DoorLanding's z-10 layer so the
          fixed wolf sits behind it, showing through the gaps but never over the composer. */}
      <div className={isTerritory ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : 'relative z-20 h-dvh flex flex-col'}>
      {/* Top nav — intake only. `pl-16` clears the fixed hamburger at top-left. */}
      <AnimatePresence>
        {!isTerritory && !sidebarOpen && (
          <motion.nav
            key="nav"
            exit={{ opacity: 0, height: 0 }}
            transition={MORPH}
            className="h-[52px] flex items-stretch shrink-0 overflow-hidden"
          >
            <div className="flex items-center gap-3 pl-16 pr-5">
              <img src="/pack-logo.svg" className="w-[22px] h-[26px]" alt="Pack" />
              <span className="font-display text-base font-extrabold tracking-wide text-ink-900">A Pack</span>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      <div className="flex-1 relative overflow-hidden min-h-0">
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

        {/* Left roster — floating overlay; sizes itself, so the wrapper just fades in. */}
        <AnimatePresence>
          {isTerritory && (
            <motion.div
              key="roster"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={MORPH}
              className="absolute left-2 top-2 sm:left-3 sm:top-3 bottom-2 sm:bottom-3 z-20 overflow-visible flex"
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
              // Mobile: bottom sheet, capped height. Desktop: right-side column.
              className="absolute inset-x-2 bottom-2 top-auto h-[62dvh] sm:inset-x-auto sm:right-3 sm:top-3 sm:bottom-3 sm:h-auto sm:w-[320px] z-20 flex flex-col min-h-0 overflow-hidden"
              style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: 16 }}
            >
              <ChatColumn
                variant="territory"
                {...door}
                footer={planFooter}
                hideComposer={hideComposer}
                placeholder={composerPlaceholder(huntState.status)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="intake-chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={MORPH}
              // `my-auto` (not `justify-center`) so when content overflows the viewport the top
              // stays reachable and the column scrolls, instead of clipping off-screen.
              className="absolute inset-0 flex flex-col items-center overflow-y-auto px-4 py-8 min-h-0"
            >
              <div className="w-full max-w-[700px] my-auto flex flex-col gap-6">
                {/* Reserve the line so the composer never jumps as the rotating clause changes length. */}
                <div className="min-h-[52px] flex items-center justify-center">
                  <HeroTypewriter />
                </div>

                <ChatColumn variant="intake" {...door} />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            // Stop the infinite bob once invisible — framer keeps a rAF alive for it otherwise.
            animate={{ opacity: pastHero ? 0 : 1, y: pastHero ? 0 : [0, 6, 0] }}
            transition={{ opacity: { duration: 0.4 }, y: pastHero ? { duration: 0.2 } : { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } }}
            style={{ pointerEvents: pastHero ? 'none' : 'auto' }}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-1 text-ink-500 transition-colors hover:text-ink-700"
            aria-label="Scroll to explore"
          >
            <span className="text-[11px] font-medium uppercase tracking-[0.2em]">Scroll to explore</span>
            <ChevronDown size={18} />
          </motion.button>
        )}
      </div>
      {/* /hero */}

      {/* Past-Hunts sidebar — intake only. Fixed to the viewport, mounted at the DoorPage root
          (free of the hero's overflow-hidden / framer-transform ancestors that would trap it). */}
      {!isTerritory && (
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                key="sidebar-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={MORPH}
                onClick={() => setSidebarOpen(false)}
                className="fixed inset-0 z-[70] bg-black/40"
              />
              <motion.div
                key="sidebar"
                initial={{ x: -300, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -300, opacity: 0 }}
                transition={MORPH}
                className="fixed left-0 top-0 bottom-0 z-[71]"
              >
                <HuntSidebar onCollapse={() => setSidebarOpen(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      {/* Persistent hamburger — fixed top-left so Past Hunts stays reachable after the hero scrolls away. */}
      {!isTerritory && !sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="fixed left-4 top-4 z-[69] flex h-10 w-10 items-center justify-center rounded-full border transition-shadow hover:shadow-chunk-sm"
          style={{ background: color.surface, borderColor: color.border }}
          aria-label="Open past hunts"
        >
          <img src="/icon-menu.svg" className="w-5 h-5" alt="" style={{ filter: 'brightness(0) saturate(100%) opacity(0.75)' }} />
        </button>
      )}

      {!isTerritory && <DoorLanding setInput={door.setInput} />}

      {huntId && (
        <Suspense fallback={null}>
          <RewardModal huntId={huntId} open={reward.open} onClose={reward.close} />
        </Suspense>
      )}
      {/* Lives in the stable DoorPage subtree — ChatColumn remounts at the morph, which would
          detach the ref and break the composer's `+`. */}
      <HiddenFileInput inputRef={door.fileInputRef} onFiles={door.addFiles} />
      {isDragging && <FileDropOverlay />}
    </div>
  )
}
