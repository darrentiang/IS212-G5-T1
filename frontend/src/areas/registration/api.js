import { request } from '../../app/http'

// GET /api/registration/events
// 200: [ { id, name, purpose, status, registration_enabled } ]
// 403: { message }
export const listOpenEvents = () => request('GET', '/api/registration/events')

// GET /api/registrations/mine (SCRUM-55: an Attendee's own registrations, oldest first)
// 200: [ { id, event_request_id, event_name, event_status, date, start_time, end_time,
//          status, can_withdraw } ]   status: Registered | Withdrawn;
//          can_withdraw: true only for a Registered registration of an event that has not started
// 403: { message }
export const listMyRegistrations = () => request('GET', '/api/registrations/mine')

// POST /api/registrations/:id/withdraw
// 200: the registration as in the list, now Withdrawn
// 404: { message }  not the account's own registration
// 409: { message }  already withdrawn, event cancelled, or event started
export const withdrawRegistration = (id) => request('POST', `/api/registrations/${id}/withdraw`)
