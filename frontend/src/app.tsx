import { createBrowserRouter, useParams } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { ErrorBoundary } from '@/ui/error-boundary'
import { HuntStoreProvider } from '@/store/hunt-store-provider'

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  )
}

// Every route gets its own boundary + suspense, so a crash in one feature can't take down the shell.
function wrap(Component: React.ComponentType) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  )
}

// The two hunt-owning screens each mount their own hunt store: the door under a stable 'intake' key,
// territory keyed by hunt id (so each hunt is isolated and returning restores its exact state).
function DoorScoped() {
  return (
    <HuntStoreProvider storeKey="intake">
      <DoorPage />
    </HuntStoreProvider>
  )
}
function TerritoryScoped() {
  const { huntId } = useParams<{ huntId: string }>()
  return (
    <HuntStoreProvider storeKey={huntId ?? 'unknown'}>
      <TerritoryPage />
    </HuntStoreProvider>
  )
}

const DoorPage       = lazy(() => import('@/features/door/door-page'))
const TerritoryPage  = lazy(() => import('@/features/territory/territory-page'))
const DenPage        = lazy(() => import('@/features/den/den-page'))
const ArtifactsPage  = lazy(() => import('@/features/artifacts/artifacts-page'))
const TracksPage     = lazy(() => import('@/features/tracks/tracks-page'))
const ScorecardPage  = lazy(() => import('@/features/scorecard/scorecard-page'))
const LibraryPage    = lazy(() => import('@/features/library/library-page'))
const InstinctsPage  = lazy(() => import('@/features/instincts/instincts-page'))
const MemoryPage     = lazy(() => import('@/features/memory/memory-page'))
const SpendPage      = lazy(() => import('@/features/spend/spend-page'))
const SharePage      = lazy(() => import('@/features/share/share-page'))
const ShareReplayPage = lazy(() => import('@/features/share/share-replay-page'))
const SettingsPage   = lazy(() => import('@/features/settings/settings-page'))

export const router = createBrowserRouter([
  { path: '/',                          element: wrap(DoorScoped) },
  // Cosmetic target for the door→territory morph before a real hunt exists (see door-page.tsx). A
  // refresh here renders the same fresh intake door as '/'.
  { path: '/new',                       element: wrap(DoorScoped) },
  { path: '/hunts/:huntId',             element: wrap(TerritoryScoped) },
  { path: '/den',                       element: wrap(DenPage) },
  { path: '/hunts/:huntId/den',         element: wrap(DenPage) },
  { path: '/hunts/:huntId/artifacts',   element: wrap(ArtifactsPage) },
  { path: '/hunts/:huntId/tracks',      element: wrap(TracksPage) },
  { path: '/hunts/:huntId/scorecard',   element: wrap(ScorecardPage) },
  { path: '/library',                   element: wrap(LibraryPage) },
  { path: '/instincts',                 element: wrap(InstinctsPage) },
  { path: '/memory',                    element: wrap(MemoryPage) },
  { path: '/spend',                     element: wrap(SpendPage) },
  { path: '/share/:token',              element: wrap(SharePage) },
  { path: '/share/:token/replay',       element: wrap(ShareReplayPage) },
  { path: '/settings',                  element: wrap(SettingsPage) },
])
