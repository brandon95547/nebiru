import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Spinner } from './components/ui/Overlay'
import { NewBookPage } from './features/create/NewBookPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { PlanPage } from './features/plan/PlanPage'
import { useServiceStatus } from './services'
import { useLibrary } from './store/library'

// The editor carries the rich-text engine, so it loads only when a book is opened.
const EditorPage = lazy(() => import('./features/editor/EditorPage').then((module) => ({ default: module.EditorPage })))

function Loading() {
  return (
    <div className="grid h-full place-items-center text-ink-soft">
      <Spinner className="size-6" />
    </div>
  )
}

export default function App() {
  const loaded = useLibrary((state) => state.ready)
  const settled = useServiceStatus((state) => state.settled)
  if (!loaded || !settled) return <Loading />

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/new" element={<NewBookPage />} />
        <Route path="/book/:bookId/plan" element={<PlanPage />} />
        <Route path="/book/:bookId" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
