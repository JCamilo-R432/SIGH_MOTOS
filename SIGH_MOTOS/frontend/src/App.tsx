import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/store/authStore'
import { Layout } from '@/components/layout/Layout'
import { Spinner } from '@/components/ui/Spinner'

// Lazy pages
const Login           = lazy(() => import('@/pages/Login'))
const Dashboard       = lazy(() => import('@/pages/Dashboard'))
const Inventory       = lazy(() => import('@/pages/Inventory'))
const POS             = lazy(() => import('@/pages/POS'))
const Invoices        = lazy(() => import('@/pages/Invoices'))
const Purchases       = lazy(() => import('@/pages/Purchases'))
const Treasury        = lazy(() => import('@/pages/Treasury'))
const Reports         = lazy(() => import('@/pages/Reports'))
const Security        = lazy(() => import('@/pages/Security'))
const Credits         = lazy(() => import('@/pages/Credits'))
const PrintTicketPage   = lazy(() => import('@/pages/PrintTicketPage'))
const Settings          = lazy(() => import('@/pages/Settings'))
const Classifications   = lazy(() => import('@/pages/Classifications'))
const NotFound          = lazy(() => import('@/pages/NotFound'))

const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <Spinner size="lg" />
  </div>
)

// Protected route wrapper
const ProtectedRoute = ({ children, roles }: { children: React.ReactNode; roles?: string[] }) => {
  const { isAuthenticated, user } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/inventory" replace />
  return <>{children}</>
}

// Unauthorized redirect listener
const AuthListener = () => {
  const navigate = useNavigate()
  const { logout } = useAuthStore()
  useEffect(() => {
    const handler = () => { logout(); navigate('/login') }
    window.addEventListener('sigc:unauthorized', handler)
    return () => window.removeEventListener('sigc:unauthorized', handler)
  }, [logout, navigate])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthListener />
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />
          {/* Ticket térmico — fuera del layout (ventana emergente) */}
          <Route path="/print-ticket/:saleId" element={<PrintTicketPage />} />

          {/* Protected — with layout */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={
              <ProtectedRoute roles={['ADMIN']}>
                <Dashboard />
              </ProtectedRoute>
            } />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/pos" element={
              <ProtectedRoute roles={['ADMIN', 'SELLER']}>
                <POS />
              </ProtectedRoute>
            } />
            <Route path="/invoices" element={
              <ProtectedRoute roles={['ADMIN', 'SELLER']}>
                <Invoices />
              </ProtectedRoute>
            } />
            <Route path="/purchases" element={
              <ProtectedRoute roles={['ADMIN', 'WAREHOUSE']}>
                <Purchases />
              </ProtectedRoute>
            } />
            <Route path="/treasury" element={
              <ProtectedRoute roles={['ADMIN']}>
                <Treasury />
              </ProtectedRoute>
            } />
            <Route path="/reports" element={
              <ProtectedRoute roles={['ADMIN']}>
                <Reports />
              </ProtectedRoute>
            } />
            <Route path="/security" element={
              <ProtectedRoute roles={['ADMIN']}>
                <Security />
              </ProtectedRoute>
            } />
            <Route path="/credits" element={
              <ProtectedRoute roles={['ADMIN', 'SELLER']}>
                <Credits />
              </ProtectedRoute>
            } />
            <Route path="/classifications" element={
              <ProtectedRoute roles={['ADMIN', 'WAREHOUSE']}>
                <Classifications />
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute roles={['ADMIN']}>
                <Settings />
              </ProtectedRoute>
            } />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
