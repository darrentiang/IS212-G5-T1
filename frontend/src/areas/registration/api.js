import { request } from '../../app/http'

// GET /api/registration/events
// 200: [ { id, name, purpose, status, registration_enabled } ]
// 403: { message }
export const listOpenEvents = () => request('GET', '/api/registration/events')
