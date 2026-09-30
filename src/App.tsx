import { Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/app/DashboardPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { lazy, Suspense } from 'react'
const AuthPage = lazy(() => import('@/pages/auth/AuthPage').then(module => ({ default: module.AuthPage })))
const AdminPage = lazy(() => import('@/pages/admin/AdminPage').then(module => ({ default: module.AdminPage })))
import { AnalyticsConsent } from '@/components/common/AnalyticsConsent'

export default function App() {
  return (
    <Suspense fallback={<div className="feed-empty" role="status">Loading…</div>}><Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/signup" element={<AuthPage signup />} />
    </Routes><AnalyticsConsent /></Suspense>
  )
}
