import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from '@/App'
import { AuthProvider } from '@/context/AuthProvider'
import '@/styles/global.css'
import '@/styles/brand.css'

const router = createBrowserRouter([{ path: '*', element: <AuthProvider><App /></AuthProvider> }])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
