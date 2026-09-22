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
