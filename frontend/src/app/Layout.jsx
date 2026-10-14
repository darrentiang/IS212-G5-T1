import { useLayoutEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from './auth'
import { routes } from './areas'

// The nav test id uses the last segment of the path: /requests -> requests
// (docs/design/ui-guidelines.md §2).
const pageOf = (path) => path.split('/').filter(Boolean).at(-1)

export default function Layout() {
  const { account, can, logout, unreadCount } = useAuth()
  const navigate = useNavigate()
  const headerRef = useRef(null)

  // The page banner sticks just below the header (ui-guidelines.md §4). The
  // header wraps onto two rows on a narrow screen, so its height is measured
  // into --topbar-height, which the .banner class reads.
  useLayoutEffect(() => {
    const header = headerRef.current
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--topbar-height', `${header.offsetHeight}px`)
    })
    observer.observe(header)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--topbar-height')
    }
  }, [])

  // A link that would lead to the not-permitted page is not shown.
  const navRoutes = routes.filter(
    (route) => route.nav && (!route.permission || can(route.permission)),
  )

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen">
      <header ref={headerRef} className="topbar">
        <div className="mx-auto max-w-[1100px] px-4 md:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="topbar-brand">ConnectSphere</span>

          {/* NavLink marks the current page with the "active" class. */}
          <nav className="order-last w-full md:order-none md:w-auto flex gap-1 overflow-x-auto">
            {navRoutes.map((route) => (
              <NavLink
                key={route.path}
                to={route.path}
                className="nav-link"
                data-testid={`layout-nav-${pageOf(route.path)}`}
              >
                {route.nav}
                {/* SCRUM-58: the unread count, only on the Notifications link, only while there is one. */}
                {route.path === '/notifications' && unreadCount > 0 && (
                  <> (<span data-testid="layout-nav-notifications-count">{unreadCount}</span>)</>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-3">
            <div className="topbar-account flex flex-col items-end md:flex-row md:gap-x-2 text-right">
              <span data-testid="layout-username">{account?.username}</span>
              <span data-testid="layout-roles">{(account?.roles ?? []).join(', ')}</span>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-secondary"
              data-testid="layout-logout-button"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 md:px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
