import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { ApiError } from '../../../app/http'
import * as api from '../api'
import { AuthProvider } from '../../../app/auth'
import LoginPage from '../LoginPage'

vi.mock('../api')

function Address() {
  return <span data-testid="address">{useLocation().pathname}</span>
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderLoginPage() {
  api.me.mockRejectedValue(new ApiError(401, 'Not logged in'))
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/requests" element={<p>requests page</p>} />
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

  // @story: setup
  // @ac: frontend-scaffold
  it('goes to /requests when the API accepts the credentials', async () => {
    renderLoginPage()
    api.login.mockResolvedValue({
      username: 'org1',
      roles: ['Event Organiser'],
      features: [],
    })

    await userEvent.type(screen.getByTestId('login-username-input'), 'org1')
    await userEvent.type(screen.getByTestId('login-password-input'), 'Passw0rd!')
    await userEvent.click(screen.getByTestId('login-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('address')).toHaveTextContent('/requests')
    })
    expect(api.login).toHaveBeenCalledWith('org1', 'Passw0rd!')
  })
})
