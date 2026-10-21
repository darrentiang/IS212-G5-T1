import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-86 Assign a Coordinator from the Unassigned Queue. Curated rows: team
// test sheet, TC-SCRUM-86-01 to 14. Every request a row needs it creates itself
// through the API under the row's own name (org1 submits it; coord1 or the Lead
// does whatever the row's Preconditions say), and finds it by its id: the queue
// is shared by every spec, so a row never counts the queue or assumes it is
// empty. TC-03 submits through the page, as its steps say. Seeded Open House
// (Confirmed) is only read, never changed.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 'Seminar Room 1'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-86',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 80,
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

async function logout(page) {
  await page.getByTestId('layout-logout-button').click()
  await expect(page).toHaveURL(/\/login$/)
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

// A month ahead, so the submission's "not in the past" rule never trips.
function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

// Today's date as the page shows it: the server stores UTC.
function todayShown() {
  const now = new Date()
  return `${String(now.getUTCDate()).padStart(2, '0')} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`
}

// org1 submits a request, which sits in the queue until a Lead assigns it.
async function submittedRequest(name, overrides = {}) {
  const organiser = await apiAs('org1')
  const resp = await organiser.post('/api/requests', {
    data: { name, ...FIELDS, date: futureDate(), ...overrides },
  })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await organiser.dispose()
  return id
}

async function as(username, work) {
  const api = await apiAs(username)
  try {
    return await work(api)
  } finally {
    await api.dispose()
  }
}

const readRequest = (username, id) =>
  as(username, async (api) => {
    const resp = await api.get(`/api/requests/${id}`)
    expect(resp.ok()).toBeTruthy()
    return resp.json()
  })

async function openQueue(page) {
  await page.getByTestId('layout-nav-queue').click()
  await expect(page.getByTestId('assignment-queue-title')).toBeVisible()
}

const queueRow = (page, id) => page.getByTestId(`assignment-queue-row-${id}`)

async function chooseAndAssign(page, id, coordinator) {
  await page.getByTestId(`assignment-queue-coordinator-input-${id}`).selectOption({ label: coordinator })
  await page.getByTestId(`assignment-queue-assign-button-${id}`).click()
}

async function openFromRequestsPage(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

// @tc: TC-SCRUM-86-01
// @test: an account holding only the Event Coordinator Lead role shows that role and can open the unassigned queue
// @story: SCRUM-86
// @ac: 1
test('an account holding only the Event Coordinator Lead role shows that role and can open the unassigned queue', async ({ page }) => {
  await login(page, 'lead1')

  await expect(page.getByTestId('layout-roles')).toHaveText('Event Coordinator Lead')
  await openQueue(page)
  await expect(page).toHaveURL(/\/assignments\/queue$/)
})

// @tc: TC-SCRUM-86-02
// @test: an account holding both Event Coordinator Lead and Event Coordinator shows both roles and can open the unassigned queue
// @story: SCRUM-86
// @ac: 1
test('an account holding both Event Coordinator Lead and Event Coordinator shows both roles and can open the unassigned queue', async ({ page }) => {
  await login(page, 'leadcoord1')

  await expect(page.getByTestId('layout-roles')).toContainText('Event Coordinator Lead')
  await expect(page.getByTestId('layout-roles')).toContainText('Event Coordinator,')
  await openQueue(page)
  await expect(page.getByTestId('assignment-queue-title')).toBeVisible()
})

// @tc: TC-SCRUM-86-03
// @test: a newly submitted request has no assigned coordinator and appears in the unassigned queue
// @story: SCRUM-86
// @ac: 2
test('a newly submitted request has no assigned coordinator and appears in the unassigned queue', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()
  const values = {
    name: 'Queue New Request',
    purpose: 'Client event',
    description: 'An event for SCRUM-86',
    date: futureDate(),
    'start-time': '10:00',
    'end-time': '12:00',
    attendance: '80',
    'equipment-requirements': 'Projector',
    'registration-needs': 'Guest list supplied',
  }
  for (const [field, value] of Object.entries(values)) {
    await page.getByTestId(`request-new-${field}-input`).fill(value)
  }
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveCount(0)
  const id = new URL(page.url()).pathname.split('/').pop()

  await logout(page)
  await login(page, 'lead1')
  await openQueue(page)
  await expect(queueRow(page, id)).toBeVisible()
  await expect(page.getByTestId(`assignment-queue-name-${id}`)).toHaveText('Queue New Request')
})

// @tc: TC-SCRUM-86-04
// @test: the Lead sees each queued request's details, oldest first
// @story: SCRUM-86
// @ac: 3
test("the Lead sees each queued request's details, oldest first", async ({ page }) => {
  const olderId = await submittedRequest('Queue Older', { date: '2026-12-12', attendance: 120 })
  const newerId = await submittedRequest('Queue Newer', { date: '2026-12-13', attendance: 90 })
  await login(page, 'lead1')
  await openQueue(page)

  for (const [id, name, date, attendance] of [
    [olderId, 'Queue Older', '12 Dec 2026', '120'],
    [newerId, 'Queue Newer', '13 Dec 2026', '90'],
  ]) {
    await expect(page.getByTestId(`assignment-queue-name-${id}`)).toHaveText(name)
    await expect(page.getByTestId(`assignment-queue-purpose-${id}`)).toHaveText('Client event')
    await expect(page.getByTestId(`assignment-queue-date-${id}`)).toHaveText(date)
    await expect(page.getByTestId(`assignment-queue-attendance-${id}`)).toHaveText(attendance)
    await expect(page.getByTestId(`assignment-queue-organiser-${id}`)).toHaveText('org1')
    await expect(page.getByTestId(`assignment-queue-submitted-${id}`)).toHaveText(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/)
  }
  const order = await page
    .locator('[data-testid^="assignment-queue-row-"]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.testid))
  expect(order.indexOf(`assignment-queue-row-${olderId}`)).toBeGreaterThanOrEqual(0)
  expect(order.indexOf(`assignment-queue-row-${olderId}`)).toBeLessThan(order.indexOf(`assignment-queue-row-${newerId}`))
})

// @tc: TC-SCRUM-86-05
// @test: the Lead assigns a queued request to an Event Coordinator
// @story: SCRUM-86
// @ac: 4
test('the Lead assigns a queued request to an Event Coordinator', async ({ page }) => {
  const id = await submittedRequest('Assign From Queue')
  await login(page, 'lead1')
  await openQueue(page)

  await chooseAndAssign(page, id, 'coord1')

  await expect(page.getByTestId('assignment-queue-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('assignment-queue-banner')).toHaveText('Assign From Queue assigned to coord1')
  await expect(queueRow(page, id)).toHaveCount(0)

  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
  await expect(page.getByTestId('request-detail-assigned-by')).toHaveText('lead1')
  await expect(page.getByTestId('request-detail-assigned-at')).toHaveText(todayShown())
  await expect(page.getByTestId('request-detail-decision')).toHaveCount(0)
})

// @tc: TC-SCRUM-86-06
// @test: the Lead can assign a request to an account that holds Event Coordinator together with another role
// @story: SCRUM-86
// @ac: 4
test('the Lead can assign a request to an account that holds Event Coordinator together with another role', async ({ page }) => {
  const id = await submittedRequest('Assign To Two Roles')
  await login(page, 'lead1')
  await openQueue(page)

  await chooseAndAssign(page, id, 'multi1')

  await expect(page.getByTestId('assignment-queue-banner')).toHaveAttribute('role', 'status')
  await expect(queueRow(page, id)).toHaveCount(0)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('multi1')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
})

// @tc: TC-SCRUM-86-07
// @test: the queue lists only Submitted requests that have no coordinator
// @story: SCRUM-86
// @ac: 5
test('the queue lists only Submitted requests that have no coordinator', async ({ page }) => {
  const waitingId = await submittedRequest('Queue Still Waiting')
  const assignedId = await submittedRequest('Queue Already Assigned')
  await assignAsLead(assignedId, 'coord1')
  // The row names the seeded Draft, Design Workshop, but SCRUM-28.spec.js submits
  // it earlier in the same run, so this row saves a Draft of its own (org2's: one
  // open Draft each) and deletes it afterwards, so a re-run finds none open.
  const draftId = await as('org2', async (api) => {
    const saved = await api.post('/api/requests/draft', { data: { name: 'Queue Is Draft' } })
    expect(saved.status()).toBe(201)
    return (await saved.json()).id
  })
  try {
    await login(page, 'lead1')
    await openQueue(page)

    await expect(queueRow(page, waitingId)).toBeVisible()
    await expect(queueRow(page, assignedId)).toHaveCount(0)
    await expect(queueRow(page, draftId)).toHaveCount(0)
    // Seeded Open House is Confirmed.
    await expect(page.locator('[data-testid^="assignment-queue-name-"]', { hasText: 'Open House' })).toHaveCount(0)
  } finally {
    await as('org2', (api) => api.delete(`/api/requests/${draftId}`))
  }
})

// @tc: TC-SCRUM-86-08
// @test: a request that was assigned elsewhere meanwhile cannot be assigned again from an out-of-date queue
// @story: SCRUM-86
// @ac: 5
test('a request that was assigned elsewhere meanwhile cannot be assigned again from an out-of-date queue', async ({ page }) => {
  const id = await submittedRequest('Assign Only Once')
  await login(page, 'lead1')
  await openQueue(page)
  await expect(queueRow(page, id)).toBeVisible()
  // leadcoord1 assigns it behind lead1's open page.
  await assignAsLead(id, 'coord2', 'leadcoord1')

  await chooseAndAssign(page, id, 'coord1')

  await expect(page.getByTestId('assignment-queue-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('assignment-queue-banner')).toContainText('already assigned to coord2')
  await expect(queueRow(page, id)).toHaveCount(0)
  const stored = await readRequest('org1', id)
  expect(stored.assigned_coordinator).toBe('coord2')
  expect(stored.status).toBe('Submitted')
})

// @tc: TC-SCRUM-86-09
// @test: the assigned coordinator is notified, naming the event
// @story: SCRUM-86
// @ac: 6
test('the assigned coordinator is notified, naming the event', async ({ page }) => {
  const id = await submittedRequest('Notify Coordinator')
  await assignAsLead(id, 'coord1')
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-notifications').click()

  // Found by this request's id, not its name: a retry's earlier request has the same name.
  const reply = await page.request.get('/api/notifications')
  const notices = (await reply.json()).filter((row) => row.event_request_id === id)
  expect(notices).toHaveLength(1)
  await expect(page.getByTestId(`notifications-message-${notices[0].id}`)).toHaveText(
    'You have been assigned the event "Notify Coordinator".'
  )
})

// @tc: TC-SCRUM-86-10
// @test: the Event Organiser is notified and can see who is assigned
// @story: SCRUM-86
// @ac: 6
test('the Event Organiser is notified and can see who is assigned', async ({ page }) => {
  const id = await submittedRequest('Notify Organiser')
  await assignAsLead(id, 'coord1')
  await login(page, 'org1')
  await page.getByTestId('layout-nav-notifications').click()

  // Found by this request's id, not its name: the organiser is also told it was
  // received (SCRUM-62), and a retry's earlier request has the same name.
  const reply = await page.request.get('/api/notifications')
  const assigned = (await reply.json()).filter(
    (row) => row.event_request_id === id && row.message.includes('has been assigned')
  )
  expect(assigned).toHaveLength(1)
  await expect(page.getByTestId(`notifications-message-${assigned[0].id}`)).toHaveText(
    'coord1 has been assigned to your event "Notify Organiser".'
  )

  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
})

// @tc: TC-SCRUM-86-11
// @test: a request resubmitted after rejection returns to the coordinator who rejected it, not to the queue
// @story: SCRUM-86
// @ac: 7
test('a request resubmitted after rejection returns to the coordinator who rejected it, not to the queue', async ({ page }) => {
  const id = await submittedRequest('Resubmit Returns')
  await assignAsLead(id, 'coord1')
  await as('coord1', async (api) => {
    const rejected = await api.post(`/api/requests/${id}/reject`, { data: { reason: 'Venue capacity cannot be met.' } })
    expect(rejected.ok()).toBeTruthy()
  })
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-resubmit-button').click()

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')

  await logout(page)
  await login(page, 'lead1')
  await openQueue(page)
  await expect(queueRow(page, id)).toHaveCount(0)

  await logout(page)
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()
  await expect(page.getByTestId(`requests-row-${id}`)).toBeVisible()
})

// @tc: TC-SCRUM-86-12
// @test: approving a request no longer assigns anyone: it stays Approved with its coordinator
// @story: SCRUM-86
// @ac: 8
test('approving a request no longer assigns anyone: it stays Approved with its coordinator', async ({ page }) => {
  const id = await submittedRequest('Approve No Assign')
  await assignAsLead(id, 'coord1')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
})

// @tc: TC-SCRUM-86-13
// @test: the first venue booking request raised by the assigned coordinator moves an Approved request to Planning
// @story: SCRUM-86
// @ac: 8
test('the first venue booking request raised by the assigned coordinator moves an Approved request to Planning', async ({ page }) => {
  const id = await submittedRequest('First Booking Planning')
  await assignAsLead(id, 'coord1')
  await as('coord1', async (api) => {
    const approved = await api.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
  })
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')

  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: SEMINAR_ROOM_1 })
  await page.getByTestId('booking-new-raise-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
})

// @tc: TC-SCRUM-86-14
// @test: an Event Coordinator who is not a Lead cannot view the unassigned queue
// @story: SCRUM-86
// @ac: 9
test('an Event Coordinator who is not a Lead cannot view the unassigned queue', async ({ page }) => {
  const id = await submittedRequest('Queue Hidden')
  await login(page, 'coord1')

  await expect(page.getByTestId('layout-nav-queue')).toHaveCount(0)
  await page.goto('/assignments/queue')

  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.getByTestId('assignment-queue-title')).toHaveCount(0)
  await expect(queueRow(page, id)).toHaveCount(0)
  const stored = await readRequest('lead1', id) // SCRUM-87: a coordinator cannot read an unassigned request
  expect(stored.assigned_coordinator).toBeNull()
  expect(stored.status).toBe('Submitted')
})
