import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import * as authApi from '../../areas/auth/api'
import { AuthProvider } from '../auth'
import Layout from '../Layout'

vi.mock('../../areas/auth/api')

// The real areas.js carries no route with a permission yet (SCRUM-27 owns the
// feature keys), so the nav filter is tested against a stand-in list.
vi.mock('../areas', () => ({
  routes: [
    { path: '/requests', element: null, nav: 'Requests' },
    { path: '/venues', element: null, nav: 'Venues', permission: 'venues.view' },
    { path: '/requests/:id', element: null },
  ],
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function Address() {
  return <span data-testid="address">{useLocation().pathname}</span>
}

async function renderLayout(account) {
  authApi.me.mockResolvedValue(account)
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/requests']}>
        <Routes>
          <Route path="/requests" element={<Layout />} />
          <Route path="/login" element={<p>login page</p>} />
        </Routes>
        <Address />
      </MemoryRouter>
    </AuthProvider>,
  )
  await screen.findByTestId('layout-username')
}

describe('Layout', () => {
  // @story: setup
  // @ac: frontend-scaffold
  it('shows the username and every role the account holds', async () => {
    await renderLayout({ username: 'coord1', roles: ['Event Coordinator'], features: [] })

    expect(screen.getByTestId('layout-username')).toHaveTextContent('coord1')
    expect(screen.getByTestId('layout-roles')).toHaveTextContent('Event Coordinator')
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('lists two roles comma-separated in the order the API returned them', async () => {
    await renderLayout({
      username: 'multi1',
      roles: ['Event Coordinator', 'Venue Staff'],
      features: [],
    })

    expect(screen.getByTestId('layout-roles')).toHaveTextContent('Event Coordinator, Venue Staff')
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('hides a nav entry whose permission the account lacks', async () => {
    await renderLayout({ username: 'coord1', roles: ['Event Coordinator'], features: [] })

    expect(screen.getByTestId('layout-nav-requests')).toBeInTheDocument()
    expect(screen.queryByTestId('layout-nav-venues')).not.toBeInTheDocument()
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('shows a nav entry whose permission the account has', async () => {
    await renderLayout({
      username: 'venue1',
      roles: ['Venue Staff'],
      features: ['venues.view'],
    })

    const link = screen.getByTestId('layout-nav-venues')
    expect(link).toBeInTheDocument()
    expect(link).toHaveTextContent('Venues')
    // A route without a nav label gets no link.
    expect(screen.queryByTestId('layout-nav-:id')).not.toBeInTheDocument()
  })
  // @story: setup
  // @ac: frontend-scaffold
  it('logs the account out and goes to the login page', async () => {
    authApi.logout.mockResolvedValue(null)
    await renderLayout({ username: 'coord1', roles: ['Event Coordinator'], features: [] })

    await userEvent.click(screen.getByTestId('layout-logout-button'))

    await waitFor(() => {
      expect(screen.getByTestId('address')).toHaveTextContent('/login')
    })
    expect(authApi.logout).toHaveBeenCalled()
  })
})
