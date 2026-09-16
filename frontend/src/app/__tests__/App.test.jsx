import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { ApiError } from '../http'
import * as authApi from '../../areas/auth/api'
import App, { RequireFeature } from '../App'
import { AuthProvider } from '../auth'

vi.mock('../../areas/auth/api')

// Reads the address the router settled on, so a redirect can be asserted.
function Address() {
  return <span data-testid="address">{useLocation().pathname}</span>
}

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
  it('lands a logged-in account on /requests from / and from an unknown address', async () => {
    authApi.me.mockResolvedValue({ username: 'coord1', roles: ['Event Coordinator'], features: [] })

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
})
