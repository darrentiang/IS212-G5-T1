import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-88 View All Assignments and Active Events. Curated rows: team test sheet,
// TC-SCRUM-88-01 to 12. Every request a row needs it creates itself through the
// API under the row's own name (org2 submits it, the Lead assigns it, the
// coordinator does whatever the row's Preconditions say) and finds it by its id.
// Safety Check is reached through SCRUM-53's send-for-safety-check, so TC-01
// creates that event too. For Confirmed, Completed and Cancelled the rows read
// seeded events, which no spec changes: Open House (Confirmed, coord2), Past
// Gala (Completed) and Called Off Fair (Cancelled). Draft is org2's own Draft, deleted afterwards (one open Draft each).
// org2 submits so that org1's notifications, which SCRUM-58 reads, stay as seeded.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-88',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

async function as(username, work) {
  const api = await apiAs(username)
  try {
    return await work(api)
  } finally {
    await api.dispose()
  }
}

// A month ahead, so the submission's "not in the past" rule never trips.
function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

async function submittedRequest(name) {
  return as('org2', async (organiser) => {
    const resp = await organiser.post('/api/requests', { data: { name, ...FIELDS, date: futureDate() } })
    expect(resp.status()).toBe(201)
    return (await resp.json()).id
  })
}

async function assignedRequest(name, coordinator) {
  const id = await submittedRequest(name)
  await assignAsLead(id, coordinator)
  return id
}

async function approvedRequest(name, coordinator) {
  const id = await assignedRequest(name, coordinator)
  await as(coordinator, async (api) => {
    const approved = await api.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
  })
  return id
}

// Planning: the first booking request raised for an Approved event starts planning.
async function planningRequest(name, coordinator) {
  const id = await approvedRequest(name, coordinator)
  const bookingId = await as(coordinator, async (api) => {
    const raised = await api.post(`/api/requests/${id}/bookings`, { data: { venue_id: SEMINAR_ROOM_1 } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
  return { id, bookingId }
}

async function rejectedRequest(name, coordinator) {
  const id = await assignedRequest(name, coordinator)
  await as(coordinator, async (api) => {
    const rejected = await api.post(`/api/requests/${id}/reject`, { data: { reason: 'Venue capacity cannot be met.' } })
    expect(rejected.ok()).toBeTruthy()
  })
  return id
}

// Safety Check (SCRUM-53): an Approved event whose booking at a room of its own
// venue1 approves, which the coordinator then sends for safety check.
async function safetyCheckRequest(name, coordinator) {
  const id = await approvedRequest(name, coordinator)
  const venueId = await as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name: `${name} Room`, location: 'Block R', max_capacity: 100 } })
    expect(created.status()).toBe(201)
    return (await created.json()).id
  })
  const bookingId = await as(coordinator, async (api) => {
    const raised = await api.post(`/api/requests/${id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
  await as('venue1', async (staff) => {
    const decided = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/approve`, { data: {} })
    expect(decided.ok()).toBeTruthy()
  })
  await as(coordinator, async (api) => {
    const sent = await api.post(`/api/requests/${id}/send-for-safety-check`, { data: {} })
    expect(sent.ok()).toBeTruthy()
  })
  return id
}

// A seeded event's id, read as the Lead (which lists every active event).
async function seededId(name) {
  return as('lead1', async (lead) => {
    const { events } = await (await lead.get('/api/assignments')).json()
    const found = events.find((row) => row.name === name)
    expect(found, `seeded ${name} is active`).toBeTruthy()
    return found.id
  })
}

async function openAssignments(page) {
  await page.getByTestId('layout-nav-assignments').click()
  await expect(page.getByTestId('assignments-title')).toBeVisible()
}

const row = (page, id) => page.getByTestId(`assignments-row-${id}`)
const workload = async (page, username) =>
  Number((await page.getByTestId(`assignments-workload-${username}`).textContent()).split(':')[1])

// @tc: TC-SCRUM-88-01
// @test: the Lead's assignments page lists every active event with its name, date, status and assigned coordinator
// @story: SCRUM-88
// @ac: 1
test("the Lead's assignments page lists every active event with its name, date, status and assigned coordinator", async ({
  page,
}) => {
  const submitted = await assignedRequest('View Submitted', 'coord1')
  const approved = await approvedRequest('View Approved', 'coord2')
  const { id: planning } = await planningRequest('View Planning', 'coord1')
  const safety = await safetyCheckRequest('View Safety Check', 'coord1')
  const confirmed = await seededId('Open House')
  await login(page, 'lead1')

  await openAssignments(page)

  for (const [id, name, status, coordinator] of [
    [submitted, 'View Submitted', 'Submitted', 'coord1'],
    [approved, 'View Approved', 'Approved', 'coord2'],
    [planning, 'View Planning', 'Planning', 'coord1'],
    [safety, 'View Safety Check', 'Safety Check', 'coord1'],
    [confirmed, 'Open House', 'Confirmed', 'coord2'],
  ]) {
    await expect(page.getByTestId(`assignments-name-${id}`)).toHaveText(name)
    await expect(page.getByTestId(`assignments-date-${id}`)).toHaveText(/^\d{2} \w{3} \d{4}$/)
    await expect(page.getByTestId(`assignments-status-${id}`)).toHaveText(status)
    await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText(coordinator)
  }
})

// @tc: TC-SCRUM-88-02
// @test: a Submitted request that no coordinator holds is listed with Unassigned as its coordinator
// @story: SCRUM-88
// @ac: 1
test('a Submitted request that no coordinator holds is listed with Unassigned as its coordinator', async ({ page }) => {
  const id = await submittedRequest('View Unassigned')
  await login(page, 'lead1')

  await openAssignments(page)

  await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText('Unassigned')
  await expect(page.getByTestId(`assignments-status-${id}`)).toHaveText('Submitted')
})

// @tc: TC-SCRUM-88-03
// @test: Draft, Rejected, Completed and Cancelled requests are not listed
// @story: SCRUM-88
// @ac: 2
test('Draft, Rejected, Completed and Cancelled requests are not listed', async ({ page }) => {
  const rejected = await rejectedRequest('Hide Rejected', 'coord1')
  const draft = await as('org2', async (api) => {
    const saved = await api.post('/api/requests/draft', { data: { name: 'Hide Draft' } })
    expect(saved.status()).toBe(201)
    return (await saved.json()).id
  })
  try {
    await login(page, 'lead1')

    await openAssignments(page)

    await expect(row(page, rejected)).toHaveCount(0)
    await expect(row(page, draft)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Past Gala' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Called Off Fair' })).toHaveCount(0)
  } finally {
    await as('org2', (api) => api.delete(`/api/requests/${draft}`))
  }
})

// @tc: TC-SCRUM-88-04
// @test: the Lead filters the list by coordinator
// @story: SCRUM-88
// @ac: 3
test('the Lead filters the list by coordinator', async ({ page }) => {
  const one = (await planningRequest('Filter C1', 'coord1')).id
  const two = (await planningRequest('Filter C2', 'coord2')).id
  await login(page, 'lead1')
  await openAssignments(page)

  await page.getByTestId('assignments-coordinator-filter').selectOption('coord1')

  await expect(row(page, one)).toBeVisible()
  await expect(row(page, two)).toHaveCount(0)
  const shown = page.locator('[data-testid^="assignments-coordinator-"]:not([data-testid="assignments-coordinator-filter"])')
  await expect(shown.first()).toHaveText('coord1')
  expect(new Set(await shown.allTextContents())).toEqual(new Set(['coord1']))
})

// @tc: TC-SCRUM-88-05
// @test: the Lead filters the list by status
// @story: SCRUM-88
// @ac: 3
test('the Lead filters the list by status', async ({ page }) => {
  const planning = (await planningRequest('Status Planning', 'coord1')).id
  const approved = await approvedRequest('Status Approved', 'coord1')
  await login(page, 'lead1')
  await openAssignments(page)

  await page.getByTestId('assignments-status-filter').selectOption('Planning')

  await expect(row(page, planning)).toBeVisible()
  await expect(row(page, approved)).toHaveCount(0)
  const shown = page.locator('[data-testid^="assignments-status-"]:not([data-testid="assignments-status-filter"])')
  expect(new Set(await shown.allTextContents())).toEqual(new Set(['Planning']))
})

// @tc: TC-SCRUM-88-06
// @test: the Lead combines the coordinator and status filters
// @story: SCRUM-88
// @ac: 3
test('the Lead combines the coordinator and status filters', async ({ page }) => {
  const hit = (await planningRequest('Combo Hit', 'coord1')).id
  const otherStatus = await approvedRequest('Combo Other Status', 'coord1')
  const otherCoordinator = (await planningRequest('Combo Other Coordinator', 'coord2')).id
  await login(page, 'lead1')
  await openAssignments(page)

  await page.getByTestId('assignments-coordinator-filter').selectOption('coord1')
  await page.getByTestId('assignments-status-filter').selectOption('Planning')

  await expect(row(page, hit)).toBeVisible()
  await expect(row(page, otherStatus)).toHaveCount(0)
  await expect(row(page, otherCoordinator)).toHaveCount(0)
})

// @tc: TC-SCRUM-88-07
// @test: the page shows how many active events each coordinator holds, counting only active statuses
// @story: SCRUM-88
// @ac: 4
test('the page shows how many active events each coordinator holds, counting only active statuses', async ({ page }) => {
  await login(page, 'lead1')
  await openAssignments(page)
  await expect(page.getByTestId('assignments-workload-coord1')).toBeVisible()
  const before = await workload(page, 'coord1')

  await assignedRequest('Count A', 'coord1')
  await planningRequest('Count B', 'coord1')
  await rejectedRequest('Count C', 'coord1')
  await page.reload()

  // Count C is Rejected, so only A and B are added.
  await expect(page.getByTestId('assignments-workload-coord1')).toHaveText(`coord1: ${before + 2}`)
  await page.getByTestId('assignments-coordinator-filter').selectOption('coord1')
  await expect(page.locator('[data-testid^="assignments-row-"]')).toHaveCount(before + 2)
  // multi1 also holds a Completed and a Cancelled seeded event: neither is counted or listed.
  const held = await workload(page, 'multi1')
  await page.getByTestId('assignments-coordinator-filter').selectOption('multi1')
  await expect(page.locator('[data-testid^="assignments-row-"]')).toHaveCount(held)
  await expect(page.getByRole('link', { name: 'Past Gala' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Called Off Fair' })).toHaveCount(0)
})

// @tc: TC-SCRUM-88-08
// @test: the Lead opens a listed event and sees its details and arrangements
// @story: SCRUM-88
// @ac: 5
test('the Lead opens a listed event and sees its details and arrangements', async ({ page }) => {
  const { id, bookingId } = await planningRequest('Read Only Planning', 'coord1')
  await login(page, 'lead1')
  await openAssignments(page)

  await page.getByTestId(`assignments-name-${id}`).getByRole('link').click()

  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
  await expect(page.getByTestId('request-detail-name')).toHaveText('Read Only Planning')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
  await expect(page.getByTestId(`request-detail-booking-venue-${bookingId}`)).toHaveText('Seminar Room 1')
  await expect(page.getByTestId(`request-detail-booking-status-${bookingId}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-88-09
// @test: an account holding Lead and Event Coordinator opens another coordinator's listed event read-only
// @story: SCRUM-88
// @ac: 5
test("an account holding Lead and Event Coordinator opens another coordinator's listed event read-only", async ({
  page,
}) => {
  const id = await assignedRequest('Lead Coord Other', 'coord2')
  await login(page, 'leadcoord1')
  await openAssignments(page)

  await page.getByTestId(`assignments-name-${id}`).getByRole('link').click()

  await expect(page.getByTestId('request-detail-name')).toHaveText('Lead Coord Other')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-reject-button')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
})

// @tc: TC-SCRUM-88-10
// @test: the Lead cannot edit the event or act on its arrangements
// @story: SCRUM-88
// @ac: 5
test('the Lead cannot edit the event or act on its arrangements', async ({ page }) => {
  const { id, bookingId } = await planningRequest('Read Only Planning Act', 'coord1')
  await login(page, 'lead1')
  await openAssignments(page)
  await page.getByTestId(`assignments-name-${id}`).getByRole('link').click()
  await expect(page.getByTestId(`request-detail-booking-row-${bookingId}`)).toBeVisible()

  for (const testId of [
    'request-detail-approve-button',
    'request-detail-reject-button',
    'request-detail-search-venues-button',
    'request-detail-raise-booking-button',
    'request-detail-place-hold-button',
    'request-detail-send-safety-button',
    `request-detail-booking-withdraw-button-${bookingId}`,
    `request-detail-booking-cancel-button-${bookingId}`,
  ]) {
    await expect(page.getByTestId(testId)).toHaveCount(0)
  }
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId(`request-detail-booking-status-${bookingId}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-88-11
// @test: an Event Coordinator is not offered the assignments page and is refused it by address
// @story: SCRUM-88
// @ac: 6
test('an Event Coordinator is not offered the assignments page and is refused it by address', async ({ page }) => {
  await login(page, 'coord1')
  await expect(page.getByTestId('layout-nav-assignments')).toHaveCount(0)

  await page.goto('/assignments')

  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.getByTestId('assignments-title')).toHaveCount(0)
  await expect(page.locator('[data-testid^="assignments-row-"]')).toHaveCount(0)
})

// @tc: TC-SCRUM-88-12
// @test: an Event Organiser is refused the assignments page by address
// @story: SCRUM-88
// @ac: 6
test('an Event Organiser is refused the assignments page by address', async ({ page }) => {
  await login(page, 'org1')

  await page.goto('/assignments')

  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.getByTestId('assignments-title')).toHaveCount(0)
  await expect(page.locator('[data-testid^="assignments-row-"]')).toHaveCount(0)
})
