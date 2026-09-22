import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  // @story: SCRUM-27
  // @ac: 6
  it('ignores the API result after unmount', async () => {
    let resolveList
    api.listOpenEvents.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )
    const { unmount } = render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )
    unmount()
    resolveList([])
  })

  // @story: SCRUM-27
  // @ac: 8
  it('ignores the API error after unmount', async () => {
    let rejectList
    api.listOpenEvents.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectList = reject
      }),
    )
    const { unmount } = render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )
    unmount()
    rejectList(new Error('gone'))
  })
})
