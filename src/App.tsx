import { lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { MascotImg } from './components/ui'
import { OnlineProvider } from './hooks/useOnline'
import { StoriesProvider } from './components/Stories'
import { Layout } from './components/Layout'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'

// Pages load on demand (code splitting): the app starts with only the shell,
// the dashboard and the login page instead of all 27 pages at once, which is
// what made startup on phones slow. Popular pages are prefetched when idle.
const PlannerPage = lazy(() => import('./pages/PlannerPage').then((m) => ({ default: m.PlannerPage })))
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })))
const FocusPage = lazy(() => import('./pages/FocusPage').then((m) => ({ default: m.FocusPage })))
const WellbeingPage = lazy(() => import('./pages/WellbeingPage').then((m) => ({ default: m.WellbeingPage })))
const CapsulePage = lazy(() => import('./pages/CapsulePage').then((m) => ({ default: m.CapsulePage })))
const LearnPage = lazy(() => import('./pages/LearnPage').then((m) => ({ default: m.LearnPage })))
const QuizPage = lazy(() => import('./pages/QuizPage').then((m) => ({ default: m.QuizPage })))
const LensPage = lazy(() => import('./pages/LensPage').then((m) => ({ default: m.LensPage })))
const InsightsPage = lazy(() => import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })))
const VocabPage = lazy(() => import('./pages/VocabPage').then((m) => ({ default: m.VocabPage })))
const DietPage = lazy(() => import('./pages/DietPage').then((m) => ({ default: m.DietPage })))
const CareerPage = lazy(() => import('./pages/CareerPage').then((m) => ({ default: m.CareerPage })))
const StartupPage = lazy(() => import('./pages/StartupPage').then((m) => ({ default: m.StartupPage })))
const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })))
const ArenaPage = lazy(() => import('./pages/ArenaPage').then((m) => ({ default: m.ArenaPage })))
const CityPage = lazy(() => import('./pages/CityPage').then((m) => ({ default: m.CityPage })))
const CoachPage = lazy(() => import('./pages/CoachPage').then((m) => ({ default: m.CoachPage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((m) => ({ default: m.ReportPage })))
const ChatPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.ChatPage })))
const FeedPage = lazy(() => import('./pages/FeedPage').then((m) => ({ default: m.FeedPage })))
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((m) => ({ default: m.FriendsPage })))
const InstallPage = lazy(() => import('./pages/InstallPage').then((m) => ({ default: m.InstallPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function Gate() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="aurora flex min-h-screen items-center justify-center">
        <MascotImg alt="FocusLion" className="w-44 animate-pulse drop-shadow-[0_8px_24px_rgba(255,170,60,0.4)]" />
      </div>
    )
  }
  if (!user) return <AuthPage />
  return (
    <StoriesProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="planner" element={<PlannerPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="focus" element={<FocusPage />} />
        <Route path="wellbeing" element={<WellbeingPage />} />
        <Route path="capsule" element={<CapsulePage />} />
        <Route path="learn" element={<LearnPage />} />
        <Route path="quiz" element={<QuizPage />} />
        <Route path="lens" element={<LensPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="vocab" element={<VocabPage />} />
        <Route path="diet" element={<DietPage />} />
        <Route path="career" element={<CareerPage />} />
        <Route path="startup" element={<StartupPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="arena" element={<ArenaPage />} />
        <Route path="city" element={<CityPage />} />
        <Route path="coach" element={<CoachPage />} />
        <Route path="report" element={<ReportPage />} />
        <Route path="feed" element={<FeedPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="community" element={<ChatPage />} />
        <Route path="friends" element={<FriendsPage />} />
        <Route path="install" element={<InstallPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </StoriesProvider>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <OnlineProvider>
            <Gate />
          </OnlineProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
