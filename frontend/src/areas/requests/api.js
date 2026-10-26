import { request } from '../../app/http'

// GET /api/requests
// 200:     [ { id, status, created_by, registration_enabled, submitted_at,
//              decision, decision_reason, decided_at, decided_by,
//              assigned_coordinator, assigned_at,
//              name, purpose, description, date, start_time, end_time, attendance,
//              equipment_requirements, registration_needs,
//              layout, facilities, accessibility_features } ]
//          layout: name | null; facilities, accessibility_features: [name] (SCRUM-42);
//          they replace the brief's free-text venue requirements and accessibility needs
// 403:     { message }
export const listRequests = () => request('GET', '/api/requests')

// GET /api/requests/:id
// 200:     the list row's fields, plus coordinator_notes when the account may
//          see internal notes (docs/design/permissions.md)
// 403/404: { message }
export const getRequest = (id) => request('GET', `/api/requests/${id}`)

// POST /api/requests
// body:    { name, purpose, description, date, start_time, end_time, attendance,
//            equipment_requirements, registration_needs,
//            layout, facilities, accessibility_features }
//          layout: name | null; the lists: [name]; none of the three is required (SCRUM-42)
// 201:     the created, Submitted request
// 400/403: { message }
export const submitRequest = (data) => request('POST', '/api/requests', data)

// POST /api/requests/:id/submit
// 200:     the request, now Submitted
// 400/403/404: { message }
export const submitDraft = (id) => request('POST', `/api/requests/${id}/submit`)

// POST /api/requests/:id/resubmit   (SCRUM-72)
// body:    any subset of { name, purpose, description, date, start_time, end_time, attendance,
//            equipment_requirements, registration_needs, layout, facilities, accessibility_features }
// 200:     the request, now Submitted, with the new submitted_at and the earlier decision,
//          decision_reason, decided_at and decided_by still present
// 400/403/404: { message }   400 when the request is not Rejected or a submit rule is broken
export const resubmitRequest = (id, data) => request('POST', `/api/requests/${id}/resubmit`, data)

// POST /api/requests/:id/approve   (SCRUM-29)
// body:    { reason }   optional
// 200:     the request, with decision Approved and decision_reason, decided_at, decided_by.
//          SCRUM-43: the system also assigns the Event Coordinator with the fewest open
//          events, so status is normally Planning with assigned_coordinator (username)
//          and assigned_at (ISO UTC) set; with no Event Coordinator the status stays
//          Approved and both are null
// 400/403/404/409: { message }   409 when the request is not Submitted or already decided
export const approveRequest = (id, reason) => request('POST', `/api/requests/${id}/approve`, { reason })

// POST /api/requests/:id/reject   (SCRUM-29)
// body:    { reason }   required
// 200:     the request, now Rejected, with decision, decision_reason, decided_at, decided_by
// 400/403/404/409: { message }   400 when the reason is empty
export const rejectRequest = (id, reason) => request('POST', `/api/requests/${id}/reject`, { reason })
// POST /api/requests/draft
// body:    { name, purpose, description, date, start_time, end_time, attendance,
//            equipment_requirements, registration_needs,
//            layout, facilities, accessibility_features }
//          — only name is required
// 201:     the saved Draft
// 400/403: { message }
export const saveDraft = (data) => request('POST', '/api/requests/draft', data)

// PUT /api/requests/:id
// body:    any subset of the fields above; a choice left out is unchanged,
//          null or [] clears it (SCRUM-42)
// 200:     the updated Draft
// 400/403/404: { message }
export const updateDraft = (id, data) => request('PUT', `/api/requests/${id}`, data)

// DELETE /api/requests/:id
// 204:     deleted
// 400/403/404: { message }
export const deleteDraft = (id) => request('DELETE', `/api/requests/${id}`)

// GET /api/request-options   (SCRUM-42)
// 200:     { layouts: [name], facilities: [name], accessibility_features: [name] }   in list order
// 401/403: { message }
export const getRequestOptions = () => request('GET', '/api/request-options')

// GET /api/requests/:id for an account holding the Safety Officer role (SCRUM-89)
// 200:     only while the event is in Safety Check; the fields above, plus
//          safety_decisions: [ { id, decision, reason, notes, decided_at, decided_by } ]
//            decision: 'Approved' | 'Rejected'; reason: text | null; notes: { area: text },
//            only areas that have a note; oldest decision first. An Event Coordinator
//            receives safety_decisions too.
//          safety_check: { sent_at, note_areas: [area],
//            venue_bookings: [ { id, date, start_time, end_time,
//              venue: { id, name, location, max_capacity, layouts, facilities,
//                       accessibility_features } } ],       Approved bookings only
//            equipment_requirements: [] }                    empty until SCRUM-48 and SCRUM-81
//          area is one of attendance, capacity_and_layout, emergency_access, accessibility,
//          equipment_placement, crowd_movement, venue_restrictions
// 403:     { message }   any other status; the same 403 as for every record the account may not open
// GET /api/requests lists the events in Safety Check for that account, longest there first.

// POST /api/requests/:id/send-for-safety-check   (SCRUM-53)
// 200:     the event, now Safety Check, with safety_check_at (ISO UTC) set
// 400:     { message }   the event is not ready: the message lists each outstanding
//          arrangement after "Outstanding:", separated by semicolons
// 403/404/409: { message }   403 an account without safety.send; 404 an event that is not
//          this account's (not assigned to it, or unknown); 409 the event is not in Planning
export const sendForSafetyCheck = (id) => request('POST', `/api/requests/${id}/send-for-safety-check`)

// POST /api/requests/:id/safety/approve   (SCRUM-89)
// body:    { notes }   optional; { area: text }, a blank note is not kept
// 200:     the event, now Confirmed
// 400/403/404: { message }   404 when the event is not in Safety Check (one message for every case)
export const approveSafetyCheck = (id, notes) =>
  request('POST', `/api/requests/${id}/safety/approve`, { notes })

// POST /api/requests/:id/safety/request-changes   (SCRUM-90)
// body:    { reason, areas, notes }   reason required; areas required, one or both of
//          venue_arrangements, technical_arrangements; notes as above (optional)
// 200:     the event, now Planning
// 400/403/404: { message }   400 when the reason is blank or no area is given
// An Event Coordinator's event detail also carries
//          requested_changes: { id, decision, reason, notes, areas, decided_at, decided_by } | null
//          while the event is in Planning and has not been sent for safety check again.
// A decision in safety_decisions has areas: [area] (empty unless it is a request for changes)
export const requestSafetyChanges = (id, reason, areas, notes) =>
  request('POST', `/api/requests/${id}/safety/request-changes`, { reason, areas, notes })

// POST /api/requests/:id/safety/reject   (SCRUM-89)
// body:    { reason, notes }   reason required; notes as above
// 200:     the event, now Planning
// 400/403/404: { message }   400 when the reason is blank
export const rejectSafetyCheck = (id, reason, notes) =>
  request('POST', `/api/requests/${id}/safety/reject`, { reason, notes })

// GET /api/venues   (SCRUM-84: the venue picker of the Place hold form)
// 200:     [ { id, name, location, max_capacity, ..., is_active } ]
// 403:     { message }
// A thin wrapper of the same venues.view call the venues area makes, each area
// owning its own (frontend.md §1).
export const listVenues = () => request('GET', '/api/venues')

// GET /api/requests/:id/holds   (SCRUM-84)
// 200:     [ { id, venue_id, venue_name, event_request_id, event_request_name,
//              status, date, start_time, end_time, occupied_start, occupied_end,
//              expires_at, placed_by, placed_at, released_at } ]
//          status: 'Held' | 'Released'; oldest first
// 403/404: { message }
export const listHolds = (id) => request('GET', `/api/requests/${id}/holds`)

// POST /api/requests/:id/holds   (SCRUM-84)
// body:    { venue_id, expiry_date, expiry_time }   expiry naive local, YYYY-MM-DD and HH:MM
// 201:     the hold, Held (an Approved event is now Planning)
// 400/403/404/409: { message }   409 names what already holds the venue
export const placeHold = (id, data) => request('POST', `/api/requests/${id}/holds`, data)

// POST /api/requests/:id/holds/:holdId/release   (SCRUM-84)
// 200:     the hold, Released
// 403/404/409: { message }
export const releaseHold = (id, holdId) => request('POST', `/api/requests/${id}/holds/${holdId}/release`)

// GET /api/requests/:id/bookings   (SCRUM-83)
// 200:     [ { id, venue_id, venue_name, event_request_id, event_request_name, status,
//              date, start_time, end_time, occupied_start, occupied_end, attendance,
//              layout, facilities, raised_by, raised_at, decision, decision_reason,
//              decided_at, decided_by, suggested_venue_id, suggested_venue, suggested_date,
//              suggested_start_time, suggested_end_time,
//              cancel_reason, cancelled_at, cancelled_by } ]
//          every booking request raised for the event, oldest first; status is one of
//          Requested, Approved, Rejected, Withdrawn, Cancelled; the cancel fields are
//          null until the booking is cancelled
// 403/404: { message }
export const listBookings = (id) => request('GET', `/api/requests/${id}/bookings`)

// POST /api/venues/:venueId/bookings/:bookingId/cancel   (SCRUM-83)
// body:    { reason }   required
// 200:     the booking, now Cancelled, with cancel_reason, cancelled_at, cancelled_by
// 400/403/404/409: { message }   400 a blank reason; 404 not the event's assigned
//          coordinator, or unknown; 409 the booking is not Approved, or the event is not
//          Approved or Planning
export const cancelBooking = (venueId, bookingId, reason) =>
  request('POST', `/api/venues/${venueId}/bookings/${bookingId}/cancel`, { reason })

// POST /api/venues/:venueId/bookings/:bookingId/withdraw   (SCRUM-77, offered here by SCRUM-83)
// 200:     the booking, now Withdrawn
// 403/404/409: { message }
// A thin wrapper of the same call the venues area makes, each area owning its own (frontend.md §1).
export const withdrawBooking = (venueId, bookingId) =>
  request('POST', `/api/venues/${venueId}/bookings/${bookingId}/withdraw`)

// POST /api/requests/:id/clarification   (SCRUM-45)
// body:    { message }   required, not blank
// 201:     the request, still Submitted, with clarification_requested true and its clarifications:
//          [ { id, message, requested_by, requested_at, reply, replied_by, replied_at, open } ],
//          oldest first; the Organiser is told
// 400/403/404/409: { message }   400 a blank message; 403 not an Event Coordinator; 404 not the
//          request's assigned coordinator (or unknown or a Draft); 409 not Submitted, or one is open
export const requestClarification = (id, message) =>
  request('POST', `/api/requests/${id}/clarification`, { message })

// POST /api/requests/:id/clarification/reply   (SCRUM-45)
// body:    { message }   required, not blank
// 200:     the request with the reply recorded and clarification_requested false; the assigned
//          coordinator is told
// 400/403/404/409: { message }   400 a blank reply; 403 not an Event Organiser; 404 not the
//          Organiser who wrote the request; 409 no clarification is open
export const replyToClarification = (id, message) =>
  request('POST', `/api/requests/${id}/clarification/reply`, { message })

// GET /api/assignments/queue   (SCRUM-86)
// 200:     [ { id, name, purpose, date, attendance, created_by, submitted_at } ]
//          every Submitted request with no assigned coordinator, oldest submission first;
//          submitted_at is ISO UTC (null sorts last); nothing more of the request is sent
// 403:     { message }   not the Event Coordinator Lead
export const listAssignmentQueue = () => request('GET', '/api/assignments/queue')

// GET /api/assignments?coordinator=<username>&status=<active status>   (SCRUM-88)
// 200:     { events: [ { id, name, date, status, assigned_coordinator } ],
//            coordinators: [ { id, username, active_events } ] }
//          every Submitted, Approved, Planning, Safety Check or Confirmed request, by id;
//          assigned_coordinator is a username or null (shown as "Unassigned"); both
//          filters are optional; the counts ignore them and list every Event Coordinator
// 400:     { message }   a coordinator that is not an Event Coordinator, or a status that is not active
// 403:     { message }   not the Event Coordinator Lead
export const listAssignments = ({ coordinator = '', status = '' } = {}) => {
  const params = new URLSearchParams()
  if (coordinator) params.set('coordinator', coordinator)
  if (status) params.set('status', status)
  const query = params.toString()
  return request('GET', `/api/assignments${query ? `?${query}` : ''}`)
}

// POST /api/requests/:id/reassign   (SCRUM-44)
// body:    { coordinator_id }   required
// 200:     the request, its status unchanged, with the new assigned_coordinator, assigned_by (the
//          Lead) and assigned_at; the new coordinator, the previous one and the Organiser are told
// 400/403/404/409: { message }   400 no coordinator chosen, or the account is not an Event
//          Coordinator; 403 not the Event Coordinator Lead; 404 unknown or a Draft; 409 not
//          Submitted, Approved, Planning, Safety Check or Confirmed, no coordinator yet, or the
//          coordinator it already has
export const reassignRequest = (id, coordinatorId) =>
  request('POST', `/api/requests/${id}/reassign`, { coordinator_id: coordinatorId })

// GET /api/assignments/coordinators   (SCRUM-86)
// 200:     [ { id, username } ]   every account holding the Event Coordinator role, by username
// 403:     { message }
export const listAssignableCoordinators = () => request('GET', '/api/assignments/coordinators')

// POST /api/requests/:id/assign   (SCRUM-86)
// body:    { coordinator_id }   required
// 200:     the request, still Submitted, with assigned_coordinator, assigned_by and assigned_at;
//          the coordinator and the Organiser are told
// 400/403/404/409: { message }   400 no coordinator chosen, or the account is not an Event
//          Coordinator; 404 unknown or a Draft; 409 already assigned, or not Submitted
export const assignRequest = (id, coordinatorId) =>
  request('POST', `/api/requests/${id}/assign`, { coordinator_id: coordinatorId })

// POST /api/requests/:id/complete (SCRUM-66), no input fields.
// 200: event detail with completion: { completed_by, completed_at (ISO UTC) }.
// 400: invalid stored period; 401/403: authentication/feature; 404: object;
// 409: wrong stage, too early or changed concurrently. Refusals change nothing.
export const completeRequest = (id) => request('POST', `/api/requests/${id}/complete`)

// POST /api/requests/:id/cancel (SCRUM-65). body: { reason } (required text).
// 200: event detail with cancellation { cancelled_by, cancelled_at (UTC), reason }.
// All own active arrangements release atomically; no stock or review changes.
// 400: invalid reason; 401/403: auth/feature; 404: protected object; 409: stage.
export const cancelRequest = (id, reason) => request('POST', `/api/requests/${id}/cancel`, { reason })

// PATCH /api/requests/:id (SCRUM-47), the assigned Event Coordinator only.
// body:    any subset of { name, purpose, description, date, start_time, end_time, attendance,
//            equipment_requirements, registration_needs, layout, facilities, accessibility_features };
//          a field left out is unchanged
// 200:     the event detail, its status unchanged, with change_record:
//          [ { id, field, old_value, new_value, changed_by, changed_at (ISO UTC, Z) } ], oldest first:
//          one entry per significant change (date, times, attendance, equipment requirements,
//          layout, facilities, accessibility features); ordinary changes are not recorded
// 400:     { message }   a submission rule broken (required field, date before today, start not
//          before end, attendance not a positive whole number, a choice not on the list)
// 403/404: { message }   403 without requests.edit_event; 404 not this coordinator's event, or a Draft
// 409:     { message }   not Submitted/Approved/Planning/Safety Check/Confirmed; a significant change in
//          Safety Check or Confirmed; the date or times while the event has a Held venue
// A refusal changes nothing.
export const editEvent = (id, data) => request('PATCH', `/api/requests/${id}`, data)

// GET /api/venue-options   (SCRUM-47: the edit form's lists; a coordinator does not hold requests.edit)
// 200:     { layouts: [name], facilities: [name], accessibility_features: [name] }   in list order
// A thin wrapper of the call the venues area makes, each area owning its own (frontend.md §1).
export const getEditOptions = () => request('GET', '/api/venue-options')
