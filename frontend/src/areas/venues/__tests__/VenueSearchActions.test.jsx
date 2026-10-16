import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import VenueSearchPage from '../VenueSearchPage'

vi.mock('../api')
vi.mock('../../../app/auth')

// SCRUM-82 AC6: Request booking and Place hold on each venue search result,
// shown by the same rules as the request page's Venues section buttons.
const EVENT = {
  id: 5,
  name: 'Swap Gala',
  date: '2026-12-05',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  status: STATUS.REQUEST.PLANNING,
  assigned_coordinator: 'coord1',
}
const AUDITORIUM = { id: 2, name: 'Auditorium', location: 'Block C Level 1', max_capacity: 400 }

const COORDINATOR = ['venues.view', 'venues.search', 'bookings.edit']

function signInWith(features, username = 'coord1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

function renderPage(event = EVENT) {
  api.searchVenues.mockResolvedValue({ event, venues: [AUDITORIUM] })
  render(
    <MemoryRouter initialEntries={['/requests/5/venues/search']}>
      <Routes>
        <Route path="/requests/:id/venues/search" element={<VenueSearchPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  api.getVenueOptions.mockResolvedValue({ layouts: [], facilities: [], accessibility_features: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the venue search Action column', () => {
  // @story: SCRUM-82
  // @ac: 6
  it('offers the assigned coordinator both actions, each with the venue chosen', async () => {
    signInWith(COORDINATOR)
    renderPage()

    const request = await screen.findByTestId('venue-search-request-booking-button-2')
    expect(request).toHaveTextContent('Request booking')
    expect(request).toHaveAttribute('href', '/requests/5/bookings/new?venue=2')
    const hold = screen.getByTestId('venue-search-place-hold-button-2')
    expect(hold).toHaveTextContent('Place hold')
    expect(hold).toHaveAttribute('href', '/requests/5?hold=2')
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument()
  })

  // @story: SCRUM-82
  // @ac: 6
  it('offers another coordinator Request booking only, as the Venues section does', async () => {
    signInWith(COORDINATOR, 'coord2')
    renderPage()

    expect(await screen.findByTestId('venue-search-request-booking-button-2')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-place-hold-button-2')).not.toBeInTheDocument()
  })

  // @story: SCRUM-82
  // @ac: 6
  it('offers both to the assigned coordinator of an Approved event', async () => {
    signInWith(COORDINATOR)
    renderPage({ ...EVENT, status: STATUS.REQUEST.APPROVED })

    expect(await screen.findByTestId('venue-search-place-hold-button-2')).toBeInTheDocument()
  })

  // @story: SCRUM-82
  // @ac: 6
  it('offers nothing to an account without bookings.edit, and shows no Action column', async () => {
    signInWith(['venues.view', 'venues.search'])
    renderPage()

    expect(await screen.findByTestId('venue-search-row-2')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-request-booking-button-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-place-hold-button-2')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Action' })).not.toBeInTheDocument()
  })

  // @story: SCRUM-82
  // @ac: 6
  it('offers nothing for an event that is no longer Approved or Planning', async () => {
    signInWith(COORDINATOR)
    renderPage({ ...EVENT, status: STATUS.REQUEST.SAFETY_CHECK })

    expect(await screen.findByTestId('venue-search-row-2')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-request-booking-button-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-place-hold-button-2')).not.toBeInTheDocument()
  })
})
