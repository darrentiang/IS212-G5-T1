import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import VenueDetailPage from '../VenueDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

// @story: SCRUM-61
// @ac: 3, 6
// Venue Staff see the API's flags on the venue's booking requests.

const VENUE = { id: 3, name: 'Venue A', location: 'Block A', max_capacity: 50, opening_time: '08:00',
  closing_time: '22:00', setup_time: 0, turnaround_time: 0, facilities: [], accessibility_features: [], layouts: [] }
const booking = (id, fields) => ({ id, event_request_id: 61, event_request_name: 'SCRUM-61 event',
  status: 'Requested', date: '2026-11-15', start_time: '10:00', end_time: '12:00',
  occupied_start: '2026-11-15T10:00', occupied_end: '2026-11-15T12:00', attendance: 60, layout: null,
  facilities: [], raised_by: 'coord1', assigned_coordinator: 'coord1', too_small: false,
  timing_mismatch: false, ...fields })

beforeEach(() => {
  vi.mocked(auth.useAuth).mockReturnValue({ can: (key) => ['venues.view'].includes(key), account: { username: 'venue1' } })
  api.getVenue.mockResolvedValue(VENUE)
  api.listVenueBlocks.mockResolvedValue([])
  api.listVenueClashes.mockResolvedValue([])
  api.getVenueOptions.mockResolvedValue({ facilities: [], accessibility_features: [], layouts: [] })
})

describe('SCRUM-61 flags on the venue page', () => {
  it('shows Too small and Timing mismatch beside the booking request status', async () => {
    api.listVenueBookings.mockResolvedValue([
      booking(1, { too_small: true }),
      booking(2, { status: 'Approved', timing_mismatch: true }),
      booking(3, {}),
    ])
    render(<MemoryRouter initialEntries={['/venues/3']}><Routes>
      <Route path="/venues/:id" element={<VenueDetailPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByTestId('venue-detail-booking-too-small-1')).toHaveTextContent('Too small')
    expect(screen.getByTestId('venue-detail-booking-status-1')).toHaveTextContent(/^Requested$/)
    expect(screen.getByTestId('venue-detail-booking-timing-mismatch-2')).toHaveTextContent('Timing mismatch')
    expect(screen.queryByTestId('venue-detail-booking-too-small-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-booking-timing-mismatch-3')).not.toBeInTheDocument()
  })
})
