import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-87 Coordinators Manage Only Their Assigned Events. Curated rows: team
// test sheet, TC-SCRUM-87-01 to 14. Every request a row needs it creates itself
// through the API under the row's own name (org1 submits it, the Lead assigns
// it, a coordinator does whatever the row's Preconditions say) and finds it by
// its id, so a row never depends on what other specs left behind.
//
// Not automated here:
// - TC-SCRUM-87-08, 09 and 11 start from an event reassigned from one
//   coordinator to another (SCRUM-44, not built: assigning an assigned request
//   is refused with 409), so their set-up cannot be made through the app. The
//   backend unit tests cover the same rules by changing the assignment directly.
// - TC-SCRUM-87-06 as drafted expects the Lead + Coordinator account to be
//   refused when opening another coordinator's event. SCRUM-86 gave the Lead a
//   read-only view of every assigned event, so the test checks what the
//   account may not do there instead (see the test).

const BASE_URL = 'http://localhost:5173'
const REFUSED = 'You do not have permission to perform this action.'

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-87',
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

// org1 submits a request; it waits in the queue with no coordinator.
async function submittedRequest(name) {
  return as('org1', async (organiser) => {
    const resp = await organiser.post('/api/requests', { data: { name, ...FIELDS, date: futureDate() } })
    expect(resp.status()).toBe(201)
    return (await resp.json()).id
  })
}

// Submitted and assigned by the Lead to the coordinator named.
async function assignedRequest(name, coordinator) {
  const id = await submittedRequest(name)
  await assignAsLead(id, coordinator)
  return id
}

// Approved: assigned, then approved by that coordinator.
async function approvedRequest(name, coordinator) {
  const id = await assignedRequest(name, coordinator)
  await as(coordinator, async (api) => {
    const approved = await api.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
  })
  return id
}

// A room of this spec's own, so no other spec's bookings can collide with it.
async function ownVenue(name) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 100 } })
    expect(created.status()).toBe(201)
    return (await created.json()).id
  })
}

async function readRequest(username, id) {
  return as(username, async (api) => {
    const resp = await api.get(`/api/requests/${id}`)
    expect(resp.ok()).toBeTruthy()
    return resp.json()
  })
}

async function openRequests(page) {
  await page.getByTestId('layout-nav-requests').click()
  await expect(page.getByTestId('requests-title')).toBeVisible()
}

async function expectRefusedWithNothingShown(page, id) {
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-banner')).toHaveText(REFUSED)
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-name')).toHaveCount(0)
}

// @tc: TC-SCRUM-87-01
// @test: an Event Coordinator's Requests page lists only the requests assigned to them
// @story: SCRUM-87
// @ac: 1
test("an Event Coordinator's Requests page lists only the requests assigned to them", async ({ page }) => {
  const mine = await assignedRequest('List Mine', 'coord1')
  const theirs = await assignedRequest('List Theirs', 'coord2')
  const unassigned = await submittedRequest('List Unassigned')
  await login(page, 'coord1')

  await openRequests(page)

  await expect(page.getByTestId(`requests-row-${mine}`)).toBeVisible()
  await expect(page.getByTestId(`requests-row-${theirs}`)).toHaveCount(0)
  await expect(page.getByTestId(`requests-row-${unassigned}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-87-02
// @test: opening a request that is still unassigned is refused with a message and shows nothing
// @story: SCRUM-87
// @ac: 2
test('opening a request that is still unassigned is refused with a message and shows nothing', async ({ page }) => {
  const id = await submittedRequest('Open Unassigned')
  await login(page, 'coord1')

  await expectRefusedWithNothingShown(page, id)

  const stored = await readRequest('lead1', id)
  expect(stored.status).toBe('Submitted')
  expect(stored.assigned_coordinator).toBeNull()
})

// @tc: TC-SCRUM-87-03
// @test: opening a request assigned to another coordinator is refused with a message and shows nothing
// @story: SCRUM-87
// @ac: 2
test('opening a request assigned to another coordinator is refused with a message and shows nothing', async ({ page }) => {
  const id = await assignedRequest('Open Theirs', 'coord2')
  await login(page, 'coord1')

  await expectRefusedWithNothingShown(page, id)

  const stored = await readRequest('coord2', id)
  expect(stored.status).toBe('Submitted')
  expect(stored.assigned_coordinator).toBe('coord2')
})

// @tc: TC-SCRUM-87-04
// @test: the assigned coordinator can still approve their request
// @story: SCRUM-87
// @ac: 3
test('the assigned coordinator can still approve their request', async ({ page }) => {
  const id = await assignedRequest('Decide Mine', 'coord1')
  await login(page, 'coord1')
  await openRequests(page)
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText('coord1')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
})

// @tc: TC-SCRUM-87-05
// @test: an account holding Lead and Event Coordinator can still view the unassigned queue and assign from it
// @story: SCRUM-87
// @ac: 5
test('an account holding Lead and Event Coordinator can still view the unassigned queue and assign from it', async ({
  page,
}) => {
  const id = await submittedRequest('Lead Assign')
  await login(page, 'leadcoord1')
  await page.getByTestId('layout-nav-queue').click()
  await expect(page.getByTestId('assignment-queue-title')).toBeVisible()

  await page.getByTestId(`assignment-queue-coordinator-input-${id}`).selectOption({ label: 'coord2' })
  await page.getByTestId(`assignment-queue-assign-button-${id}`).click()

  await expect(page.getByTestId('assignment-queue-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId(`assignment-queue-row-${id}`)).toHaveCount(0)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
})

// @tc: TC-SCRUM-87-06
// @test: an account holding Lead and Event Coordinator acts as a coordinator only on events assigned to them
// @story: SCRUM-87
// @ac: 5
test('an account holding Lead and Event Coordinator acts as a coordinator only on events assigned to them', async ({
  page,
}) => {
  const mine = await assignedRequest('Lead Mine', 'leadcoord1')
  const theirs = await assignedRequest('Lead Theirs', 'coord2')
  await login(page, 'leadcoord1')

  await openRequests(page)
  await expect(page.getByTestId(`requests-row-${mine}`)).toBeVisible()
  await expect(page.getByTestId(`requests-row-${theirs}`)).toHaveCount(0)

  // SCRUM-86 gives the Lead a read-only view of an assigned event, so the page
  // opens, but the account is offered no coordinator action on it.
  await page.goto(`/requests/${theirs}`)
  await expect(page.getByTestId('request-detail-name')).toHaveText('Lead Theirs')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-reject-button')).toHaveCount(0)

  // On the event assigned to them the same account is offered the decision.
  await page.goto(`/requests/${mine}`)
  await expect(page.getByTestId('request-detail-approve-button')).toBeVisible()
  await expect(page.getByTestId('request-detail-reject-button')).toBeVisible()
})

// @tc: TC-SCRUM-87-07
// @test: an account holding Event Coordinator and Venue Staff keeps both roles' permissions
// @story: SCRUM-87
// @ac: 5
test("an account holding Event Coordinator and Venue Staff keeps both roles' permissions", async ({ page }) => {
  const mine = await assignedRequest('Multi Mine', 'multi1')
  const theirs = await assignedRequest('Multi Theirs', 'coord1')
  const venueId = await ownVenue('TC87 Room 07')
  const other = await approvedRequest('Multi Other', 'coord2')
  const bookingId = await as('coord2', async (coordinator) => {
    const raised = await coordinator.post(`/api/requests/${other}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
  await login(page, 'multi1')

  await openRequests(page)
  await expect(page.getByTestId(`requests-row-${mine}`)).toBeVisible()
  await expect(page.getByTestId(`requests-row-${theirs}`)).toHaveCount(0)

  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${venueId}`).getByRole('link', { name: 'TC87 Room 07' }).click()
  await page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-87-10
// @test: a coordinator cannot raise a venue booking request for an event assigned to someone else
// @story: SCRUM-87
// @ac: 4
test('a coordinator cannot raise a venue booking request for an event assigned to someone else', async ({ page }) => {
  const id = await approvedRequest('Raise Theirs', 'coord2')
  const venueId = await ownVenue('TC87 Room 10')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}/bookings/new`)

  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'TC87 Room 10' })
  await page.getByTestId('booking-new-raise-button').click()

  await expect(page.getByTestId('booking-new-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('booking-new-banner')).toBeVisible()
  const stored = await readRequest('coord2', id)
  expect(stored.status).toBe('Approved')
  const bookings = await as('venue1', async (staff) => (await (await staff.get(`/api/venues/${venueId}/bookings`)).json()))
  expect(bookings.filter((booking) => booking.event_request_id === id)).toHaveLength(0)
})

// @tc: TC-SCRUM-87-12
// @test: an Event Coordinator cannot create an event request: the control is not offered and the page is refused
// @story: SCRUM-87
// @ac: 7
test('an Event Coordinator cannot create an event request: the control is not offered and the page is refused', async ({
  page,
}) => {
  await login(page, 'coord1')
  await openRequests(page)
  await expect(page.getByTestId('requests-new-button')).toHaveCount(0)

  await page.goto('/requests/new')

  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.getByTestId('request-new-submit-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-87-13
// @test: an Event Coordinator Lead who is not an Organiser cannot create an event request
// @story: SCRUM-87
// @ac: 7
test('an Event Coordinator Lead who is not an Organiser cannot create an event request', async ({ page }) => {
  await login(page, 'lead1')
  await page.getByTestId('layout-nav-queue').click()
  await expect(page.getByTestId('assignment-queue-title')).toBeVisible()
  await expect(page.getByTestId('requests-new-button')).toHaveCount(0)

  await page.goto('/requests/new')

  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.getByTestId('request-new-submit-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-87-14
// @test: an Event Organiser is still offered New request and can open the form
// @story: SCRUM-87
// @ac: 7
test('an Event Organiser is still offered New request and can open the form', async ({ page }) => {
  await login(page, 'org1')
  await openRequests(page)

  await page.getByTestId('requests-new-button').click()

  await expect(page).toHaveURL(/\/requests\/new$/)
  await expect(page.getByTestId('request-new-submit-button')).toBeVisible()
})
