import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

beforeEach(() => {
  api.listHolds.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

// SCRUM-83: the request page's Venues section, its booking list, Cancel booking and Withdraw.
const EVENT = {
  id: 7,
  name: 'Multi Venue Gala',
  purpose: 'Gala',
  description: 'A gala',
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

function booking(id, venueName, status, extra = {}) {
  return {
    id,
    venue_id: id * 10,
    venue_name: venueName,
    event_request_id: 7,
    status,
    occupied_start: '2026-12-05T10:00',
    occupied_end: '2026-12-05T12:00',
    raised_by: 'coord1',
    cancel_reason: null,
    ...extra,
  }
}

const SEMINAR = booking(1, 'Seminar Room 1', STATUS.BOOKING.APPROVED, {
  occupied_start: '2026-12-05T09:30',
  occupied_end: '2026-12-05T12:30',
})
const AUDITORIUM = booking(2, 'Auditorium', STATUS.BOOKING.REQUESTED)
const REJECTED = booking(3, 'Auditorium', STATUS.BOOKING.REJECTED)

const COORDINATOR = ['requests.view', 'requests.decide', 'venues.view', 'venues.search', 'bookings.edit']

function signInWith(features, username = 'coord1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

function renderDetail(event = EVENT, bookings = [SEMINAR, AUDITORIUM, REJECTED], features = COORDINATOR, username = 'coord1') {
  signInWith(features, username)
  api.getRequest.mockResolvedValue(event)
  api.listBookings.mockResolvedValue(bookings)
  render(
    <MemoryRouter initialEntries={['/requests/7']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openCancel(user, id = 1) {
  await user.click(await screen.findByTestId(`request-detail-booking-cancel-button-${id}`))
  return screen.findByTestId('request-detail-booking-cancel-form')
}

describe('the Venues section', () => {
  // @story: SCRUM-83
  // @ac: 1
  it('groups Search venues, Place hold and Request venue booking at its top, above the bookings and holds', async () => {
    renderDetail()

    const venues = await screen.findByTestId('request-detail-venues')
    expect(await within(venues).findByTestId('request-detail-bookings')).toBeInTheDocument()
    expect(await within(venues).findByTestId('request-detail-holds')).toBeInTheDocument()
    expect(within(venues).getByRole('heading', { level: 2 })).toHaveTextContent('Venues')
    for (const testId of [
      'request-detail-search-venues-button',
      'request-detail-place-hold-button',
      'request-detail-raise-booking-button',
    ]) {
      expect(within(venues).getByTestId(testId)).toBeInTheDocument()
    }
  })

  // @story: SCRUM-83
  // @ac: 1
  it('lists every booking request with its venue, occupied period and status', async () => {
    renderDetail()

    expect(await screen.findByTestId('request-detail-booking-venue-1')).toHaveTextContent('Seminar Room 1')
    expect(screen.getByTestId('request-detail-booking-period-1')).toHaveTextContent('05 Dec 2026, 09:30–12:30')
    expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Approved')
    expect(screen.getByTestId('request-detail-booking-venue-2')).toHaveTextContent('Auditorium')
    expect(screen.getByTestId('request-detail-booking-period-2')).toHaveTextContent('05 Dec 2026, 10:00–12:00')
    expect(screen.getByTestId('request-detail-booking-status-2')).toHaveTextContent('Requested')
    expect(screen.getByTestId('request-detail-booking-status-3')).toHaveTextContent('Rejected')
    expect(api.listBookings).toHaveBeenCalledWith('7')
  })

  // @story: SCRUM-83
  // @ac: 3
  it('shows a Cancelled booking with its reason and a Danger badge', async () => {
    renderDetail(EVENT, [{ ...SEMINAR, status: STATUS.BOOKING.CANCELLED, cancel_reason: 'Room too small' }])

    const status = await screen.findByTestId('request-detail-booking-status-1')
    expect(status).toHaveTextContent('Cancelled')
    expect(status).toHaveClass('badge-danger')
    expect(screen.getByTestId('request-detail-booking-cancel-reason-1')).toHaveTextContent('Room too small')
    expect(screen.queryByTestId('request-detail-booking-cancel-button-1')).not.toBeInTheDocument()
  })

  // @story: SCRUM-83
  // @ac: 1
  it('says when no booking has been requested', async () => {
    renderDetail(EVENT, [])

    expect(await screen.findByTestId('request-detail-bookings-empty')).toHaveTextContent(
      'No venue booking has been requested for this event.',
    )
  })

  // @story: SCRUM-83
  // @ac: 1
  it('does not read or list the bookings without venues.view', async () => {
    renderDetail(EVENT, [], ['requests.view', 'requests.edit'], 'org1')

    await screen.findByTestId('request-detail-status')
    expect(screen.queryByTestId('request-detail-venues')).not.toBeInTheDocument()
    expect(api.listBookings).not.toHaveBeenCalled()
  })

  // @story: SCRUM-83
  // @ac: 1
  it('shows the API message when the bookings cannot be read', async () => {
    signInWith(COORDINATOR)
    api.getRequest.mockResolvedValue(EVENT)
    api.listBookings.mockRejectedValue(new Error('Event request not found.'))
    render(
      <MemoryRouter initialEntries={['/requests/7']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Event request not found.')
    expect(screen.queryByTestId('request-detail-bookings')).not.toBeInTheDocument()
  })
})

describe('the actions on a booking row', () => {
  // @story: SCRUM-83
  // @ac: 1, 3, 4
  it('offers Cancel booking only on the Approved row and Withdraw only on the Requested row', async () => {
    renderDetail()

    await screen.findByTestId('request-detail-booking-row-1')
    expect(screen.getByTestId('request-detail-booking-cancel-button-1')).toHaveTextContent('Cancel booking')
    expect(screen.queryByTestId('request-detail-booking-withdraw-button-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-booking-withdraw-button-2')).toHaveTextContent('Withdraw')
    expect(screen.queryByTestId('request-detail-booking-cancel-button-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-booking-cancel-button-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-booking-withdraw-button-3')).not.toBeInTheDocument()
  })

  // @story: SCRUM-83
  // @ac: 3
  it('offers Cancel booking on an Approved event too', async () => {
    renderDetail({ ...EVENT, status: STATUS.REQUEST.APPROVED })

    expect(await screen.findByTestId('request-detail-booking-cancel-button-1')).toBeInTheDocument()
  })

  // @story: SCRUM-83
  // @ac: 4
  it.each([STATUS.REQUEST.SAFETY_CHECK, STATUS.REQUEST.CONFIRMED, STATUS.REQUEST.COMPLETED])(
    'offers no Cancel booking while the event is %s',
    async (status) => {
      renderDetail({ ...EVENT, status })

      await screen.findByTestId('request-detail-booking-row-1')
      expect(screen.queryByTestId('request-detail-booking-cancel-button-1')).not.toBeInTheDocument()
    },
  )

  // @story: SCRUM-83
  // @ac: 3
  it('offers Cancel booking to nobody but the assigned coordinator, and Withdraw to nobody but the raiser', async () => {
    renderDetail(EVENT, [SEMINAR, AUDITORIUM], COORDINATOR, 'coord2')

    await screen.findByTestId('request-detail-booking-row-1')
    expect(screen.queryByTestId('request-detail-booking-cancel-button-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-booking-withdraw-button-2')).not.toBeInTheDocument()
  })

  // @story: SCRUM-83
  // @ac: 1
  it('has no action column for an account without bookings.edit', async () => {
    renderDetail(EVENT, [SEMINAR], ['requests.view', 'venues.view'], 'venue1')

    const row = await screen.findByTestId('request-detail-booking-row-1')
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
    expect(within(screen.getByTestId('request-detail-bookings')).queryByText('Action')).not.toBeInTheDocument()
  })
})

describe('Cancel booking', () => {
  // @story: SCRUM-83
  // @ac: 3
  it('opens its form in the row below the booking, with the Reason focused', async () => {
    const user = userEvent.setup()
    renderDetail()

    const form = await openCancel(user)

    const row = screen.getByTestId('request-detail-booking-row-1')
    expect(row.nextElementSibling).toContainElement(form)
    expect(screen.getByTestId('request-detail-booking-cancel-reason-input')).toHaveFocus()
    expect(screen.queryByTestId('request-detail-booking-cancel-button-1')).not.toBeInTheDocument()
    expect(within(form).getByTestId('request-detail-booking-cancel-confirm-button')).toHaveTextContent('Confirm cancel')
  })

  // @story: SCRUM-83
  // @ac: 3
  it('closes the form with Cancel, sending nothing', async () => {
    const user = userEvent.setup()
    renderDetail()
    await openCancel(user)

    await user.click(screen.getByTestId('request-detail-booking-cancel-cancel-button'))

    expect(screen.queryByTestId('request-detail-booking-cancel-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-booking-cancel-button-1')).toBeInTheDocument()
    expect(api.cancelBooking).not.toHaveBeenCalled()
  })

  // @story: SCRUM-83
  // @ac: 4
  it.each(['', '   '])('refuses a blank reason in the form and sends nothing (%j)', async (typed) => {
    const user = userEvent.setup()
    renderDetail()
    await openCancel(user)
    if (typed) await user.type(screen.getByTestId('request-detail-booking-cancel-reason-input'), typed)

    await user.click(screen.getByTestId('request-detail-booking-cancel-confirm-button'))

    expect(screen.getByTestId('request-detail-booking-cancel-reason-error')).toHaveTextContent('Reason is required.')
    expect(api.cancelBooking).not.toHaveBeenCalled()
    expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Approved')
  })

  // @story: SCRUM-83
  // @ac: 3, 5
  it('cancels the booking, reads the bookings again and says so', async () => {
    const user = userEvent.setup()
    renderDetail(EVENT, [SEMINAR, AUDITORIUM])
    const cancelled = { ...SEMINAR, status: STATUS.BOOKING.CANCELLED, cancel_reason: 'Room too small' }
    api.cancelBooking.mockResolvedValue(cancelled)
    await openCancel(user)
    api.listBookings.mockResolvedValue([cancelled, AUDITORIUM])

    await user.type(screen.getByTestId('request-detail-booking-cancel-reason-input'), 'Room too small')
    await user.click(screen.getByTestId('request-detail-booking-cancel-confirm-button'))

    expect(api.cancelBooking).toHaveBeenCalledWith(10, 1, 'Room too small')
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Booking cancelled')
    await waitFor(() =>
      expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Cancelled'),
    )
    expect(screen.getByTestId('request-detail-booking-cancel-reason-1')).toHaveTextContent('Room too small')
    expect(screen.getByTestId('request-detail-booking-status-2')).toHaveTextContent('Requested')
    expect(screen.queryByTestId('request-detail-booking-cancel-form')).not.toBeInTheDocument()
    expect(api.listBookings).toHaveBeenCalledTimes(2)
  })

  // @story: SCRUM-83
  // @ac: 4
  it('shows a refusal in the banner word for word and keeps the form open with its reason', async () => {
    const user = userEvent.setup()
    renderDetail()
    api.cancelBooking.mockRejectedValue(
      new Error('A booking can be cancelled only while the event is Approved or Planning.'),
    )
    await openCancel(user)

    await user.type(screen.getByTestId('request-detail-booking-cancel-reason-input'), 'Room too small')
    await user.click(screen.getByTestId('request-detail-booking-cancel-confirm-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent(
      'A booking can be cancelled only while the event is Approved or Planning.',
    )
    expect(screen.getByTestId('request-detail-booking-cancel-reason-input')).toHaveValue('Room too small')
    expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Approved')
  })

  // @story: SCRUM-83
  // @ac: 3
  it('shows the message when the bookings cannot be read again after a cancel', async () => {
    const user = userEvent.setup()
    renderDetail()
    api.cancelBooking.mockResolvedValue({ ...SEMINAR, status: STATUS.BOOKING.CANCELLED })
    await openCancel(user)
    api.listBookings.mockRejectedValue(new Error('Could not reach the server.'))

    await user.type(screen.getByTestId('request-detail-booking-cancel-reason-input'), 'Room too small')
    await user.click(screen.getByTestId('request-detail-booking-cancel-confirm-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Could not reach the server.')
  })
})

describe('Withdraw on the request page (SCRUM-77)', () => {
  // @story: SCRUM-83
  // @ac: 4
  it('withdraws a Requested booking at once and says so', async () => {
    const user = userEvent.setup()
    renderDetail()
    api.withdrawBooking.mockResolvedValue({ ...AUDITORIUM, status: STATUS.BOOKING.WITHDRAWN })

    await user.click(await screen.findByTestId('request-detail-booking-withdraw-button-2'))

    expect(api.withdrawBooking).toHaveBeenCalledWith(20, 2)
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Booking withdrawn')
    expect(screen.getByTestId('request-detail-booking-status-2')).toHaveTextContent('Withdrawn')
    expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Approved')
  })

  // @story: SCRUM-83
  // @ac: 4
  it('shows a refusal and reads the bookings again', async () => {
    const user = userEvent.setup()
    renderDetail()
    api.withdrawBooking.mockRejectedValue(new Error('This booking request has already been decided (Approved).'))

    await user.click(await screen.findByTestId('request-detail-booking-withdraw-button-2'))
    api.listBookings.mockResolvedValue([SEMINAR, { ...AUDITORIUM, status: STATUS.BOOKING.APPROVED }])

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent(
      'This booking request has already been decided (Approved).',
    )
    expect(api.listBookings).toHaveBeenCalledTimes(2)
  })

  // @story: SCRUM-83
  // @ac: 4
  it('shows the message when the bookings cannot be read again after a refusal', async () => {
    const user = userEvent.setup()
    renderDetail()
    api.withdrawBooking.mockRejectedValue(new Error('Refused.'))
    api.listBookings.mockResolvedValueOnce([SEMINAR, AUDITORIUM]).mockRejectedValueOnce(new Error('Could not reach the server.'))

    await user.click(await screen.findByTestId('request-detail-booking-withdraw-button-2'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Could not reach the server.')
  })
})

describe('moving to another request', () => {
  function renderRouter() {
    signInWith(COORDINATOR)
    api.getRequest.mockImplementation((id) => Promise.resolve({ ...EVENT, id: Number(id) }))
    const router = createMemoryRouter([{ path: '/requests/:id', element: <RequestDetailPage /> }], {
      initialEntries: ['/requests/7'],
    })
    render(<RouterProvider router={router} />)
    return router
  }

  // @story: SCRUM-83
  // @ac: 1
  it('keeps the bookings of the request the user moved to when the earlier reply arrives last', async () => {
    let resolveFirst
    api.listBookings
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce([AUDITORIUM])
    const router = renderRouter()
    await waitFor(() => expect(api.listBookings).toHaveBeenCalledWith('7'))

    await act(() => router.navigate('/requests/8'))
    expect(await screen.findByTestId('request-detail-booking-row-2')).toBeInTheDocument()
    await act(async () => resolveFirst([SEMINAR]))

    expect(screen.queryByTestId('request-detail-booking-row-1')).not.toBeInTheDocument()
  })

  // @story: SCRUM-83
  // @ac: 1
  it('ignores a refusal for the request the user has left', async () => {
    let rejectFirst
    api.listBookings
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce([])
    const router = renderRouter()
    await waitFor(() => expect(api.listBookings).toHaveBeenCalledWith('7'))

    await act(() => router.navigate('/requests/8'))
    expect(await screen.findByTestId('request-detail-bookings-empty')).toBeInTheDocument()
    await act(async () => rejectFirst(new Error('Event request not found.')))

    expect(screen.queryByTestId('request-detail-banner')).not.toBeInTheDocument()
  })
})
