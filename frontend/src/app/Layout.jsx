import { Link, Outlet, useNavigate } from 'react-router'
import { useAuth } from './auth'
import { routes } from './areas'

// The nav test id uses the last segment of the path: /requests -> requests
// (docs/design/ui-guidelines.md §2).
const pageOf = (path) => path.split('/').filter(Boolean).at(-1)

export default function Layout() {
  const { account, can, logout } = useAuth()
  const navigate = useNavigate()

  // A link that would lead to the not-permitted page is not shown.
  const navRoutes = routes.filter(
    (route) => route.nav && (!route.permission || can(route.permission)),
  )

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="font-semibold text-gray-900">ConnectSphere</span>

          <div className="flex-1 flex flex-wrap items-center justify-center gap-x-2 text-sm text-gray-600">
            <span data-testid="layout-username">{account?.username}</span>
            <span data-testid="layout-roles">{(account?.roles ?? []).join(', ')}</span>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-100 cursor-pointer"
            data-testid="layout-logout-button"
          >
            Log out
          </button>
        </div>

        <nav className="mx-auto max-w-5xl px-4 pb-2 flex flex-wrap gap-4 text-sm">
          {navRoutes.map((route) => (
            <Link
              key={route.path}
              to={route.path}
              className="text-blue-700 hover:underline"
              data-testid={`layout-nav-${pageOf(route.path)}`}
            >
              {route.nav}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
