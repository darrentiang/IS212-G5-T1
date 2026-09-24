import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'

// The real areas.js carries no route with a permission yet (SCRUM-27 owns the
// feature keys), so routing is tested against a stand-in list the tests set per
// case. vi.hoisted lets the mock factory read it.
const mocks = vi.hoisted(() => ({ routes: [] }))

vi.mock('../areas', () => ({
  get routes() {
    return mocks.routes
  },
}))
vi.mock('../../areas/auth/api')

import { ApiError } from '../http'
import * as authApi from '../../areas/auth/api'
import App, { RequireFeature } from '../App'
import { AuthProvider } from '../auth'
import LoginPage from '../../areas/auth/LoginPage'
import RequestsPage from '../../areas/requests/RequestsPage'

const LOGIN = { path: '/login', element: <LoginPage />, public: true }
const REQUESTS = {
  path: '/requests',
  element: <RequestsPage />,
  nav: 'Requests',
  permission: 'requests.view',
}
const VENUES = {
  path: '/venues',
  element: <p data-testid="venues-page">venues</p>,
  nav: 'Venues',
  permission: 'venues.view',
}
const REGISTRATION = {
  path: '/registration',
  element: <p data-testid="registration-page">registration</p>,
  nav: 'Registration',
}

// Reads the address the router settled on, so a redirect can be asserted.
function Address() {
  return <span data-testid="address">{useLocation().pathname}</span>
}

beforeEach(() => {
  mocks.routes = [LOGIN, REQUESTS, VENUES, REGISTRATION]
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderApp(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Address />
    </MemoryRouter>,
  )
}

describe('App', () => {
  // @story: setup
  // @ac: frontend-scaffold
  it('sends an account-less visitor to the login page', async () => {
    authApi.me.mockRejectedValue(new ApiError(401, 'Not logged in'))

    renderApp('/requests')

    expect(await screen.findByTestId('login-username-input')).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/login')
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('lands a logged-in account on its home page from / and from an unknown address', async () => {
    authApi.me.mockResolvedValue({
      username: 'coord1',
      roles: ['Event Coordinator'],
      features: ['requests.view'],
    })

    renderApp('/')
    expect(await screen.findByTestId('requests-empty')).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/requests')

    cleanup()

    renderApp('/nowhere')
    expect(await screen.findByTestId('requests-empty')).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/requests')
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('shows the not-permitted page, at the same address, for a missing feature', async () => {
    authApi.me.mockResolvedValue({ username: 'att1', roles: ['Attendee'], features: [] })

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/venues']}>
          <RequireFeature permission="venues.view">
            <p>venues page</p>
          </RequireFeature>
          <Address />
        </MemoryRouter>
      </AuthProvider>,
    )

    expect(await screen.findByTestId('not-permitted-message')).toBeInTheDocument()
    expect(screen.queryByText('venues page')).not.toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/venues')
  })

  // @story: setup
  // @ac: ui-shell
  it('sends an account to the first nav entry its features allow, not to /requests', async () => {
    authApi.me.mockResolvedValue({
      username: 'venue1',
      roles: ['Venue Staff'],
      features: ['venues.view'],
    })

    renderApp('/')

    expect(await screen.findByTestId('venues-page')).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/venues')
  })

  // @story: setup
  // @ac: ui-shell
  it('sends an account with no features to the first nav entry that needs none', async () => {
    authApi.me.mockResolvedValue({ username: 'att1', roles: ['Attendee'], features: [] })

    renderApp('/')

    expect(await screen.findByTestId('registration-page')).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/registration')
  })

  // @story: setup
  // @ac: ui-shell
  it('shows a welcome home page inside the layout when no page is permitted', async () => {
    mocks.routes = [LOGIN, REQUESTS, VENUES]
    authApi.me.mockResolvedValue({ username: 'att1', roles: ['Attendee'], features: [] })

    renderApp('/')

    expect(await screen.findByTestId('home-title')).toHaveTextContent('Welcome, att1')
    expect(screen.getByTestId('home-message')).toHaveTextContent(
      'There is nothing for your role to do here yet.',
    )
    // Inside the layout, not in place of it; and at '/', not redirected.
    expect(screen.getByTestId('layout-logout-button')).toBeInTheDocument()
    expect(screen.queryByTestId('not-permitted-message')).not.toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/')
  })
})
