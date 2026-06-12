import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { Layout } from './components/Layout'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'
import { PlannerPage } from './pages/PlannerPage'
import { TasksPage } from './pages/TasksPage'
import { FocusPage } from './pages/FocusPage'
import { WellbeingPage } from './pages/WellbeingPage'
import { NotesPage } from './pages/NotesPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { ArenaPage } from './pages/ArenaPage'
import { CoachPage } from './pages/CoachPage'
import { ReportPage } from './pages/ReportPage'
import { SettingsPage } from './pages/SettingsPage'
import { AdminPage } from './pages/AdminPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function Gate() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="aurora flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-6xl">🦁</div>
      </div>
    )
  }
  if (!user) return <AuthPage />
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="wellbeing" element={<WellbeingPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="arena" element={<ArenaPage />} />
        <Route path="coach" element={<CoachPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
