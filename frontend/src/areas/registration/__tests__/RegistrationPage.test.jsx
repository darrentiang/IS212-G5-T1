import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import RegistrationPage from '../RegistrationPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RegistrationPage', () => {
  // @story: SCRUM-27
  // @ac: 6
  it('lists confirmed events without internal notes', async () => {
    api.listOpenEvents.mockResolvedValue([
      { id: 4, name: 'Open House', status: 'Confirmed', registration_enabled: true, purpose: 'Public open house' },
    ])

    render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Open House')).toBeInTheDocument()
    })
    expect(screen.queryByText(/coordinator notes/i)).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 8
  it('shows the API refusal in the banner', async () => {
    api.listOpenEvents.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('registration-banner')).toHaveTextContent(/permission/i)
    })
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.listOpenEvents.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )
    render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )
    await screen.findByTestId('registration-banner')

    await userEvent.click(screen.getByTestId('registration-banner-dismiss'))

    expect(screen.queryByTestId('registration-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 6
  it('shows the empty message when the API returns no events', async () => {
    api.listOpenEvents.mockResolvedValue([])

    render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('registration-empty')).toBeInTheDocument()
    })
  })
})
