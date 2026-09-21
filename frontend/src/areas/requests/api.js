import { request } from '../../app/http'

// GET /api/requests
// 200:     [ { id, name, purpose, status, created_by, registration_enabled } ]
// 403:     { message }
export const listRequests = () => request('GET', '/api/requests')

// GET /api/requests/:id
// 200:     { id, name, purpose, status, created_by, registration_enabled, coordinator_notes? }
// 403/404: { message }
export const getRequest = (id) => request('GET', `/api/requests/${id}`)
