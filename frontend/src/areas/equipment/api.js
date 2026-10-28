import { request } from '../../app/http'

// GET /api/equipment
// 200:     [ { id, name, description, location, total_units } ]   every recognised type, id ascending
// 401/403: { message }   equipment.view — Technical Support Staff and Event Coordinator
export const listEquipment = () => request('GET', '/api/equipment')

// PATCH /api/equipment/:id
// body:    { total_units }   zero or a positive whole number, as a JSON number or a
//          numeric string (the form sends the field as a string). Blank, booleans,
//          fractions and non-numeric strings are refused; a reduction below the
//          simultaneous reservation minimum is refused with a message naming that
//          minimum; values above 2^53-1 are refused (JSON cannot carry them exactly).
//          Validation runs before any write — a refusal changes nothing.
// 200:     the updated type { id, name, description, location, total_units };
//          name, description and location remain unchanged (read-only catalogue data)
// 400/401/403/404: { message }   400 identifies the problem; editing is
//          equipment.edit (Technical Support Staff only)
export const updateTotalUnits = (id, data) => request('PATCH', `/api/equipment/${id}`, data)

// GET /api/equipment/:id/availability   (SCRUM-50)
// query:   start, end   'YYYY-MM-DDTHH:MM'; both required, the start before the end
//          or event_request_id and quantity, as opened from a recorded requirement:
//          then the event's own period is used and its own reservations are left out
// 200:     { equipment_type: { id, name }, start, end, total_units, reserved_units,
//            out_of_service_units, available_units }
//          reserved_units is the most units held at the same time by Reserved
//          reservations overlapping the period (state-model.md); out_of_service_units
//          is 0 until SCRUM-52. With a quantity, also
//          { requested_units, covered, short_by }
// 400/401/403/404: { message }   equipment.check — Technical Support Staff only
export const checkAvailability = (id, params) =>
  request('GET', `/api/equipment/${id}/availability?${new URLSearchParams(params).toString()}`)

// SCRUM-48: scoped equipment context, not the Organiser's free-text needs.
// GET /api/equipment/requests -> [{id,name,status,date,start_time,end_time}]
// Assigned Coordinator: own non-Draft events. Technical Support: non-Draft events.
// equipment.requirements.view; 401/403: {message}.
export const listEquipmentEvents = () => request('GET', '/api/equipment/requests')

// GET /api/requests/:id/equipment -> {id,name,status,date,start_time,end_time,
//   approved_venue_bookings:[{id,venue_name,date,start_time,end_time}],
//   requirements:[{id,equipment_type_id,equipment_type_name,quantity,technical_requirements,status}]}
// equipment.requirements.view; object read refusal 403; absent event 404.
export const getEquipmentRequirements = (id) => request('GET', `/api/requests/${id}/equipment`)

// POST same collection: {equipment_type_id: integer, quantity, technical_requirements?: string}
// quantity: positive whole numeric string (exact) or JSON number (parser precision),
// at most 2^53-1. Blank/fraction/non-finite/bool refused, never rounded.
// Recognised type, unique per event, Requested on creation; stock not checked.
// 201: requirement. 400/401/403/404/409: {message}. Both mutations below use
// equipment.requirements.edit + assigned Coordinator + Approved/Planning.
export const addEquipmentRequirement = (id, data) => request('POST', `/api/requests/${id}/equipment`, data)

// PATCH /api/requests/:id/equipment/:requirementId: {quantity,technical_requirements?}
// Only Requested. Optional text omitted: unchanged; "": clear. Type immutable.
// 200: requirement. Refusals leave requirements/stock/reservations unchanged.
export const updateEquipmentRequirement = (id, requirementId, data) =>
  request('PATCH', `/api/requests/${id}/equipment/${requirementId}`, data)

// DELETE same item, Requested only. 204, or {message} with 401/403/404/409.
export const removeEquipmentRequirement = (id, requirementId) =>
  request('DELETE', `/api/requests/${id}/equipment/${requirementId}`)

// SCRUM-81: every requirement read/mutation also returns decline_reason (null
// unless Declined), decided_by (username|null), decided_at (ISO UTC|null),
// arrangement_note (text), has_unreleased_reservation (derived event/type flag).
// PATCH /api/requests/:id/equipment/:requirementId/decision
// body: {decision: 'Approved'|'Declined', reason?: string}; decline needs nonblank
// reason; approval clears current reason. TSS + Approved/Planning + no Reserved
// reservation for this event/type. Corrections supported; no reservation created.
// 200: updated requirement; 400/401/403/404/409: {message}, no mutation.
export const decideEquipmentRequirement = (id, requirementId, data) =>
  request('PATCH', `/api/requests/${id}/equipment/${requirementId}/decision`, data)

// PATCH /api/requests/:id/equipment/:requirementId/note
// body: {arrangement_note: string}; TSS + Approved/Planning, any review state,
// Reserved rows included. Only note changes. 200: updated requirement;
// 400/401/403/404/409: {message}, no mutation. Neither action changes stock.
export const updateEquipmentArrangementNote = (id, requirementId, data) =>
  request('PATCH', `/api/requests/${id}/equipment/${requirementId}/note`, data)


// SCRUM-51: scoped reservation history; same read access as equipment context.
// GET /api/requests/:id/equipment/reservations -> Reservation[]; 401/403/404.
// The equipment context also includes reservations: Reservation[].
// SCRUM-61: each Reservation carries timing_mismatch, derived at every read; true only while Reserved.
// Reservation = {id,event_request_id,equipment_type_id,equipment_type_name,
//                quantity,date,start_time,end_time,status:'Reserved'|'Released'}.
export const listEquipmentReservations = (id) =>
  request('GET', `/api/requests/${id}/equipment/reservations`)

// POST /api/requests/:id/equipment/:requirementId/reserve; no input quantity.
// Full Approved requirement quantity; Approved/Planning; no unreleased duplicate;
// current period availability rechecked transactionally. 201: {reservation,requirement}.
// POST /api/requests/:id/equipment/reservations/:reservationId/release;
// Reserved -> Released in Approved/Planning. 200: {reservation,requirement|null}.
// Both: equipment.reserve (TSS); 401/403/404/409 {message}; refusals change nothing.
// Decision-lock flag in requirement is recomputed; no stock/review/stage mutation.
export const reserveEquipment = (id, requirementId) =>
  request('POST', `/api/requests/${id}/equipment/${requirementId}/reserve`)
export const releaseEquipment = (id, reservationId) =>
  request('POST', `/api/requests/${id}/equipment/reservations/${reservationId}/release`)
