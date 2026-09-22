import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import RequestsPage from '../RequestsPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RequestsPage', () => {
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

  // @story: SCRUM-27
  // @ac: 1
  it('ignores the API result after unmount', async () => {
    let resolveList
    api.listRequests.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve
      }),
    )
    const { unmount } = render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )
    unmount()
    resolveList([])
  })

  // @story: SCRUM-27
  // @ac: 8
  it('ignores the API error after unmount', async () => {
    let rejectList
    api.listRequests.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectList = reject
      }),
    )
    const { unmount } = render(
      <MemoryRouter>
        <RequestsPage />
      </MemoryRouter>,
    )
    unmount()
    rejectList(new Error('gone'))
  })
})
