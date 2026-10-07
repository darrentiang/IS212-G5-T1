import { request } from '../../app/http'

// GET /api/venues
// 200:     [ { id, name, location, max_capacity, opening_time, closing_time,
//              facilities, accessibility_features, is_active } ]
// 403:     { message }
// The venue picker on the raise-booking form; a thin wrapper of the same
// venues.view call venues/api.js makes, each area owning its own (frontend.md §1).
export const listVenues = () => request('GET', '/api/venues')

// POST /api/requests/:id/bookings
// body:    { venue_id }
// 201:     the created booking request (venue_id, event_request_id, status,
//          date, start_time, end_time, attendance, venue_requirements,
//          raised_by, raised_at)
// 400/403/404: { message }
export const raiseBooking = (requestId, venueId) =>
  request('POST', `/api/requests/${requestId}/bookings`, { venue_id: venueId })
