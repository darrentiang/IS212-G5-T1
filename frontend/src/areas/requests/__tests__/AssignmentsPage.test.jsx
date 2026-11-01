import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import AssignmentsPage from '../AssignmentsPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

const PLANNING = { id: 7, name: 'Planning Gala', date: '2026-12-12', status: 'Planning', assigned_coordinator: 'coord1' }
const SUBMITTED = { id: 8, name: 'Queued Fair', date: '2026-12-20', status: 'Submitted', assigned_coordinator: null }
const WORKLOADS = [
  { id: 11, username: 'coord1', active_events: 1 },
  { id: 12, username: 'coord2', active_events: 0 },
]

function mockList(events = [PLANNING, SUBMITTED], coordinators = WORKLOADS) {
  api.listAssignments.mockResolvedValue({ events, coordinators })
}

function renderPage() {
  render(
    <MemoryRouter>
      <AssignmentsPage />
    </MemoryRouter>,
  )
}

describe('the list', () => {
  // @story: SCRUM-88
  // @ac: 1
  it('shows each active event with its name, date, status and coordinator', async () => {
    mockList()
    renderPage()

    expect(await screen.findByTestId('assignments-row-7')).toBeInTheDocument()
    expect(screen.getByTestId('assignments-name-7')).toHaveTextContent('Planning Gala')
    expect(screen.getByRole('link', { name: 'Planning Gala' })).toHaveAttribute('href', '/requests/7')
    expect(screen.getByTestId('assignments-date-7')).toHaveTextContent('12 Dec 2026')
    expect(screen.getByTestId('assignments-status-7')).toHaveTextContent('Planning')
    expect(screen.getByTestId('assignments-coordinator-7')).toHaveTextContent('coord1')
  })

  // @story: SCRUM-88
  // @ac: 1
  it('shows Unassigned for an event nobody holds', async () => {
    mockList()
    renderPage()

    expect(await screen.findByTestId('assignments-coordinator-8')).toHaveTextContent('Unassigned')
  })

  // @story: SCRUM-88
  // @ac: 1, 3
  it('says so when no active event matches', async () => {
    mockList([])
    renderPage()

    expect(await screen.findByTestId('assignments-empty')).toHaveTextContent('No active events match.')
  })

  // @story: SCRUM-88
  // @ac: 6
  it('shows the API message and nothing else when the list is refused', async () => {
    api.listAssignments.mockRejectedValue(new Error('You do not have permission to perform this action.'))
    renderPage()

    expect(await screen.findByTestId('assignments-banner')).toHaveTextContent(
      'You do not have permission to perform this action.',
    )
    expect(screen.queryByTestId('assignments-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('assignments-row-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-88
  // @ac: 6
  it('lets the user dismiss the message', async () => {
    const user = userEvent.setup()
    api.listAssignments.mockRejectedValue(new Error('Refused.'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Dismiss message' }))

    expect(screen.queryByTestId('assignments-banner')).not.toBeInTheDocument()
  })
})

describe('the filters', () => {
  // @story: SCRUM-88
  // @ac: 3
  it('asks the API for the coordinator and status chosen', async () => {
    const user = userEvent.setup()
    mockList()
    renderPage()
    await screen.findByTestId('assignments-row-7')

    api.listAssignments.mockResolvedValue({ events: [PLANNING], coordinators: WORKLOADS })
    await user.selectOptions(screen.getByTestId('assignments-coordinator-filter'), 'coord1')
    await waitFor(() => expect(screen.queryByTestId('assignments-row-8')).not.toBeInTheDocument())
    await user.selectOptions(screen.getByTestId('assignments-status-filter'), 'Planning')

    await waitFor(() =>
      expect(api.listAssignments).toHaveBeenLastCalledWith({ coordinator: 'coord1', status: 'Planning' }),
    )
    expect(screen.getByTestId('assignments-row-7')).toBeInTheDocument()
  })

  // @story: SCRUM-88
  // @ac: 3
  it('offers only the five active statuses', async () => {
    mockList()
    renderPage()
    await screen.findByTestId('assignments-row-7')

    const options = Array.from(screen.getByTestId('assignments-status-filter').options).map((o) => o.value)
    expect(options).toEqual(['', 'Submitted', 'Approved', 'Planning', 'Safety Check', 'Confirmed'])
  })

  // @story: SCRUM-88
  // @ac: 3
  it('shows the API message when a filtered list cannot be read', async () => {
    const user = userEvent.setup()
    mockList()
    renderPage()
    await screen.findByTestId('assignments-row-7')

    api.listAssignments.mockRejectedValue(new Error('Choose an Event Coordinator.'))
    await user.selectOptions(screen.getByTestId('assignments-coordinator-filter'), 'coord2')

    expect(await screen.findByTestId('assignments-banner')).toHaveTextContent('Choose an Event Coordinator.')
  })
})

describe('the workloads', () => {
  // @story: SCRUM-88
  // @ac: 4
  it('shows how many active events each coordinator holds, including none', async () => {
    mockList()
    renderPage()

    expect(await screen.findByTestId('assignments-workload-coord1')).toHaveTextContent('coord1: 1')
    expect(screen.getByTestId('assignments-workload-coord2')).toHaveTextContent('coord2: 0')
  })
})

describe('leaving the page', () => {
  // @story: SCRUM-88
  // @ac: 1
  it('ignores a list that arrives after the user has left', async () => {
    let resolve
    api.listAssignments.mockReturnValue(new Promise((done) => (resolve = done)))
    const { unmount } = render(
      <MemoryRouter>
        <AssignmentsPage />
      </MemoryRouter>,
    )

    unmount()
    await act(async () => resolve({ events: [PLANNING], coordinators: WORKLOADS }))

    expect(screen.queryByTestId('assignments-row-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-88
  // @ac: 6
  it('ignores a refusal that arrives after the user has left', async () => {
    let reject
    api.listAssignments.mockReturnValue(new Promise((_, fail) => (reject = fail)))
    const { unmount } = render(
      <MemoryRouter>
        <AssignmentsPage />
      </MemoryRouter>,
    )

    unmount()
    await act(async () => reject(new Error('Refused.')))

    expect(screen.queryByTestId('assignments-banner')).not.toBeInTheDocument()
  })
})

describe('reassigning', () => {
  // @story: SCRUM-44
  // @ac: 1
  it('offers a coordinator to choose and Reassign on an assigned event only', async () => {
    mockList()
    renderPage()

    expect(await screen.findByTestId('assignments-reassign-button-7')).toHaveTextContent('Reassign')
    expect(screen.getByTestId('assignments-reassign-input-7')).toBeInTheDocument()
    expect(screen.queryByTestId('assignments-reassign-input-8')).not.toBeInTheDocument()
    expect(screen.queryByTestId('assignments-reassign-button-8')).not.toBeInTheDocument()
  })

  // @story: SCRUM-44
  // @ac: 1
  it('offers every coordinator after "Choose a coordinator", the current one included', async () => {
    mockList()
    renderPage()

    const select = await screen.findByTestId('assignments-reassign-input-7')

    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Choose a coordinator',
      'coord1',
      'coord2',
    ])
  })

  // @story: SCRUM-44
  // @ac: 1, 3, 5
  it('sends the chosen coordinator, says so, and shows the list as it now stands', async () => {
    const user = userEvent.setup()
    mockList()
    api.reassignRequest.mockResolvedValue({ ...PLANNING, assigned_coordinator: 'coord2' })
    renderPage()
    await screen.findByTestId('assignments-row-7')

    api.listAssignments.mockResolvedValue({
      events: [{ ...PLANNING, assigned_coordinator: 'coord2' }, SUBMITTED],
      coordinators: WORKLOADS,
    })
    await user.selectOptions(screen.getByTestId('assignments-reassign-input-7'), 'coord2')
    await user.click(screen.getByTestId('assignments-reassign-button-7'))

    expect(api.reassignRequest).toHaveBeenCalledWith(7, 12)
    expect(await screen.findByTestId('assignments-banner')).toHaveTextContent('Planning Gala reassigned to coord2.')
    await waitFor(() => expect(screen.getByTestId('assignments-coordinator-7')).toHaveTextContent('coord2'))
    expect(screen.getByTestId('assignments-status-7')).toHaveTextContent('Planning')
    expect(screen.getByTestId('assignments-reassign-input-7')).toHaveValue('')
  })

  // @story: SCRUM-44
  // @ac: 1
  it('shows a message under the select and sends nothing when no one is chosen', async () => {
    const user = userEvent.setup()
    mockList()
    renderPage()

    await user.click(await screen.findByTestId('assignments-reassign-button-7'))

    expect(screen.getByTestId('assignments-reassign-error-7')).toHaveTextContent('Choose an Event Coordinator.')
    expect(api.reassignRequest).not.toHaveBeenCalled()

    await user.selectOptions(screen.getByTestId('assignments-reassign-input-7'), 'coord2')
    expect(screen.queryByTestId('assignments-reassign-error-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-44
  // @ac: 2
  it('shows the API refusal in the banner and keeps the list', async () => {
    const user = userEvent.setup()
    mockList()
    api.reassignRequest.mockRejectedValue(new Error('This event is already assigned to coord1.'))
    renderPage()

    await user.selectOptions(await screen.findByTestId('assignments-reassign-input-7'), 'coord1')
    await user.click(screen.getByTestId('assignments-reassign-button-7'))

    expect(await screen.findByTestId('assignments-banner')).toHaveTextContent(
      'This event is already assigned to coord1.',
    )
    await waitFor(() => expect(api.listAssignments).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('assignments-row-7')).toBeInTheDocument()
    expect(screen.getByTestId('assignments-coordinator-7')).toHaveTextContent('coord1')
  })

  // @story: SCRUM-44
  // @ac: 1
  it('drops an event that is no longer active when the refusal reloads the list', async () => {
    const user = userEvent.setup()
    mockList()
    api.reassignRequest.mockRejectedValue(new Error('A Cancelled event cannot be reassigned, only an active one.'))
    renderPage()
    await screen.findByTestId('assignments-row-7')

    api.listAssignments.mockResolvedValue({ events: [SUBMITTED], coordinators: WORKLOADS })
    await user.selectOptions(screen.getByTestId('assignments-reassign-input-7'), 'coord2')
    await user.click(screen.getByTestId('assignments-reassign-button-7'))

    expect(await screen.findByTestId('assignments-banner')).toHaveTextContent('Cancelled')
    await waitFor(() => expect(screen.queryByTestId('assignments-row-7')).not.toBeInTheDocument())
  })

  // @story: SCRUM-44
  // @ac: 6
  it('lets the user dismiss the outcome', async () => {
    const user = userEvent.setup()
    mockList()
    api.reassignRequest.mockResolvedValue({ ...PLANNING, assigned_coordinator: 'coord2' })
    renderPage()

    await user.selectOptions(await screen.findByTestId('assignments-reassign-input-7'), 'coord2')
    await user.click(screen.getByTestId('assignments-reassign-button-7'))
    await user.click(await screen.findByRole('button', { name: 'Dismiss message' }))

    expect(screen.queryByTestId('assignments-banner')).not.toBeInTheDocument()
  })
})
