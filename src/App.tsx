import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { lazy, Suspense } from 'react'
const TopIdeasPage = lazy(() => import('@/pages/app/HighlightsPage').then(module => ({ default: module.TopIdeasPage })))
const WebsiteInsightsPage = lazy(() => import('@/pages/app/HighlightsPage').then(module => ({ default: module.WebsiteInsightsPage })))
const AuthPage = lazy(() => import('@/pages/auth/AuthPage').then(module => ({ default: module.AuthPage })))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage').then(module => ({ default: module.AdminPage })))
const UsagePage = lazy(() => import('@/pages/app/UsagePage').then(module => ({ default: module.UsagePage })))
const WorkspacesPage = lazy(() => import('@/pages/app/WorkspacesPage').then(module => ({ default: module.WorkspacesPage })))
const PlanningPage = lazy(() => import('@/pages/app/PlanningPage').then(module => ({ default: module.PlanningPage })))
const StudioReviewPage = lazy(() => import('@/pages/app/StudioReviewPage').then(module => ({ default: module.StudioReviewPage })))
const StudioPage = lazy(() => import('@/pages/app/StudioPage').then(module => ({ default: module.StudioPage })))
const IntelligencePage = lazy(() => import('@/pages/app/IntelligencePage').then(module => ({ default: module.IntelligencePage })))
const FindIdeaPage = lazy(() => import('@/pages/app/FindIdeaPage').then(module => ({ default: module.FindIdeaPage })))
const ArticlePage = lazy(() => import('@/pages/app/StudioPage').then(module => ({ default: module.ArticlePage })))
const PublicationPage = lazy(() => import('@/pages/app/PublicationPage').then(module => ({ default: module.PublicationPage })))
import { AnalyticsConsent } from '@/components/common/AnalyticsConsent'

export default function App() {
  return (
    <Suspense fallback={<div className="app-loading" role="status"><span className="app-loading-spinner" aria-hidden="true" /><strong>Opening your workspace</strong><span>Getting things ready…</span></div>}><Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate replace to="/ideas" />} />
        <Route path="/find-ideas" element={<FindIdeaPage />} />
        <Route path="/ideas" element={<IntelligencePage />} />
        <Route path="/ideas/:categoryId" element={<IntelligencePage />} />
        <Route path="/ideas/:categoryId/edit" element={<IntelligencePage />} />
        <Route path="/dashboard" element={<TopIdeasPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/studio-review/:owner/:packageId" element={<StudioReviewPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/planning" element={<PlanningPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/studio/:packageId" element={<StudioPage />} />
        <Route path="/articles/:articleId" element={<ArticlePage />} />
        <Route path="/insights" element={<WebsiteInsightsPage />} />
        <Route path="/insights/:publicationId" element={<PublicationPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/signup" element={<AuthPage signup />} />
    </Routes><AnalyticsConsent /></Suspense>
  )
}
