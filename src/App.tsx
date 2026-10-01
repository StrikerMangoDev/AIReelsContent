import { Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/app/DashboardPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { lazy, Suspense } from 'react'
const AuthPage = lazy(() => import('@/pages/auth/AuthPage').then(module => ({ default: module.AuthPage })))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage').then(module => ({ default: module.AdminPage })))
const StudioPage = lazy(() => import('@/pages/app/StudioPage').then(module => ({ default: module.StudioPage })))
const ArticlePage = lazy(() => import('@/pages/app/StudioPage').then(module => ({ default: module.ArticlePage })))
const PublicationPage = lazy(() => import('@/pages/app/PublicationPage').then(module => ({ default: module.PublicationPage })))
import { AnalyticsConsent } from '@/components/common/AnalyticsConsent'

export default function App() {
  return (
    <Suspense fallback={<div className="feed-empty" role="status">Loading…</div>}><Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/studio/:packageId" element={<StudioPage />} />
        <Route path="/articles/:articleId" element={<ArticlePage />} />
        <Route path="/insights" element={<PublicationPage />} />
        <Route path="/insights/:publicationId" element={<PublicationPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/signup" element={<AuthPage signup />} />
    </Routes><AnalyticsConsent /></Suspense>
  )
}
