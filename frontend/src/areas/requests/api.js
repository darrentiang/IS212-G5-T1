import { request } from '../../app/http'

// GET /api/requests
// 200:     [ { id, status, created_by, registration_enabled, submitted_at,
//              decision, decision_reason, decided_at, decided_by,
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
// 200:     the request, now Approved, with decision, decision_reason, decided_at, decided_by
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
