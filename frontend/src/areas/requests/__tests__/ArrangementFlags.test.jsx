import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import VenueBookingsSection from '../VenueBookingsSection'
import VenueHoldsSection from '../VenueHoldsSection'
import SafetyCheckSection from '../SafetyCheckSection'

// @story: SCRUM-61
// @ac: 1, 3, 6
// The flags are the API's (derived at every read); the page only shows them.

const booking = (id, fields = {}) => ({
  id, venue_id: id, venue_name: `Venue ${id}`, event_request_id: 61, status: 'Approved',
  date: '2026-11-15', start_time: '10:00', end_time: '12:00',
  occupied_start: '2026-11-15T10:00', occupied_end: '2026-11-15T12:00',
  raised_by: 'coord1', cancel_reason: null, venue_unavailable: false,
  too_small: false, timing_mismatch: false, ...fields,
})

const hold = (id, fields = {}) => ({
  id, venue_id: id, venue_name: `Venue ${id}`, status: 'Held',
  occupied_start: '2026-11-15T10:00', occupied_end: '2026-11-15T12:00',
  expires_at: '2026-11-01T12:00', too_small: false, ...fields,
})

function bookings(rows) {
  render(<VenueBookingsSection bookings={rows} canCancel={() => false} canWithdraw={() => false}
    hasActions={false} cancellingId={null} reason="" reasonError={null} submitting={false}
    onOpenCancel={vi.fn()} onReasonChange={vi.fn()} onConfirmCancel={vi.fn()} onCloseCancel={vi.fn()}
    onWithdraw={vi.fn()} />)
}

describe('SCRUM-61 flags on the request page', () => {
  it('shows Too small and Timing mismatch beside a booking status, only where the API set them', () => {
    bookings([booking(1, { too_small: true }), booking(2, { status: 'Requested', timing_mismatch: true }), booking(3)])
    expect(screen.getByTestId('request-detail-booking-too-small-1')).toHaveTextContent('Too small')
    expect(screen.getByTestId('request-detail-booking-status-1')).toHaveTextContent('Approved')
    expect(screen.getByTestId('request-detail-booking-timing-mismatch-2')).toHaveTextContent('Timing mismatch')
    expect(screen.queryByTestId('request-detail-booking-too-small-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-booking-too-small-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-booking-timing-mismatch-3')).not.toBeInTheDocument()
  })

  it('shows Too small beside a hold status and keeps the status text on its own', () => {
    render(<VenueHoldsSection holds={[hold(4, { too_small: true }), hold(5)]} canRelease={false}
      submitting={false} onRelease={vi.fn()} />)
    expect(screen.getByTestId('request-detail-hold-status-4')).toHaveTextContent(/^Held$/)
    expect(screen.getByTestId('request-detail-hold-too-small-4')).toHaveTextContent('Too small')
    expect(screen.queryByTestId('request-detail-hold-too-small-5')).not.toBeInTheDocument()
  })

  it('shows the Safety Officer Too small beside the venue capacity', () => {
    const venue = { id: 1, name: 'Venue A', location: 'Block A', max_capacity: 50, layouts: [], facilities: [],
      accessibility_features: [] }
    render(<SafetyCheckSection decisions={[]} requestedChanges={null} canDecide={false} submitting={false}
      onApprove={vi.fn()} onReject={vi.fn()} onRequestChanges={vi.fn()}
      safetyCheck={{ sent_at: null, note_areas: [], equipment_requirements: [], venue_bookings: [
        { id: 6, date: '2026-11-15', start_time: '10:00', end_time: '12:00', venue, too_small: true },
        { id: 7, date: '2026-11-15', start_time: '10:00', end_time: '12:00', venue, too_small: false },
      ] }} />)
    expect(screen.getByTestId('request-detail-safety-booking-6-capacity')).toHaveTextContent(/^50$/)
    expect(screen.getByTestId('request-detail-safety-booking-6-too-small')).toHaveTextContent('Too small')
    expect(screen.queryByTestId('request-detail-safety-booking-7-too-small')).not.toBeInTheDocument()
  })
})
