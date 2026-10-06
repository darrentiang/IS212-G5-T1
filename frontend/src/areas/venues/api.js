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

// GET /api/venues/:id/blocks
// 200:     [ { id, venue_id, start, end, reason, created_by, created_at } ]   start/end '2026-10-20T09:00', local time
// 403/404: { message }
export const listVenueBlocks = (id) => request('GET', `/api/venues/${id}/blocks`)

// POST /api/venues/:id/blocks
// body:    { start_date, start_time, end_date, end_time, reason }
// 201:     the created block
// 400/403/404: { message }
export const blockVenue = (id, data) => request('POST', `/api/venues/${id}/blocks`, data)
