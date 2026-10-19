import { expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-86: a submitted request has no coordinator until the Event Coordinator
// Lead assigns one from the unassigned queue; approving assigns no one. A spec
// that needs an event with its coordinator (holds, safety check, cancelling a
// booking) calls this once the request is submitted, as lead1 would (or the Lead named).
const BASE_URL = 'http://localhost:5173'

export async function assignAsLead(eventId, coordinator = 'coord1', leadUsername = 'lead1') {
  const lead = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const login = await lead.post('/api/login', { data: { username: leadUsername, password: 'Passw0rd!' } })
  expect(login.ok()).toBeTruthy()

  const accounts = await (await lead.get('/api/assignments/coordinators')).json()
  const chosen = accounts.find((account) => account.username === coordinator)
  expect(chosen, `${coordinator} is an Event Coordinator`).toBeTruthy()

  const assigned = await lead.post(`/api/requests/${eventId}/assign`, { data: { coordinator_id: chosen.id } })
  expect(assigned.ok()).toBeTruthy()
  const body = await assigned.json()
  await lead.dispose()
  return body
}

// An Approved event moves to Planning with its first booking request or hold
// (SCRUM-86 AC8). The sheet's rows often start from "a Planning event" with
// nothing booked, so the event's coordinator raises one booking request at a
// room of its own and withdraws it: the event stays Planning, and a Withdrawn
// request holds nothing and is not an Approved booking. One such room serves the
// whole run.
let starterRoom
async function planningStarterRoom() {
  starterRoom ??= (async () => {
    const staff = await playwrightRequest.newContext({ baseURL: BASE_URL })
    const login = await staff.post('/api/login', { data: { username: 'venue1', password: 'Passw0rd!' } })
    expect(login.ok()).toBeTruthy()
    const created = await staff.post('/api/venues', {
      data: { name: 'Planning Starter Room', location: 'Block T', max_capacity: 100 },
    })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    await staff.dispose()
    return id
  })()
  return starterRoom
}

export async function startPlanning(eventId, coordinator = 'coord1') {
  const venueId = await planningStarterRoom()
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const login = await api.post('/api/login', { data: { username: coordinator, password: 'Passw0rd!' } })
  expect(login.ok()).toBeTruthy()
  const raised = await api.post(`/api/requests/${eventId}/bookings`, { data: { venue_id: venueId } })
  expect(raised.status()).toBe(201)
  const { id } = await raised.json()
  const withdrawn = await api.post(`/api/venues/${venueId}/bookings/${id}/withdraw`)
  expect(withdrawn.ok()).toBeTruthy()
  await api.dispose()
}
