import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { ApiError } from '../../../app/http'
import * as api from '../api'
import * as notificationsApi from '../../notifications/api'
import { AuthProvider } from '../../../app/auth'
import LoginPage from '../LoginPage'

vi.mock('../api')
vi.mock('../../notifications/api')

function Address() {
  return <span data-testid="address">{useLocation().pathname}</span>
}

afterEach(() => {
  vi.restoreAllMocks()
})

// '/' exactly: toHaveTextContent matches substrings, and every path contains a
// slash, so the assertion has to be anchored.
const ROOT = /^\/$/

function renderLoginPage(account) {
  if (account) {
    api.me.mockResolvedValue(account)
  } else {
    api.me.mockRejectedValue(new ApiError(401, 'Not logged in'))
  }
  notificationsApi.getUnreadCount.mockResolvedValue({ unread_count: 0 })
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
        <Address />
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('LoginPage', () => {
  // @story: setup
  // @ac: frontend-scaffold
  it('shows a message under each empty required field and sends nothing', async () => {
    renderLoginPage()

    await userEvent.click(screen.getByTestId('login-submit-button'))

    expect(screen.getByTestId('login-username-error')).toBeInTheDocument()
    expect(screen.getByTestId('login-password-error')).toBeInTheDocument()
    expect(api.login).not.toHaveBeenCalled()
    expect(screen.queryByTestId('login-banner')).not.toBeInTheDocument()
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('shows the API refusal in the banner and stays on the login page', async () => {
    renderLoginPage()
    api.login.mockRejectedValue(new ApiError(401, 'Invalid username or password'))

    await userEvent.type(screen.getByTestId('login-username-input'), 'org1')
    await userEvent.type(screen.getByTestId('login-password-input'), 'wrong')
    await userEvent.click(screen.getByTestId('login-submit-button'))

    const banner = await screen.findByTestId('login-banner')
    expect(banner).toHaveTextContent('Invalid username or password')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('address')).toHaveTextContent('/login')
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    renderLoginPage()
    api.login.mockRejectedValue(new ApiError(401, 'Invalid username or password'))
    await userEvent.type(screen.getByTestId('login-username-input'), 'org1')
    await userEvent.type(screen.getByTestId('login-password-input'), 'wrong')
    await userEvent.click(screen.getByTestId('login-submit-button'))
    await screen.findByTestId('login-banner')

    await userEvent.click(screen.getByTestId('login-banner-dismiss'))

    expect(screen.queryByTestId('login-banner')).not.toBeInTheDocument()
  })

  // @story: setup
  // @ac: ui-shell
  it('lands on / when the API accepts the credentials', async () => {
    renderLoginPage()
    api.login.mockResolvedValue({
      username: 'venue1',
      roles: ['Venue Staff'],
      features: ['venues.view'],
    })

    await userEvent.type(screen.getByTestId('login-username-input'), 'venue1')
    await userEvent.type(screen.getByTestId('login-password-input'), 'Passw0rd!')
    await userEvent.click(screen.getByTestId('login-submit-button'))

    // '/' and not a page: the page does not know which pages this account may
    // open, and App turns '/' into its home page. App.test.jsx proves that.
    await waitFor(() => {
      expect(screen.getByTestId('address')).toHaveTextContent(ROOT)
    })
    expect(api.login).toHaveBeenCalledWith('venue1', 'Passw0rd!')
  })

  // @story: setup
  // @ac: ui-shell
  it('does not show the form again to an account that is already logged in', async () => {
    renderLoginPage({ username: 'venue1', roles: ['Venue Staff'], features: ['venues.view'] })

    await waitFor(() => {
      expect(screen.getByTestId('address')).toHaveTextContent(ROOT)
    })
    expect(screen.queryByTestId('login-username-input')).not.toBeInTheDocument()
  })
})
