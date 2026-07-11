import { useState } from 'react'
import { Share2 } from 'lucide-react'
import {
  useHuntBrief,
  useHuntSnapshot,
  useHuntArtifacts,
  useDownloadArtifact,
  useRefine,
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
import { IconButton } from './icon-button'
import { parseBrief } from './lib/brief-view'
import { buildInstinctPayload } from './lib/instinct-spec'

interface Props {
  huntId: string
  open: boolean
  onClose: () => void
}

export function RewardModal({ huntId, open, onClose }: Props) {
  const [panel, setPanel] = useState<'reading' | 'scorecard'>('reading')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [refineOpen, setRefineOpen] = useState(false)

  const plan = useHuntStore((s) => s.state.plan)
  const totals = useHuntStore((s) => s.state.totals)
  const liveScorecard = useHuntStore((s) => s.state.scorecard)

  const brief = useHuntBrief(huntId, open)
  const snap = useHuntSnapshot(huntId, open)
  const artifacts = useHuntArtifacts(huntId, open)
  const scorecardQuery = useHuntScorecard(huntId, open && panel === 'scorecard')
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

  const handleSaveInstinct = () => {
    const title = brief.data ? parseBrief(brief.data, prompt).title : prompt
    const payload = buildInstinctPayload(title, prompt, plan)
    createInstinct.mutate(payload, {
      onSuccess: () => toast({ variant: 'success', title: 'Saved as Instinct' }),
      onError: (e) => toast({ variant: 'danger', title: 'Could not save', description: String(e) }),
    })
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
          onCancel={() => setPanel('reading')}
          onExport={handleExport}
        />
      ) : brief.isLoading ? (
        <RewardEmpty kind="loading" />
      ) : brief.isError || !brief.data?.content ? (
        <RewardEmpty kind="missing" />
      ) : (
        <ReadingView brief={brief.data} dateISO={dateISO} projectName={projectName} />
      )}
    </RewardShell>
  )
}
