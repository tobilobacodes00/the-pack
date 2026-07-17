import { useState } from 'react'
import { Share2 } from 'lucide-react'
import {
  useHuntBrief,
  useHuntSnapshot,
  useHuntArtifacts,
  useDownloadArtifact,
  useReceipts,
  useRefine,
  useRunBenchmark,
  useShare,
  useHuntScorecard,
  useTracks,
  type ArtifactMeta,
  type Scorecard,
} from '@/api/hunts'
import { useCreateInstinct } from '@/api/instincts'
import { useProjects } from '@/api/projects'
import { useHuntStore } from '@/store/hunt-store'
import { toast } from '@/store/toast-store'
import { RewardShell } from './reward-shell'
import { RewardHeader } from './reward-header'
import { ReadingView } from './reading-view'
import { RewardEmpty } from './reward-empty'
import { MoreMenu } from './more-menu'
import { DownloadMenu } from './download-menu'
import { RefineInput } from './refine-input'
import { TracksDrawer } from './tracks-drawer'
import { ScorecardPanel } from './scorecard-panel'
import { ReceiptsPanel } from './receipts-panel'
import { IconButton } from './icon-button'
import { parseBrief } from './lib/brief-view'
import { buildInstinctPayload } from './lib/instinct-spec'
import {
  FirstInstinctPrompt,
  hasSeenFirstInstinctPrompt,
  markFirstInstinctPromptSeen,
} from './first-instinct-prompt'

interface Props {
  huntId: string
  open: boolean
  onClose: () => void
}

export function RewardModal({ huntId, open, onClose }: Props) {
  const [panel, setPanel] = useState<'reading' | 'scorecard' | 'receipts'>('reading')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)
  // The first-completion Instinct nudge: shown once ever (localStorage-gated), the moment the very
  // first brief is in hand. "Save as Instinct" is otherwise buried in the ⋮ menu and rarely found.
  const [showFirstInstinct, setShowFirstInstinct] = useState(() => !hasSeenFirstInstinctPrompt())

  const plan = useHuntStore((s) => s.state.plan)
  const totals = useHuntStore((s) => s.state.totals)
  const liveScorecard = useHuntStore((s) => s.state.scorecard)

  const brief = useHuntBrief(huntId, open)
  const snap = useHuntSnapshot(huntId, open)
  const artifacts = useHuntArtifacts(huntId, open)
  // After the user launches a benchmark, poll for the scorecard until it lands — the live stream
  // normally delivers benchmark_completed first (liveScorecard below); polling is the safety net
  // for a reopened page whose socket isn't tailing this hunt.
  const runBenchmark = useRunBenchmark(huntId)
  const scorecardQuery = useHuntScorecard(
    huntId,
    open && panel === 'scorecard',
    runBenchmark.isSuccess,
  )
  const receiptsQuery = useReceipts(huntId, open && panel === 'receipts')
  const tracks = useTracks(huntId, open && drawerOpen)

  const download = useDownloadArtifact(huntId)
  const refine = useRefine(huntId)
  const share = useShare(huntId)
  const createInstinct = useCreateInstinct()

  const projects = useProjects(open && !!snap.data?.project_id)
  const prompt = snap.data?.task ?? ''
  const dateISO = snap.data?.updated_at ?? snap.data?.created_at ?? null
  const projectName =
    projects.data?.find((p) => p.project_id === snap.data?.project_id)?.label ?? null
  const scorecard: Scorecard | null =
    scorecardQuery.data ?? (liveScorecard as Scorecard | null) ?? null

  const close = () => {
    setPanel('reading')
    setDrawerOpen(false)
    setRefineOpen(false)
    // Clear the benchmark mutation so reopening the Scorecard for this hunt doesn't resurrect a
    // stale success/failure state (isSuccess/isError otherwise stick for the mounted lifetime).
    runBenchmark.reset()
    onClose()
  }

  const doDownload = (art: ArtifactMeta) => {
    download.mutate(art, {
      onError: (e) => toast({ variant: 'danger', title: 'Download failed', description: String(e) }),
    })
  }

  const handleExport = () => {
    const list = artifacts.data ?? []
    const pick = list.find((a) => a.kind === 'pdf') ?? list[0]
    if (pick) doDownload(pick)
    else toast({ variant: 'warn', title: 'No files to export yet' })
  }

  const briefTitle = brief.data ? parseBrief(brief.data, prompt).title : prompt

  const handleSaveInstinct = (name?: string) => {
    const payload = buildInstinctPayload(name || briefTitle, prompt, plan)
    createInstinct.mutate(payload, {
      onSuccess: () => toast({ variant: 'success', title: 'Saved as Instinct' }),
      onError: (e) => toast({ variant: 'danger', title: 'Could not save', description: String(e) }),
    })
  }

  const dismissFirstInstinct = () => {
    markFirstInstinctPromptSeen()
    setShowFirstInstinct(false)
  }
  const saveFromFirstPrompt = (name: string) => {
    handleSaveInstinct(name)
    dismissFirstInstinct() // saving also retires the one-time nudge
  }

  const handleShare = () => {
    share.mutate(undefined, {
      onSuccess: (token) => {
        const url = `${window.location.origin}/share/${token}`
        void navigator.clipboard?.writeText(url)
        toast({ variant: 'success', title: 'Share link copied', description: url })
      },
      onError: (e) => toast({ variant: 'danger', title: 'Could not create link', description: String(e) }),
    })
  }

  const handleRefine = (instruction: string) => {
    refine.mutate(instruction, {
      onSuccess: () => {
        setRefineOpen(false)
        toast({ variant: 'success', title: 'Brief refined' })
      },
      onError: (e) => toast({ variant: 'danger', title: 'Refine failed', description: String(e) }),
    })
  }

  const actions = (
    <>
      <DownloadMenu artifacts={artifacts.data} onDownload={doDownload} />
      <IconButton label="Share" onClick={handleShare} disabled={share.isPending}>
        <Share2 size={16} />
      </IconButton>
      <MoreMenu
        onSaveInstinct={handleSaveInstinct}
        onScorecard={() => setPanel('scorecard')}
        onReceipts={() => setPanel('receipts')}
        onTracks={() => setDrawerOpen(true)}
        onRefine={() => setRefineOpen(true)}
      />
    </>
  )

  return (
    <RewardShell
      open={open}
      onClose={close}
      header={<RewardHeader prompt={prompt} actions={actions} onClose={close} />}
      drawer={
        <TracksDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          events={tracks.data}
          loading={tracks.isLoading}
          totals={totals}
          huntId={huntId}
        />
      }
      overlay={
        refineOpen && (
          <RefineInput
            pending={refine.isPending}
            onSubmit={handleRefine}
            onCancel={() => setRefineOpen(false)}
          />
        )
      }
    >
      {panel === 'scorecard' ? (
        <ScorecardPanel
          scorecard={scorecard}
          loading={scorecardQuery.isLoading && !scorecard}
          // running: from the moment the POST is accepted until the scorecard lands (stream or poll)
          // — but stop once the poll budget is spent, so a benchmark that died in the background
          // surfaces as "failed" instead of spinning forever.
          running={
            (runBenchmark.isPending ||
              (runBenchmark.isSuccess && !scorecard && !scorecardQuery.pollExhausted)) &&
            !scorecard
          }
          failed={runBenchmark.isError || (!scorecard && scorecardQuery.pollExhausted)}
          onRun={() => runBenchmark.mutate()}
          onCancel={() => setPanel('reading')}
          onExport={handleExport}
        />
      ) : panel === 'receipts' ? (
        <ReceiptsPanel
          receipts={receiptsQuery.data}
          loading={receiptsQuery.isLoading}
          onCancel={() => setPanel('reading')}
        />
      ) : brief.isLoading ? (
        <RewardEmpty kind="loading" />
      ) : brief.isError || !brief.data?.content ? (
        <RewardEmpty kind="missing" />
      ) : (
        <>
          {showFirstInstinct && (
            <FirstInstinctPrompt
              defaultName={briefTitle}
              saving={createInstinct.isPending}
              onSave={saveFromFirstPrompt}
              onDismiss={dismissFirstInstinct}
            />
          )}
          <ReadingView brief={brief.data} dateISO={dateISO} projectName={projectName} />
        </>
      )}
    </RewardShell>
  )
}
