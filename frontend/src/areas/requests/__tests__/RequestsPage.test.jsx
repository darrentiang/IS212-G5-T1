import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import RequestsPage from '../RequestsPage'

vi.mock('../api')
vi.mock('../../../app/auth')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RequestsPage', () => {
  beforeEach(() => {
    vi.mocked(auth.useAuth).mockReturnValue({ can: () => false })
  })

  // @story: SCRUM-27
  // @ac: 1
  it('lists only the requests the API returns', async () => {
    api.listRequests.mockResolvedValue([
      { id: 1, name: 'Annual Dinner', status: 'Submitted', created_by: 'org1', registration_enabled: false },
    ])

    render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Annual Dinner')).toBeInTheDocument()
    })
    expect(screen.getByTestId('requests-status-1')).toHaveTextContent('Submitted')
    expect(screen.queryByText('Client B Conference')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 8
  it('shows the API refusal in the banner', async () => {
    api.listRequests.mockRejectedValue(Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }))

    render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('requests-banner')).toHaveTextContent(/permission/i)
    })
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.listRequests.mockRejectedValue(Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }))
    render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )
    await screen.findByTestId('requests-banner')

    await userEvent.click(screen.getByTestId('requests-banner-dismiss'))

    expect(screen.queryByTestId('requests-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 1
  it('shows the empty message when the API returns no requests', async () => {
    api.listRequests.mockResolvedValue([])

    render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('requests-empty')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-28
  // @ac: 1
  it('offers New request to an account that may submit one', async () => {
    vi.mocked(auth.useAuth).mockReturnValue({ can: (feature) => feature === 'requests.edit' })
    api.listRequests.mockResolvedValue([])

    render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('requests-new-button')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-28
  // @ac: 1
  it('hides New request from an account that may not submit one', async () => {
    api.listRequests.mockResolvedValue([])

    render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('requests-title')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('requests-new-button')).not.toBeInTheDocument()
  })
})
