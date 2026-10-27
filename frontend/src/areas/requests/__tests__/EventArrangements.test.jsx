import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import ArrangementsSection from '../ArrangementsSection'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

afterEach(() => {
  vi.restoreAllMocks()
})

// SCRUM-46: the Event Organiser sees their event's status and, once it is
// Confirmed, its Approved arrangements.
const EVENT = {
  id: 9,
  name: 'Arranged Gala',
  purpose: 'Client gala',
  description: 'Gala dinner',
  date: '2027-03-12',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'None',
  registration_needs: 'None',
  status: STATUS.REQUEST.SUBMITTED,
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
  assigned_coordinator: null,
  assigned_by: null,
  assigned_at: null,
  safety_check_at: null,
}

const CONFIRMED_ARRANGEMENTS = {
  in_progress: false,
  venue_bookings: [
    { id: 4, venue: 'Seminar Room 1', location: 'Block A Level 2', date: '2027-03-12', start_time: '10:00', end_time: '12:00' },
    { id: 5, venue: 'Auditorium', location: 'Block C Level 1', date: '2027-03-12', start_time: '10:00', end_time: '12:00' },
  ],
  equipment: [{ id: 8, equipment_type: 'Projector', quantity: 2 }],
}

function signInAsOrganiser() {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => ['requests.view', 'notifications.view'].includes(feature),
    account: { username: 'org1' },
  })
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/9']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the arrangements section', () => {
  // @story: SCRUM-46
  // @ac: 2
  it('lists each Approved booking with its location and period, and each equipment requirement', () => {
    render(<ArrangementsSection arrangements={CONFIRMED_ARRANGEMENTS} />)

    expect(screen.getByTestId('request-detail-arrangement-booking-venue-4')).toHaveTextContent('Seminar Room 1')
    expect(screen.getByTestId('request-detail-arrangement-booking-location-4')).toHaveTextContent('Block A Level 2')
    expect(screen.getByTestId('request-detail-arrangement-booking-period-4')).toHaveTextContent('12 Mar 2027, 10:00–12:00')
    expect(screen.getByTestId('request-detail-arrangement-booking-venue-5')).toHaveTextContent('Auditorium')
    expect(screen.getByTestId('request-detail-arrangement-equipment-type-8')).toHaveTextContent('Projector')
    expect(screen.getByTestId('request-detail-arrangement-equipment-quantity-8')).toHaveTextContent('2')
    expect(screen.queryByTestId('request-detail-arrangements-in-progress')).not.toBeInTheDocument()
  })

  // @story: SCRUM-46
  // @ac: 2
  it('says so when nothing is Approved yet on a Confirmed event', () => {
    render(<ArrangementsSection arrangements={{ in_progress: false, venue_bookings: [], equipment: [] }} />)

    expect(screen.getByTestId('request-detail-arrangements-bookings-empty')).toHaveTextContent(
      'No venue booking is approved for this event.',
    )
    expect(screen.getByTestId('request-detail-arrangements-equipment-empty')).toHaveTextContent(
      'No equipment is approved for this event.',
    )
  })

  // @story: SCRUM-46
  // @ac: 3
  it('says the arrangements are in progress and lists nothing', () => {
    render(<ArrangementsSection arrangements={{ in_progress: true }} />)

    expect(screen.getByTestId('request-detail-arrangements-in-progress')).toHaveTextContent(
      'Arrangements are in progress.',
    )
    expect(screen.queryByTestId('request-detail-arrangement-booking-4')).not.toBeInTheDocument()
  })

  // @story: SCRUM-46
  // @ac: 4
  it.each([null, undefined])('renders nothing when the arrangements are %s', (arrangements) => {
    const { container } = render(<ArrangementsSection arrangements={arrangements} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('the request page for the Organiser', () => {
  // @story: SCRUM-46
  // @ac: 2
  it('shows the arrangements of a Confirmed event', async () => {
    signInAsOrganiser()
    api.getRequest.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.CONFIRMED, arrangements: CONFIRMED_ARRANGEMENTS })
    renderDetail()

    expect(await screen.findByTestId('request-detail-arrangements')).toBeInTheDocument()
    expect(screen.getByTestId('request-detail-arrangement-booking-venue-4')).toHaveTextContent('Seminar Room 1')
  })

  // @story: SCRUM-46
  // @ac: 3
  it('says the arrangements are in progress for a Planning event', async () => {
    signInAsOrganiser()
    api.getRequest.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.PLANNING, arrangements: { in_progress: true } })
    renderDetail()

    expect(await screen.findByTestId('request-detail-arrangements-in-progress')).toBeInTheDocument()
  })

  // @story: SCRUM-46
  // @ac: 4
  it('shows no arrangements for a Draft', async () => {
    signInAsOrganiser()
    api.getRequest.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.DRAFT, arrangements: null })
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-arrangements')).not.toBeInTheDocument()
  })

  // @story: SCRUM-46
  // @ac: 1
  it('says no coordinator is assigned yet on a submitted event', async () => {
    signInAsOrganiser()
    api.getRequest.mockResolvedValue({ ...EVENT, arrangements: { in_progress: true } })
    renderDetail()

    expect(await screen.findByTestId('request-detail-no-coordinator')).toHaveTextContent('No coordinator assigned yet.')
    expect(screen.queryByTestId('request-detail-assigned-coordinator')).not.toBeInTheDocument()
  })

  // @story: SCRUM-46
  // @ac: 1
  it('shows the assigned coordinator instead once there is one', async () => {
    signInAsOrganiser()
    api.getRequest.mockResolvedValue({
      ...EVENT,
      assigned_coordinator: 'coord1',
      assigned_by: 'lead1',
      assigned_at: '2026-09-21T09:00:00',
      arrangements: { in_progress: true },
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-assigned-coordinator')).toHaveTextContent('coord1')
    expect(screen.queryByTestId('request-detail-no-coordinator')).not.toBeInTheDocument()
  })

  // @story: SCRUM-46
  // @ac: 1
  it('does not say a Draft has no coordinator', async () => {
    signInAsOrganiser()
    api.getRequest.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.DRAFT, arrangements: null })
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-no-coordinator')).not.toBeInTheDocument()
  })
})
