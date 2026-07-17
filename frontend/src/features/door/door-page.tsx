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
  // React to chat-driven brief iteration / follow-up hunts once this door is a live hunt (see
  // RightPanel for the same handler on the standalone territory view).
  const onAskAction = useCallback(
    (action: AskAction, newHuntId: string | null) => {
      if (action === 'refined') {
        // Refresh any cached brief/format artifacts so the reward shows the re-worked version.
        void qc.invalidateQueries({ queryKey: ['hunts'], predicate: (q) => q.queryKey.includes('artifact') || q.queryKey.includes('artifacts') })
        toast({ title: 'Brief updated', description: 'Alpha re-worked the brief.', variant: 'default' })
      } else if ((action === 'subhunt' || action === 'new_hunt') && newHuntId) {
        // A follow-up is a NEW hunt (its own hunt_id) that lands in plan_ready and waits for approval.
        // Take the Packmaster there — same as retry below — so they see it, approve the plan, and watch
        // it run. Without this the new hunt starves at the approval gate and gets reaped as failed on the
        // next engine restart, with the user never told it existed.
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
        void qc.invalidateQueries({ queryKey: ['hunts'] })
        toast({ title: 'Running it again', description: 'Taking you to the new run.', variant: 'default' })
        window.location.assign(`/hunts/${newHuntId}`)
      }
    },
    [qc],
  )
  // A reused Instinct arrives via router state (from the Instincts library OR the Past-Hunts sidebar):
  // its proven formation rides along as the hunt's seed_team, but the TASK is gathered fresh here —
  // Alpha greets naming the pack and asks what to point it at, then the normal intake flow runs. Held
  // as state (not a mount-only memo) so a navigation to '/' that arrives while the Door is ALREADY
  // mounted — the sidebar's own "Use This" — still activates it (React Router won't remount same-path).
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

  // React to arrivals from an Instinct's "Use This" — a built-in (text-only composer prefill) or a saved
  // instinct (formation reuse). Keyed on location.key so it fires on EVERY navigation to the door, incl.
  // the sidebar's own "Use This" while the door is already mounted (same-path nav → no remount). For a
  // saved instinct: reset to a clean session, greet as Alpha, and show the formation on the canvas; the
  // formation rides along in useDoorLogic (→ seed_team on the created hunt).
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

  // The door morphs to territory on the first message, before any hunt exists. Reflect that in the
  // URL so it doesn't look like nothing changed. Raw History API (not React Router nav) → no remount
  // → the morph keeps animating. `!huntId` is load-bearing: once a real hunt is created, use-intake
  // writes /hunts/<id> and sets huntId, so this never overwrites it (a bare replaceState doesn't
  // update location.pathname, so huntId — not pathname — is the authoritative gate).
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
          COLOR="#9a9a9a"
        />
        </Suspense>
      )}

      {/* HERO — always exactly one viewport; the landing (intake only) scrolls in below it. On the
          cream door it inherits the page's warm bg. `z-20` lifts the whole hero (nav + chat +
          composer + presets + cue) above DoorLanding's z-10 layer so the fixed wolf sits BEHIND it
          — the transparent hero lets the faint wolf show in the gaps but never over the composer. */}
      <div className={isTerritory ? 'flex-1 flex flex-col min-h-0 overflow-hidden' : 'relative z-20 h-dvh flex flex-col'}>
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
            <div className="flex items-center gap-3 px-5">
              <img src="/pack-logo.svg" className="w-[22px] h-[26px]" alt="Pack" />
              <span className="font-display text-base font-extrabold tracking-wide text-ink-900">A Pack</span>
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1 opacity-70 hover:opacity-100 transition-opacity"
                aria-label="Open past hunts"
              >
                <img src="/icon-menu.svg" className="w-5 h-5" alt="" style={{ filter: 'brightness(0) saturate(100%) opacity(0.75)' }} />
              </button>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>

      <div className="flex-1 relative overflow-hidden min-h-0">
        {/* Past-Hunts sidebar — intake only, slides in from the left when the hamburger is tapped.
            On mobile a tap-to-close scrim sits behind it (the sidebar is a full overlay there). */}
        <AnimatePresence>
          {!isTerritory && sidebarOpen && (
            <>
              <motion.div
                key="sidebar-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={MORPH}
                onClick={() => setSidebarOpen(false)}
                className="absolute inset-0 z-20 bg-black/40 sm:hidden"
              />
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
            </>
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

        {/* Left roster — floating overlay on top of the canvas. It sizes itself (52px collapsed corner
            square on mobile, 300px rail on desktop), so the wrapper just fades in and hugs content. */}
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
              // Mobile: a bottom sheet spanning the width, capped height. Desktop: the right-side column.
              className="absolute inset-x-2 bottom-2 top-auto h-[62dvh] sm:inset-x-auto sm:right-3 sm:top-3 sm:bottom-3 sm:h-auto sm:w-[320px] z-20 flex flex-col min-h-0 overflow-hidden"
              style={{ background: color.surface, border: `1px solid ${color.border}`, borderRadius: 16 }}
            >
              <ChatColumn
                variant="territory"
                {...door}
                footer={planFooter}
                hideComposer={hideComposer}
                activity={huntState.activity}
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
              // On mobile the sidebar is a full overlay (with a scrim), so the chat never shifts right;
              // on desktop it slides the content over by the sidebar width.
              className={`absolute top-0 bottom-0 right-0 left-0 ${sidebarOpen ? 'sm:left-[300px]' : 'sm:left-0'} flex flex-col items-center justify-center overflow-y-auto px-4 py-8 min-h-0`}
            >
              <div className="w-full max-w-[700px] flex flex-col gap-6">
                {/* Reserve the line so the composer never jumps as the rotating clause changes length.
                    The question fits one line on desktop; a touch more room on mobile for a wrap. */}
                <div className="min-h-[80px] flex items-center justify-center md:min-h-[52px]">
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
            // Stop the infinite bob once it's invisible — framer keeps a rAF alive for it otherwise.
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

      {!isTerritory && <DoorLanding setInput={door.setInput} />}

      {huntId && (
        <Suspense fallback={null}>
          <RewardModal huntId={huntId} open={reward.open} onClose={reward.close} />
        </Suspense>
      )}
      {/* The composer's `+` file input lives here — in the stable DoorPage subtree, not inside
          ChatColumn (which remounts at the morph and would detach the ref, breaking the `+`). */}
      <HiddenFileInput inputRef={door.fileInputRef} onFiles={door.addFiles} />
      {isDragging && <FileDropOverlay />}
    </div>
  )
}
