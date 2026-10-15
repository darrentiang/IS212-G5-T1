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
