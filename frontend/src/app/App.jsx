import { Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth'
import { routes } from './areas'
import HomePage from './HomePage'
import { homePathFor } from './home'
import Layout from './Layout'
import NotPermittedPage from './NotPermittedPage'

// The permission guard (docs/design/frontend.md §4). A route the account may
// not open shows the not-permitted page at the same address; it is never
// redirected, so the user can see where they are.
export function RequireFeature({ permission, children }) {
  const { can } = useAuth()
  if (permission && !can(permission)) {
    return <NotPermittedPage />
  }
  return children
}

function AppRoutes() {
  const { account, loading } = useAuth()

  // Render nothing until /api/me has answered, so a logged-in user never sees
  // the login page flash.
  if (loading) return null

  const publicRoutes = routes.filter((route) => route.public)
  const privateRoutes = routes.filter((route) => !route.public)

  // An account that may open nothing gets a welcome page at '/' rather than
  // being redirected in a circle.
  const home = homePathFor(account)
  const goHome = home ? <Navigate to={home} replace /> : <HomePage />

  return (
    <Routes>
      {publicRoutes.map((route) => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}

      <Route element={account ? <Layout /> : <Navigate to="/login" replace />}>
        {privateRoutes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={<RequireFeature permission={route.permission}>{route.element}</RequireFeature>}
          />
        ))}
        <Route path="/" element={goHome} />
        <Route path="*" element={goHome} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
