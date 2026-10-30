import { request } from '../../app/http'

// GET /api/registration/events (Confirmed events with registration on; SCRUM-54 adds the details and state)
// 200: [ { id, name, purpose, status, date, start_time, end_time, venues, state } ]
//      venues: the Approved venues' names, comma-separated
//      state: register | registered | closed | full, for this account (Registered first, then closed, then full)
// 403: { message }
export const listOpenEvents = () => request('GET', '/api/registration/events')

// POST /api/registration/events/:id/register (SCRUM-54)
// 201: the event as in the list, state registered
// 403: { message }  not an Attendee
// 404: { message }  no such event
// 409: { message }  not open for registration, closed, already registered, or full
export const registerForEvent = (id) => request('POST', `/api/registration/events/${id}/register`)

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
