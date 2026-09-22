import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/1']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequestDetailPage', () => {
  // @story: SCRUM-27
  // @ac: 1
  it('shows public fields when the API returns the request', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Annual Dinner',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-name')).toHaveTextContent('Annual Dinner')
    })
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    expect(screen.queryByTestId('request-detail-coordinator-notes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-submit-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 2, 8
  it('shows the refusal banner and no fields when the API refuses', async () => {
    api.getRequest.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent(/permission/i)
    })
    expect(screen.queryByTestId('request-detail-name')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 6
  it('shows coordinator notes when the API includes them', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Annual Dinner',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
      coordinator_notes: 'Internal: venue shortlist pending.',
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-coordinator-notes')).toHaveTextContent('venue shortlist')
    })
  })

  // @story: SCRUM-27
  // @ac: 1
  it('ignores the API result after unmount', async () => {
    let resolveGet
    api.getRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    resolveGet({ id: 1, name: 'Annual Dinner', status: 'Submitted', created_by: 'org1', registration_enabled: false })
  })

  // @story: SCRUM-27
  // @ac: 8
  it('ignores the API error after unmount', async () => {
    let rejectGet
    api.getRequest.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectGet = reject
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    rejectGet(new Error('gone'))
  })

  // @story: SCRUM-28
  // @ac: 2
  it("offers Submit on the owner's Draft request", async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-submit-button')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-28
  // @ac: 2, 4, 6
  it('submits the Draft and shows the new status with a success banner', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.submitDraft.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-submit-button'))
    await userEvent.click(screen.getByTestId('request-detail-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    })
    expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request submitted')
    expect(screen.queryByTestId('request-detail-submit-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-28
  // @ac: 3
  it('shows the API refusal when submitting an already-Submitted request', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.submitDraft.mockRejectedValue(
      Object.assign(new Error('Only a Draft request can be submitted.'), { status: 400 }),
    )

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-submit-button'))
    await userEvent.click(screen.getByTestId('request-detail-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Only a Draft request can be submitted.')
    })
  })
})
