import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { ToastProvider, ToastViewport } from '@/ui/toast'
import { Toaster } from '@/ui/toaster'
import { ErrorBoundary } from '@/ui/error-boundary'
import { router } from './app'
import './index.css'
import '@xyflow/react/dist/style.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <ToastProvider swipeDirection="right">
          <RouterProvider router={router} />
          <Toaster />
          <ToastViewport />
        </ToastProvider>
      </QueryClientProvider>
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
