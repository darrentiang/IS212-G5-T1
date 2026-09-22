import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../auth'
import * as api from '../../areas/auth/api'

vi.mock('../../areas/auth/api')

afterEach(() => {
  vi.restoreAllMocks()
})

function Probe() {
  const { account, loading, can, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="username">{account?.username ?? 'none'}</span>
      <span data-testid="can-view">{String(can('requests.view'))}</span>
      <button type="button" data-testid="do-login" onClick={() => login('org1', 'Passw0rd!')}>
        login
      </button>
      <button type="button" data-testid="do-logout" onClick={() => logout().catch(() => {})}>
        logout
      </button>
    </div>
  )
}

describe('AuthProvider', () => {
  // @story: SCRUM-26
  // @ac: 2
  it('holds the account from /api/me and answers can()', async () => {
    api.me.mockResolvedValue({
      username: 'org1',
      roles: ['Event Organiser'],
      features: ['requests.view'],
    })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('org1')
    })
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    expect(screen.getByTestId('can-view')).toHaveTextContent('true')
  })

  // @story: SCRUM-26
  // @ac: 5
  it('stays without an account when /api/me fails', async () => {
    api.me.mockRejectedValue(new Error('Not logged in'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none')
    })
    expect(screen.getByTestId('can-view')).toHaveTextContent('false')
  })

  // @story: SCRUM-26
  // @ac: 2
  it('stores the account from login and clears it on logout', async () => {
    api.me.mockRejectedValue(new Error('Not logged in'))
    api.login.mockResolvedValue({
      username: 'org1',
      roles: ['Event Organiser'],
      features: ['requests.view'],
    })
    api.logout.mockResolvedValue(null)

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none')
    })
    await screen.getByTestId('do-login').click()
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('org1')
    })
    await screen.getByTestId('do-logout').click()
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none')
    })
  })

  // @story: SCRUM-26
  // @ac: 2
  it('clears the account even when logout fails', async () => {
    api.me.mockRejectedValue(new Error('Not logged in'))
    api.login.mockResolvedValue({
      username: 'org1',
      roles: ['Event Organiser'],
      features: [],
    })
    api.logout.mockRejectedValue(new Error('gone'))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none')
    })
    await screen.getByTestId('do-login').click()
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('org1')
    })
    await screen.getByTestId('do-logout').click()
    await waitFor(() => {
      expect(screen.getByTestId('username')).toHaveTextContent('none')
    })
  })

  // @story: SCRUM-26
  // @ac: 2
  it('ignores the /api/me result after unmount', async () => {
    let resolveMe
    api.me.mockReturnValue(
      new Promise((resolve) => {
        resolveMe = resolve
      }),
    )

    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    unmount()
    resolveMe({ username: 'org1', roles: [], features: [] })
  })

  // @story: SCRUM-26
  // @ac: 5
  it('ignores the /api/me error after unmount', async () => {
    let rejectMe
    api.me.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectMe = reject
      }),
    )

    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    unmount()
    rejectMe(new Error('gone'))
  })
})
