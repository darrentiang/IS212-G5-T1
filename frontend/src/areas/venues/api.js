import { request } from '../../app/http'

// GET /api/venues
// 200:     [ { id, name, location, max_capacity, opening_time, closing_time, facilities, accessibility_features } ]
// 403:     { message }
export const listVenues = () => request('GET', '/api/venues')

// GET /api/venues/:id
// 200:     { id, name, location, max_capacity, opening_time, closing_time, facilities, accessibility_features }
// 403/404: { message }
export const getVenue = (id) => request('GET', `/api/venues/${id}`)

// GET /api/venue-options
// 200:     { facilities: [ name ], accessibility_features: [ name ] }
// 403:     { message }
export const getVenueOptions = () => request('GET', '/api/venue-options')

// POST /api/venues
// body:    { name, location, max_capacity, opening_time, closing_time, facilities, accessibility_features }
// 201:     the created venue
// 400/403: { message }
export const createVenue = (data) => request('POST', '/api/venues', data)

// PUT /api/venues/:id
// body:    { name, location, max_capacity, opening_time, closing_time, facilities, accessibility_features }
// 200:     the updated venue
// 400/403/404: { message }
export const updateVenue = (id, data) => request('PUT', `/api/venues/${id}`, data)

// GET /api/venues/:id/blocks
// 200:     [ { id, venue_id, start, end, reason, created_by, created_at, phase } ]   start/end '2026-10-20T09:00', local time
//          phase: 'upcoming' | 'in_progress' | 'ended', derived by the API from the current Singapore time
//          (SCRUM-79); not stored and not a status, it only decides which action the page offers
// 403/404: { message }
export const listVenueBlocks = (id) => request('GET', `/api/venues/${id}/blocks`)

// POST /api/venues/:id/blocks
// body:    { start_date, start_time, end_date, end_time, reason }
// 201:     the created block
// 400/403/404: { message }
export const blockVenue = (id, data) => request('POST', `/api/venues/${id}/blocks`, data)

// DELETE /api/venues/:id/blocks/:block_id
// 204:     removed (only a block that has not started)
// 400/403/404: { message }
export const removeVenueBlock = (id, blockId) => request('DELETE', `/api/venues/${id}/blocks/${blockId}`)

// PATCH /api/venues/:id/blocks/:block_id
// body:    { end_date, end_time }   the new end (only a block in progress)
// 200:     the updated block
// 400/403/404: { message }
export const endVenueBlock = (id, blockId, data) => request('PATCH', `/api/venues/${id}/blocks/${blockId}`, data)

// GET /api/venues/:id/bookings   (SCRUM-36)
// 200:     [ { id, venue_id, event_request_id, event_request_name, status,
//              date, start_time, end_time, attendance, venue_requirements,
//              raised_by, raised_at } ]
// 403/404: { message }
export const listVenueBookings = (id) => request('GET', `/api/venues/${id}/bookings`)
