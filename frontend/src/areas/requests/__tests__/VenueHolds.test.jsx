import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

afterEach(() => {
  vi.restoreAllMocks()
})

// SCRUM-84: the request page's Venue holds section and Place hold form.
const EVENT = {
  id: 7,
  name: 'Hold Seminar',
  purpose: 'Seminar',
  description: 'A seminar',
  date: '2026-12-05',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'None',
  registration_needs: 'None',
  status: STATUS.REQUEST.PLANNING,
  created_by: 'org1',
  layout: null,
  facilities: [],
  accessibility_features: [],
  registration_enabled: false,
  submitted_at: '2026-09-20T09:00:00',
  decision: null,
  decision_reason: null,
  decided_at: null,
  decided_by: null,
  assigned_coordinator: 'coord1',
  assigned_at: '2026-09-21T09:00:00',
  safety_check_at: null,
  safety_decisions: [],
  requested_changes: null,
}

const HOLD = {
  id: 3,
  venue_id: 1,
  venue_name: 'Seminar Room 1',
  event_request_id: 7,
  event_request_name: 'Hold Seminar',
  status: STATUS.HOLD.HELD,
  date: '2026-12-05',
  start_time: '10:00',
  end_time: '12:00',
  occupied_start: '2026-12-05T09:30',
  occupied_end: '2026-12-05T12:30',
  expires_at: '2026-12-04T17:00',
  placed_by: 'coord1',
  placed_at: '2026-12-01T01:00:00',
  released_at: null,
}

const VENUES = [
  { id: 1, name: 'Seminar Room 1', is_active: true },
  { id: 2, name: 'Old Hall', is_active: false },
]

const COORDINATOR = ['requests.view', 'requests.decide', 'venues.view', 'venues.search', 'bookings.edit']

function signInWith(features, username = 'coord1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/7']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openForm(user) {
  api.listVenues.mockResolvedValue(VENUES)
  await user.click(await screen.findByTestId('request-detail-place-hold-button'))
  return screen.findByTestId('request-detail-hold-form')
}

async function fillForm(user, { venue = '1', date = '2026-12-04', time = '17:00' } = {}) {
  if (venue) await user.selectOptions(screen.getByTestId('request-detail-hold-venue-input'), venue)
  if (date) await user.type(screen.getByTestId('request-detail-hold-expiry-date-input'), date)
  if (time) await user.type(screen.getByTestId('request-detail-hold-expiry-time-input'), time)
}

describe('the Venue holds section', () => {
  // @story: SCRUM-84
  // @ac: 1
  it('lists each hold with its venue, occupied period, expiry and status', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([HOLD])
    renderDetail()

    expect(await screen.findByTestId('request-detail-hold-venue-3')).toHaveTextContent('Seminar Room 1')
    expect(screen.getByTestId('request-detail-hold-period-3')).toHaveTextContent('05 Dec 2026, 09:30–12:30')
    expect(screen.getByTestId('request-detail-hold-expiry-3')).toHaveTextContent('04 Dec 2026, 17:00')
    expect(screen.getByTestId('request-detail-hold-status-3')).toHaveTextContent(STATUS.HOLD.HELD)
    expect(screen.getByTestId('request-detail-hold-release-button-3')).toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 1
  it('shows both ends in full when the occupied period crosses midnight', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([
      { ...HOLD, occupied_start: '2026-12-05T23:30', occupied_end: '2026-12-06T01:00' },
    ])
    renderDetail()

    expect(await screen.findByTestId('request-detail-hold-period-3')).toHaveTextContent(
      '05 Dec 2026, 23:30 to 06 Dec 2026, 01:00',
    )
  })

  // @story: SCRUM-84
  // @ac: 1
  it('says when the event holds no venue', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([])
    renderDetail()

    expect(await screen.findByTestId('request-detail-holds-empty')).toHaveTextContent('This event holds no venue.')
  })

  // @story: SCRUM-84
  // @ac: 1
  it('is not shown, and not read, without venues.view', async () => {
    signInWith(['requests.view', 'requests.edit'], 'org1')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    await screen.findByTestId('request-detail-status')
    expect(screen.queryByTestId('request-detail-holds')).not.toBeInTheDocument()
    expect(api.listHolds).not.toHaveBeenCalled()
  })

  // @story: SCRUM-84
  // @ac: 1
  it('shows the API message when the holds cannot be read', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockRejectedValue(new Error('Event request not found.'))
    renderDetail()

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Event request not found.')
    expect(screen.queryByTestId('request-detail-holds')).not.toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 1, 7
  it('offers Place hold and Release only to the assigned coordinator', async () => {
    signInWith(COORDINATOR, 'coord2')
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([HOLD])
    renderDetail()

    await screen.findByTestId('request-detail-hold-row-3')
    expect(screen.queryByTestId('request-detail-place-hold-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-hold-release-button-3')).not.toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 1
  it.each([STATUS.REQUEST.SUBMITTED, STATUS.REQUEST.SAFETY_CHECK, STATUS.REQUEST.CONFIRMED])(
    'does not offer Place hold for an event that is %s',
    async (status) => {
      signInWith(COORDINATOR)
      api.getRequest.mockResolvedValue({ ...EVENT, status })
      api.listHolds.mockResolvedValue([])
      renderDetail()

      await screen.findByTestId('request-detail-holds')
      expect(screen.queryByTestId('request-detail-place-hold-button')).not.toBeInTheDocument()
    },
  )

  // @story: SCRUM-84
  // @ac: 7
  it('offers no Release on a hold that is already Released', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([{ ...HOLD, status: STATUS.HOLD.RELEASED }])
    renderDetail()

    expect(await screen.findByTestId('request-detail-hold-status-3')).toHaveTextContent(STATUS.HOLD.RELEASED)
    expect(screen.queryByTestId('request-detail-hold-release-button-3')).not.toBeInTheDocument()
  })
})

describe('placing a hold', () => {
  // @story: SCRUM-84
  // @ac: 1, 8
  it('sends the venue and expiry entered, lists the new hold and shows the event now in Planning', async () => {
    signInWith(COORDINATOR)
    api.getRequest
      .mockResolvedValueOnce({ ...EVENT, status: STATUS.REQUEST.APPROVED })
      .mockResolvedValueOnce(EVENT)
    api.listHolds.mockResolvedValue([])
    api.placeHold.mockResolvedValue(HOLD)
    renderDetail()
    const user = userEvent.setup()

    const form = await openForm(user)
    // A retired venue cannot be held for long; only active venues are offered.
    expect(within(form).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Select a venue',
      'Seminar Room 1',
    ])
    await fillForm(user)
    await user.click(screen.getByTestId('request-detail-hold-confirm-button'))

    expect(api.placeHold).toHaveBeenCalledWith('7', { venue_id: 1, expiry_date: '2026-12-04', expiry_time: '17:00' })
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Hold placed')
    expect(screen.getByTestId('request-detail-hold-status-3')).toHaveTextContent(STATUS.HOLD.HELD)
    await waitFor(() => expect(screen.getByTestId('request-detail-status')).toHaveTextContent(STATUS.REQUEST.PLANNING))
    expect(screen.queryByTestId('request-detail-hold-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 1
  it('names each empty field and sends nothing', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([])
    renderDetail()
    const user = userEvent.setup()

    await openForm(user)
    await user.click(screen.getByTestId('request-detail-hold-confirm-button'))

    expect(screen.getByTestId('request-detail-hold-venue-error')).toHaveTextContent('Choose a venue.')
    expect(screen.getByTestId('request-detail-hold-expiry-date-error')).toHaveTextContent('Expiry date is required.')
    expect(screen.getByTestId('request-detail-hold-expiry-time-error')).toHaveTextContent('Expiry time is required.')
    expect(api.placeHold).not.toHaveBeenCalled()
  })

  // @story: SCRUM-84
  // @ac: 2, 3
  it('shows a refusal word for word and keeps the form open with its entries', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([])
    api.placeHold.mockRejectedValue(new Error('The expiry must be in the future.'))
    renderDetail()
    const user = userEvent.setup()

    await openForm(user)
    await fillForm(user)
    await user.click(screen.getByTestId('request-detail-hold-confirm-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('The expiry must be in the future.')
    expect(screen.getByTestId('request-detail-hold-venue-input')).toHaveValue('1')
    expect(screen.getByTestId('request-detail-hold-expiry-date-input')).toHaveValue('2026-12-04')
    expect(screen.getByTestId('request-detail-holds-empty')).toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 1
  it('keeps the placed hold when the request cannot be read again afterwards', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValueOnce(EVENT).mockRejectedValueOnce(new Error('Server unavailable.'))
    api.listHolds.mockResolvedValue([])
    api.placeHold.mockResolvedValue(HOLD)
    renderDetail()
    const user = userEvent.setup()

    await openForm(user)
    await fillForm(user)
    await user.click(screen.getByTestId('request-detail-hold-confirm-button'))

    expect(await screen.findByTestId('request-detail-hold-row-3')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Server unavailable.'))
  })

  // @story: SCRUM-84
  // @ac: 1
  it('shows the API message when the venues cannot be read', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([])
    api.listVenues.mockRejectedValue(new Error('You do not have permission to perform this action.'))
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-place-hold-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent(
      'You do not have permission to perform this action.',
    )
    expect(screen.queryByTestId('request-detail-hold-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 1
  it('closes the form on Cancel without sending anything', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([])
    renderDetail()
    const user = userEvent.setup()

    await openForm(user)
    await user.click(screen.getByTestId('request-detail-hold-cancel-button'))

    expect(screen.queryByTestId('request-detail-hold-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-place-hold-button')).toBeInTheDocument()
    expect(api.placeHold).not.toHaveBeenCalled()
  })
})

describe('releasing a hold', () => {
  // @story: SCRUM-84
  // @ac: 7
  it('shows the hold as Released and says so', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValue([HOLD])
    api.releaseHold.mockResolvedValue({ ...HOLD, status: STATUS.HOLD.RELEASED })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-hold-release-button-3'))

    expect(api.releaseHold).toHaveBeenCalledWith('7', 3)
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Hold released')
    expect(screen.getByTestId('request-detail-hold-status-3')).toHaveTextContent(STATUS.HOLD.RELEASED)
    expect(screen.queryByTestId('request-detail-hold-release-button-3')).not.toBeInTheDocument()
  })

  // @story: SCRUM-84
  // @ac: 7
  it('changes only the released hold when the event has several', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    const other = { ...HOLD, id: 4, venue_id: 2, venue_name: 'Auditorium' }
    api.listHolds.mockResolvedValue([HOLD, other])
    api.releaseHold.mockResolvedValue({ ...HOLD, status: STATUS.HOLD.RELEASED })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-hold-release-button-3'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Hold released')
    expect(screen.getByTestId('request-detail-hold-status-3')).toHaveTextContent(STATUS.HOLD.RELEASED)
    expect(screen.getByTestId('request-detail-hold-status-4')).toHaveTextContent(STATUS.HOLD.HELD)
  })

  // @story: SCRUM-84
  // @ac: 7
  it('shows a refusal and the holds as they now stand', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds
      .mockResolvedValueOnce([HOLD])
      .mockResolvedValueOnce([{ ...HOLD, status: STATUS.HOLD.RELEASED }])
    api.releaseHold.mockRejectedValue(new Error('This hold is already Released.'))
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-hold-release-button-3'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('This hold is already Released.')
    await waitFor(() =>
      expect(screen.getByTestId('request-detail-hold-status-3')).toHaveTextContent(STATUS.HOLD.RELEASED),
    )
  })

  // @story: SCRUM-84
  // @ac: 7
  it('shows the reload error when the holds cannot be read after a refusal', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listHolds.mockResolvedValueOnce([HOLD]).mockRejectedValueOnce(new Error('Server unavailable.'))
    api.releaseHold.mockRejectedValue(new Error('This hold is already Released.'))
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-hold-release-button-3'))

    await waitFor(() => expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Server unavailable.'))
  })
})

describe('moving to another request', () => {
  function renderRouter() {
    const router = createMemoryRouter([{ path: '/requests/:id', element: <RequestDetailPage /> }], {
      initialEntries: ['/requests/7'],
    })
    render(<RouterProvider router={router} />)
    return router
  }

  // @story: SCRUM-84
  // @ac: 1
  it('keeps the holds of the request the user moved to when the earlier reply arrives last', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockImplementation((id) => Promise.resolve({ ...EVENT, id: Number(id) }))
    let resolveFirst
    api.listHolds
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce([{ ...HOLD, id: 5, venue_name: 'Auditorium' }])
    const router = renderRouter()
    await waitFor(() => expect(api.listHolds).toHaveBeenCalledWith('7'))

    await act(() => router.navigate('/requests/8'))
    expect(await screen.findByTestId('request-detail-hold-venue-5')).toHaveTextContent('Auditorium')
    await act(async () => resolveFirst([HOLD]))

    expect(screen.queryByTestId('request-detail-hold-row-3')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-hold-venue-5')).toHaveTextContent('Auditorium')
  })

  // @story: SCRUM-84
  // @ac: 1
  it('ignores a refusal for the request the user has left', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockImplementation((id) => Promise.resolve({ ...EVENT, id: Number(id) }))
    let rejectFirst
    api.listHolds
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce([])
    const router = renderRouter()
    await waitFor(() => expect(api.listHolds).toHaveBeenCalledWith('7'))

    await act(() => router.navigate('/requests/8'))
    expect(await screen.findByTestId('request-detail-holds-empty')).toBeInTheDocument()
    await act(async () => rejectFirst(new Error('Event request not found.')))

    expect(screen.queryByTestId('request-detail-banner')).not.toBeInTheDocument()
  })
})
