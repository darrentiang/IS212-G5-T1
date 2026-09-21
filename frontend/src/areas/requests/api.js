import { request } from '../../app/http'

// GET /api/requests
// 200:     [ { id, name, purpose, status, created_by, registration_enabled } ]
// 403:     { message }
export const listRequests = () => request('GET', '/api/requests')

// GET /api/requests/:id
// 200:     { id, name, purpose, status, created_by, registration_enabled, coordinator_notes? }
// 403/404: { message }
export const getRequest = (id) => request('GET', `/api/requests/${id}`)

// POST /api/requests
// body:    { name, purpose, description, date, start_time, end_time, attendance,
//            venue_requirements, accessibility_needs, equipment_requirements, registration_needs }
// 201:     the created, Submitted request
// 400/403: { message }
export const submitRequest = (data) => request('POST', '/api/requests', data)

// POST /api/requests/:id/submit
// 200:     the request, now Submitted
// 400/403/404: { message }
export const submitDraft = (id) => request('POST', `/api/requests/${id}/submit`)
