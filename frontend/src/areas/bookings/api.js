import { request } from '../../app/http'

// GET /api/venues
// 200:     [ { id, name, location, max_capacity, opening_time, closing_time,
//              facilities, accessibility_features, layouts, is_active } ]
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

// GET /api/requests/:id/venues/:venueId/warnings   (SCRUM-42)
// 200:     [ { type: 'capacity', attendance, max_capacity }
//          | { type: 'start_time', start_time, opening_time, closing_time }
//          | { type: 'end_time', end_time, opening_time, closing_time }
//          | { type: 'layout' | 'facility' | 'accessibility_feature', name } ]
//          one per mismatch; [] when the venue fits; nothing is stored
// 401/403/404: { message }
export const checkVenue = (requestId, venueId) =>
  request('GET', `/api/requests/${requestId}/venues/${venueId}/warnings`)
