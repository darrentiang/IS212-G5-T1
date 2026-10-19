import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import UnassignedQueuePage from '../UnassignedQueuePage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

const OLDER = {
  id: 7,
  name: 'Queue Older',
  purpose: 'Client showcase',
  date: '2026-12-12',
  attendance: 120,
  created_by: 'org1',
  submitted_at: '2026-09-20T09:30:00',
}
const NEWER = { ...OLDER, id: 8, name: 'Queue Newer', created_by: 'org2', submitted_at: null }
const COORDINATORS = [
  { id: 3, username: 'coord1' },
  { id: 4, username: 'coord2' },
]

function renderPage() {
  render(
    <MemoryRouter>
      <UnassignedQueuePage />
    </MemoryRouter>,
  )
}

function mockQueue(rows = [OLDER, NEWER]) {
  api.listAssignmentQueue.mockResolvedValue(rows)
  api.listAssignableCoordinators.mockResolvedValue(COORDINATORS)
}

describe('UnassignedQueuePage', () => {
  // @story: SCRUM-86
  // @ac: 3
  it('lists each queued request in the order the API sends, with its details', async () => {
    mockQueue()

    renderPage()

    await screen.findByTestId('assignment-queue-row-7')
    const rows = screen.getAllByTestId(/^assignment-queue-row-/).map((row) => row.dataset.testid)
    expect(rows).toEqual(['assignment-queue-row-7', 'assignment-queue-row-8'])
    expect(screen.getByTestId('assignment-queue-name-7')).toHaveTextContent('Queue Older')
    expect(screen.getByTestId('assignment-queue-name-7').querySelector('a')).toHaveAttribute('href', '/requests/7')
    expect(screen.getByTestId('assignment-queue-purpose-7')).toHaveTextContent('Client showcase')
    expect(screen.getByTestId('assignment-queue-date-7')).toHaveTextContent('12 Dec 2026')
    expect(screen.getByTestId('assignment-queue-attendance-7')).toHaveTextContent('120')
    expect(screen.getByTestId('assignment-queue-organiser-7')).toHaveTextContent('org1')
    expect(screen.getByTestId('assignment-queue-submitted-7')).toHaveTextContent('20 Sep 2026, 09:30')
    expect(screen.getByTestId('assignment-queue-submitted-8')).toBeEmptyDOMElement()
  })

  // @story: SCRUM-86
  // @ac: 4
  it('offers every Event Coordinator the API sends, after a prompt', async () => {
    mockQueue([OLDER])

    renderPage()

    await screen.findByTestId('assignment-queue-coordinator-input-7')
    const options = [...screen.getByTestId('assignment-queue-coordinator-input-7').options].map((option) => option.textContent)
    expect(options).toEqual(['Choose a coordinator', 'coord1', 'coord2'])
  })

  // @story: SCRUM-86
  // @ac: 2
  it('says so when no request is waiting', async () => {
    mockQueue([])

    renderPage()

    expect(await screen.findByTestId('assignment-queue-empty')).toHaveTextContent('No requests are waiting')
    expect(screen.queryByTestId('assignment-queue-row-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-86
  // @ac: 4
  it('assigns the chosen coordinator, takes the row out and says who', async () => {
    mockQueue()
    api.assignRequest.mockResolvedValue({ ...OLDER, status: 'Submitted', assigned_coordinator: 'coord2' })

    renderPage()
    await userEvent.selectOptions(await screen.findByTestId('assignment-queue-coordinator-input-7'), 'coord2')
    await userEvent.click(screen.getByTestId('assignment-queue-assign-button-7'))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-queue-banner')).toHaveTextContent('Queue Older assigned to coord2')
    })
    expect(api.assignRequest).toHaveBeenCalledWith(7, 4)
    expect(screen.getByTestId('assignment-queue-banner')).toHaveAttribute('role', 'status')
    expect(screen.queryByTestId('assignment-queue-row-7')).not.toBeInTheDocument()
    expect(screen.getByTestId('assignment-queue-row-8')).toBeInTheDocument()
  })

  // @story: SCRUM-86
  // @ac: 4
  it('shows a message under the select and sends nothing when no one is chosen', async () => {
    mockQueue()

    renderPage()
    await userEvent.click(await screen.findByTestId('assignment-queue-assign-button-7'))

    expect(screen.getByTestId('assignment-queue-coordinator-error-7')).toHaveTextContent('Choose an Event Coordinator.')
    expect(screen.queryByTestId('assignment-queue-coordinator-error-8')).not.toBeInTheDocument()
    expect(api.assignRequest).not.toHaveBeenCalled()
  })

  // @story: SCRUM-86
  // @ac: 4
  it('clears the message once a coordinator is chosen', async () => {
    mockQueue()

    renderPage()
    await userEvent.click(await screen.findByTestId('assignment-queue-assign-button-7'))
    await userEvent.selectOptions(screen.getByTestId('assignment-queue-coordinator-input-7'), 'coord1')

    expect(screen.queryByTestId('assignment-queue-coordinator-error-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-86
  // @ac: 5
  it('shows the refusal in the banner and reloads the queue when it was assigned elsewhere', async () => {
    api.listAssignmentQueue.mockResolvedValueOnce([OLDER, NEWER]).mockResolvedValueOnce([NEWER])
    api.listAssignableCoordinators.mockResolvedValue(COORDINATORS)
    api.assignRequest.mockRejectedValue(
      Object.assign(new Error('This request is already assigned to coord2.'), { status: 409 }),
    )

    renderPage()
    await userEvent.selectOptions(await screen.findByTestId('assignment-queue-coordinator-input-7'), 'coord1')
    await userEvent.click(screen.getByTestId('assignment-queue-assign-button-7'))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-queue-banner')).toHaveTextContent('This request is already assigned to coord2.')
    })
    expect(screen.getByTestId('assignment-queue-banner')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('assignment-queue-row-7')).not.toBeInTheDocument()
    expect(screen.getByTestId('assignment-queue-row-8')).toBeInTheDocument()
  })

  // @story: SCRUM-86
  // @ac: 5
  it('shows the reload error when the queue cannot be reloaded after a refusal', async () => {
    api.listAssignmentQueue
      .mockResolvedValueOnce([OLDER])
      .mockRejectedValueOnce(Object.assign(new Error('Something went wrong'), { status: 500 }))
    api.listAssignableCoordinators.mockResolvedValue(COORDINATORS)
    api.assignRequest.mockRejectedValue(Object.assign(new Error('Request not found.'), { status: 404 }))

    renderPage()
    await userEvent.selectOptions(await screen.findByTestId('assignment-queue-coordinator-input-7'), 'coord1')
    await userEvent.click(screen.getByTestId('assignment-queue-assign-button-7'))

    await waitFor(() => {
      expect(screen.getByTestId('assignment-queue-banner')).toHaveTextContent('Something went wrong')
    })
  })

  // @story: SCRUM-86
  // @ac: 9
  it('shows the API refusal and no queue when the account is not the Lead', async () => {
    api.listAssignmentQueue.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )
    api.listAssignableCoordinators.mockResolvedValue(COORDINATORS)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('assignment-queue-banner')).toHaveTextContent('You do not have permission')
    })
    expect(screen.queryByTestId('assignment-queue-row-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-86
  // @ac: 3
  it('ignores the queue after the page is left', async () => {
    let resolveQueue
    api.listAssignmentQueue.mockReturnValue(new Promise((resolve) => { resolveQueue = resolve }))
    api.listAssignableCoordinators.mockResolvedValue(COORDINATORS)
    const { unmount } = render(
      <MemoryRouter>
        <UnassignedQueuePage />
      </MemoryRouter>,
    )
    unmount()

    await act(async () => resolveQueue([OLDER]))
  })

  // @story: SCRUM-86
  // @ac: 9
  it('ignores a refusal after the page is left', async () => {
    let rejectQueue
    api.listAssignmentQueue.mockReturnValue(new Promise((_, reject) => { rejectQueue = reject }))
    api.listAssignableCoordinators.mockResolvedValue(COORDINATORS)
    const { unmount } = render(
      <MemoryRouter>
        <UnassignedQueuePage />
      </MemoryRouter>,
    )
    unmount()

    await act(async () => rejectQueue(new Error('late')))
  })

  // @story: SCRUM-86
  // @ac: 4
  it('lets the banner be dismissed', async () => {
    mockQueue()
    api.assignRequest.mockResolvedValue({ ...OLDER, assigned_coordinator: 'coord1' })

    renderPage()
    await userEvent.selectOptions(await screen.findByTestId('assignment-queue-coordinator-input-7'), 'coord1')
    await userEvent.click(screen.getByTestId('assignment-queue-assign-button-7'))
    await userEvent.click(await screen.findByTestId('assignment-queue-banner-dismiss'))

    expect(screen.queryByTestId('assignment-queue-banner')).not.toBeInTheDocument()
  })
})
