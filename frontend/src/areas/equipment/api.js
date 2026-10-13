import { request } from '../../app/http'

// GET /api/equipment
// 200:     [ { id, name, total_units } ]   every recognised type, id ascending
// 401/403: { message }   equipment.view — Technical Support Staff and Event Coordinator
export const listEquipment = () => request('GET', '/api/equipment')

// PATCH /api/equipment/:id
// body:    { total_units }   zero or a positive whole number, as a JSON number or a
//          numeric string (the form sends the field as a string). Blank, booleans,
//          fractions and non-numeric strings are refused; a reduction below the
//          simultaneous reservation minimum is refused with a message naming that
//          minimum; values above 2^53-1 are refused (JSON cannot carry them exactly).
//          Validation runs before any write — a refusal changes nothing.
// 200:     the updated type { id, name, total_units }
// 400/401/403/404: { message }   400 identifies the problem; editing is
//          equipment.edit (Technical Support Staff only)
export const updateTotalUnits = (id, data) => request('PATCH', `/api/equipment/${id}`, data)
