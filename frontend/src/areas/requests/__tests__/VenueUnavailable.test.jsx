import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

// SCRUM-82: the Venue unavailable marker on the request page's Venue bookings,
// and the Place hold form opened from venue search with its venue chosen.
const EVENT = {
  id: 7,
  name: 'Swap Gala',
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

const booking = (id, venueName, fields = {}) => ({
  id,
  venue_id: id,
  venue_name: venueName,
  event_request_id: 7,
  status: STATUS.BOOKING.APPROVED,
  date: '2026-12-05',
  start_time: '10:00',
  end_time: '12:00',
  occupied_start: '2026-12-05T10:00',
  occupied_end: '2026-12-05T12:00',
  raised_by: 'coord1',
  cancel_reason: null,
  venue_unavailable: false,
  ...fields,
})

const VENUES = [
  { id: 1, name: 'Seminar Room 1', is_active: true },
  { id: 2, name: 'Auditorium', is_active: true },
  { id: 3, name: 'Old Hall', is_active: false },
]

const COORDINATOR = ['requests.view', 'requests.decide', 'venues.view', 'venues.search', 'bookings.edit']

function signInWith(features, username = 'coord1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

function renderDetail(path = '/requests/7') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.getRequest.mockResolvedValue(EVENT)
  api.listHolds.mockResolvedValue([])
  api.listBookings.mockResolvedValue([])
  api.listVenues.mockResolvedValue(VENUES)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Venue unavailable marker', () => {
  // @story: SCRUM-82
  // @ac: 4
  it('shows beside a marked Approved booking and not beside an unmarked one', async () => {
    signInWith(COORDINATOR)
    api.listBookings.mockResolvedValue([
      booking(1, 'Seminar Room 1', { venue_unavailable: true }),
      booking(2, 'Auditorium'),
    ])
    renderDetail()

    const marker = await screen.findByTestId('request-detail-booking-unavailable-1')
    expect(marker).toHaveTextContent('Venue unavailable')
    expect(marker).toHaveClass('badge-danger')
    expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Approved')
    expect(screen.getByTestId('request-detail-booking-status-2')).toHaveTextContent('Approved')
    expect(screen.queryByTestId('request-detail-booking-unavailable-2')).not.toBeInTheDocument()
  })
})

describe('Place hold opened from venue search', () => {
  // @story: SCRUM-82
  // @ac: 6
  it('opens the form with the venue in the address already chosen', async () => {
    signInWith(COORDINATOR)
    renderDetail('/requests/7?hold=2')

    expect(await screen.findByTestId('request-detail-hold-form')).toBeInTheDocument()
    expect(screen.getByTestId('request-detail-hold-venue-input')).toHaveValue('2')
    expect(screen.getByTestId('request-detail-hold-venue-input')).toHaveFocus()
    expect(api.listVenues).toHaveBeenCalledTimes(1)
  })

  // @story: SCRUM-82
  // @ac: 6
  it('places the hold for the chosen venue', async () => {
    const user = userEvent.setup()
    signInWith(COORDINATOR)
    api.placeHold.mockResolvedValue({
      id: 9,
      venue_id: 2,
      venue_name: 'Auditorium',
      status: STATUS.HOLD.HELD,
      occupied_start: '2026-12-05T10:00',
      occupied_end: '2026-12-05T12:00',
      expires_at: '2026-12-01T17:00',
    })
    renderDetail('/requests/7?hold=2')
    await screen.findByTestId('request-detail-hold-form')

    await user.type(screen.getByTestId('request-detail-hold-expiry-date-input'), '2026-12-01')
    await user.type(screen.getByTestId('request-detail-hold-expiry-time-input'), '17:00')
    await user.click(screen.getByTestId('request-detail-hold-confirm-button'))

    await waitFor(() => {
      expect(api.placeHold).toHaveBeenCalledWith('7', {
        venue_id: 2,
        expiry_date: '2026-12-01',
        expiry_time: '17:00',
      })
    })
    expect(await screen.findByTestId('request-detail-hold-status-9')).toHaveTextContent('Held')
  })

  // @story: SCRUM-82
  // @ac: 6
  it.each([
    ['an unknown venue', '99'],
    ['a retired venue', '3'],
  ])('ignores %s in the address and opens the page normally', async (_label, venueId) => {
    signInWith(COORDINATOR)
    renderDetail(`/requests/7?hold=${venueId}`)

    await waitFor(() => expect(api.listVenues).toHaveBeenCalledTimes(1))
    expect(await screen.findByTestId('request-detail-place-hold-button')).toBeEnabled()
    expect(screen.queryByTestId('request-detail-hold-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-82
  // @ac: 6
  it('does not open the form for a coordinator who is not assigned', async () => {
    signInWith(COORDINATOR, 'coord2')
    renderDetail('/requests/7?hold=2')

    expect(await screen.findByTestId('request-detail-raise-booking-button')).toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-hold-form')).not.toBeInTheDocument()
    expect(api.listVenues).not.toHaveBeenCalled()
  })

  // @story: SCRUM-82
  // @ac: 6
  it('opens the form only once, so Cancel closes it for good', async () => {
    const user = userEvent.setup()
    signInWith(COORDINATOR)
    renderDetail('/requests/7?hold=2')

    await screen.findByTestId('request-detail-hold-form')
    await user.click(screen.getByTestId('request-detail-hold-cancel-button'))

    expect(await screen.findByTestId('request-detail-place-hold-button')).toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-hold-form')).not.toBeInTheDocument()
    expect(api.listVenues).toHaveBeenCalledTimes(1)
  })

  // @story: SCRUM-82
  // @ac: 6
  it('Place hold pressed on the page still opens the form with no venue chosen', async () => {
    const user = userEvent.setup()
    signInWith(COORDINATOR)
    renderDetail()

    await user.click(await screen.findByTestId('request-detail-place-hold-button'))

    expect(await screen.findByTestId('request-detail-hold-venue-input')).toHaveValue('')
  })
})
