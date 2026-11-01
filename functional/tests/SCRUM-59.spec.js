import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead, startPlanning } from './helpers/assign.js'
import { clearClock, pinClock } from './helpers/clock.js'

// SCRUM-59 Request a Change or Withdrawal After Submission. Curated rows: team test sheet,
// TC-SCRUM-59-01 to 12. Every event a row needs it creates itself through the API under the
// row's own name (org2 submits it, the Lead assigns coord1, the parties do whatever the
// row's Preconditions say) and finds it by its id; the rows that need an event nobody here
// creates read the seeded Annual Dinner, Design Workshop, Past Gala and Called Off Fair,
// which this spec never changes. org2 submits so that org1's notifications, which
// SCRUM-58 reads, stay as seeded.

const BASE_URL = 'http://localhost:5173'

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-59',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

const REFUSED =
  'A change can be requested only on a Submitted, Approved, Planning, Safety Check or Confirmed event.'

async function login(page, username) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function as(username, work) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  try {
    return await work(api)
  } finally {
    await api.dispose()
  }
}

function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

async function unassignedRequest(name) {
  return as('org2', async (organiser) => {
    const resp = await organiser.post('/api/requests', { data: { name, ...FIELDS, date: futureDate() } })
    expect(resp.status()).toBe(201)
    return (await resp.json()).id
  })
}

// Submitted by org2 and assigned to coord1 by lead1.
async function submittedRequest(name) {
  const id = await unassignedRequest(name)
  await assignAsLead(id, 'coord1')
  return id
}

async function approvedRequest(name) {
  const id = await submittedRequest(name)
  await as('coord1', async (api) => {
    const approved = await api.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
  })
  return id
}

async function planningRequest(name) {
  const id = await approvedRequest(name)
  await startPlanning(id)
  return id
}

// Planning with its booking approved by the room's staff: ready to send for safety check.
async function readyToSend(name) {
  const id = await approvedRequest(name)
  const venueId = await as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name: `${name} Room`, location: 'Block R', max_capacity: 100 } })
    expect(created.status()).toBe(201)
    return (await created.json()).id
  })
  const bookingId = await as('coord1', async (api) => {
    const raised = await api.post(`/api/requests/${id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
  await as('venue1', async (staff) => {
    const decided = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/approve`, { data: {} })
    expect(decided.ok()).toBeTruthy()
  })
  return id
}

async function safetyCheckRequest(name) {
  const id = await readyToSend(name)
  await as('coord1', async (api) => {
    const sent = await api.post(`/api/requests/${id}/send-for-safety-check`, { data: {} })
    expect(sent.ok()).toBeTruthy()
  })
  return id
}

async function confirmedRequest(name) {
  const id = await safetyCheckRequest(name)
  await as('safety1', async (officer) => {
    const approved = await officer.post(`/api/requests/${id}/safety/approve`, { data: {} })
    expect(approved.ok()).toBeTruthy()
  })
  return id
}

async function raiseAs(id, body, username = 'org2') {
  await as(username, async (api) => {
    const raised = await api.post(`/api/requests/${id}/change-requests`, { data: body })
    expect(raised.status()).toBe(201)
  })
}

async function detail(username, id) {
  return as(username, async (api) => (await api.get(`/api/requests/${id}`)).json())
}

async function seededId(username, name) {
  return as(username, async (api) => {
    const rows = await (await api.get('/api/requests')).json()
    const found = rows.find((row) => row.name === name)
    expect(found, `seeded ${name}`).toBeTruthy()
    return found.id
  })
}

async function noticeCount(username, name) {
  return as(username, async (api) => {
    const notices = await (await api.get('/api/notifications')).json()
    return notices.filter((notice) => notice.message.includes(`"${name}"`)).length
  })
}

const notice = (page, name) => page.locator('[data-testid^="notifications-message-"]', { hasText: `"${name}"` })
const rowsOf = (page) => page.locator('[data-testid^="request-detail-change-row-"]')
const BUTTONS = ['request-detail-change-request-button', 'request-detail-withdrawal-request-button']

async function openRequest(page, id) {
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
}

async function raiseChangeInPage(page, description, affects) {
  await page.getByTestId('request-detail-change-request-button').click()
  await page.getByTestId('request-detail-change-description-input').fill(description)
  for (const key of affects) await page.getByTestId(`request-detail-change-affects-${key}-input`).check()
  await page.getByTestId('request-detail-change-send-button').click()
}

// @tc: TC-SCRUM-59-01
// @test: the Organiser raises a change request that affects the date or time
// @story: SCRUM-59
// @ac: 1, 2, 3, 4
test('the Organiser raises a change request that affects the date or time', async ({ page }) => {
  const id = await approvedRequest('Change Date')
  const before = await detail('org2', id)
  await login(page, 'org2')
  await openRequest(page, id)

  await raiseChangeInPage(page, 'Move the event a week later.', ['date-time'])

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Change request raised')
  await expect(rowsOf(page)).toHaveCount(1)
  const row = rowsOf(page).first()
  await expect(row.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Open')
  await expect(row.locator('[data-testid^="request-detail-change-description-"]')).toHaveText('Move the event a week later.')
  await expect(row.locator('[data-testid^="request-detail-change-review-"]')).toHaveText('Venue bookings and Equipment reservations')
  await expect(row.locator('[data-testid^="request-detail-change-raised-"]')).toHaveText(/^org2, \d{2} \w{3} \d{4}, \d{2}:\d{2}$/)
  const after = await detail('org2', id)
  expect(after.status).toBe('Approved')
  for (const field of ['name', 'purpose', 'description', 'date', 'start_time', 'end_time', 'attendance']) {
    expect(after[field]).toBe(before[field])
  }
})

// @tc: TC-SCRUM-59-02
// @test: what needs reviewing follows what the Organiser picks
// @story: SCRUM-59
// @ac: 2
test('what needs reviewing follows what the Organiser picks', async ({ page }) => {
  const size = await approvedRequest('Change Size')
  const venue = await approvedRequest('Change Venue')
  const gear = await approvedRequest('Change Gear')
  const other = await approvedRequest('Change Other')
  await login(page, 'org2')

  for (const [id, key, wanted] of [
    [size, 'attendance', 'Venue bookings'],
    [venue, 'venue-requirements', 'Venue bookings'],
    [gear, 'equipment', 'Equipment reservations'],
    [other, 'other', 'Nothing needs reviewing'],
  ]) {
    await openRequest(page, id)
    await raiseChangeInPage(page, 'Please change this.', [key])
    await expect(page.locator('[data-testid^="request-detail-change-review-"]')).toHaveText(wanted)
  }
})

// @tc: TC-SCRUM-59-03
// @test: the Organiser asks for the event to be withdrawn, with or without text
// @story: SCRUM-59
// @ac: 1
test('the Organiser asks for the event to be withdrawn, with or without text', async ({ page }) => {
  const withText = await approvedRequest('Withdraw With Text')
  const noText = await approvedRequest('Withdraw No Text')
  await login(page, 'org2')

  await openRequest(page, withText)
  await page.getByTestId('request-detail-withdrawal-request-button').click()
  await expect(page.getByTestId('request-detail-change-affects-other-input')).toHaveCount(0)
  await page.getByTestId('request-detail-change-description-input').fill('Client cancelled the plan.')
  await page.getByTestId('request-detail-change-send-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Withdrawal request raised')
  await expect(page.locator('[data-testid^="request-detail-change-kind-"]')).toHaveText('Withdrawal request')
  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Open')
  await expect(page.locator('[data-testid^="request-detail-change-description-"]:not([data-testid$="-input"])')).toHaveText('Client cancelled the plan.')

  await openRequest(page, noText)
  await page.getByTestId('request-detail-withdrawal-request-button').click()
  await page.getByTestId('request-detail-change-send-button').click()
  await expect(page.locator('[data-testid^="request-detail-change-kind-"]')).toHaveText('Withdrawal request')
  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Open')
  await expect(page.locator('[data-testid^="request-detail-change-description-"]:not([data-testid$="-input"])')).toHaveCount(0)

  for (const id of [withText, noText]) expect((await detail('org2', id)).status).toBe('Approved')
})

// @tc: TC-SCRUM-59-04
// @test: a request can be raised in each allowed status
// @story: SCRUM-59
// @ac: 1
test('a request can be raised in each allowed status', async ({ page }) => {
  const events = [
    [await submittedRequest('Status Submitted'), 'Submitted'],
    [await approvedRequest('Status Approved'), 'Approved'],
    [await planningRequest('Status Planning'), 'Planning'],
    [await safetyCheckRequest('Status Safety Check'), 'Safety Check'],
    [await confirmedRequest('Status Confirmed'), 'Confirmed'],
  ]
  await login(page, 'org2')

  for (const [id, status] of events) {
    await openRequest(page, id)
    await expect(page.getByTestId('request-detail-status')).toContainText(status)

    await raiseChangeInPage(page, 'Please note a dietary need.', ['other'])

    await expect(page.getByTestId('request-detail-banner')).toHaveText('Change request raised')
    await expect(rowsOf(page)).toHaveCount(1)
    await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Open')
    await expect(page.getByTestId('request-detail-status')).toContainText(status)
  }
})

// @tc: TC-SCRUM-59-05
// @test: a change request with no description is refused
// @story: SCRUM-59
// @ac: 1
test('a change request with no description is refused', async ({ page }) => {
  const id = await approvedRequest('Change Blank')
  const before = await noticeCount('coord1', 'Change Blank')
  await login(page, 'org2')
  await openRequest(page, id)
  await page.getByTestId('request-detail-change-request-button').click()
  await page.getByTestId('request-detail-change-affects-other-input').check()

  await page.getByTestId('request-detail-change-send-button').click()
  await expect(page.getByTestId('request-detail-change-description-error')).toHaveText('Describe the change.')
  await page.getByTestId('request-detail-change-description-input').fill('   ')
  await page.getByTestId('request-detail-change-send-button').click()

  await expect(page.getByTestId('request-detail-change-description-error')).toHaveText('Describe the change.')
  await page.reload()
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  await expect(rowsOf(page)).toHaveCount(0)
  expect(await noticeCount('coord1', 'Change Blank')).toBe(before)
})

// @tc: TC-SCRUM-59-06
// @test: a change request that affects nothing is refused
// @story: SCRUM-59
// @ac: 2
test('a change request that affects nothing is refused', async ({ page }) => {
  const id = await approvedRequest('Change Nothing')
  const before = await noticeCount('coord1', 'Change Nothing')
  await login(page, 'org2')
  await openRequest(page, id)
  await page.getByTestId('request-detail-change-request-button').click()
  await page.getByTestId('request-detail-change-description-input').fill('Please change something.')

  await page.getByTestId('request-detail-change-send-button').click()

  await expect(page.getByTestId('request-detail-change-affects-error')).toHaveText('Choose what the change affects.')
  await page.reload()
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  await expect(rowsOf(page)).toHaveCount(0)
  expect(await noticeCount('coord1', 'Change Nothing')).toBe(before)
})

// @tc: TC-SCRUM-59-07
// @test: a second request is refused while one is open
// @story: SCRUM-59
// @ac: 5
test('a second request is refused while one is open', async ({ page }) => {
  const id = await approvedRequest('Change Twice')
  await login(page, 'org2')
  await openRequest(page, id)
  await page.getByTestId('request-detail-change-request-button').click()
  await page.getByTestId('request-detail-change-description-input').fill('Second request')
  await page.getByTestId('request-detail-change-affects-other-input').check()
  await raiseAs(id, { kind: 'Change', description: 'First request', affects: ['other'] })
  const before = await noticeCount('coord1', 'Change Twice')

  await page.getByTestId('request-detail-change-send-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('A request is already open on this event.')
  await page.reload()
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  await expect(rowsOf(page)).toHaveCount(1)
  await expect(page.locator('[data-testid^="request-detail-change-description-"]:not([data-testid$="-input"])')).toHaveText('First request')
  expect(await noticeCount('coord1', 'Change Twice')).toBe(before)
})

// @tc: TC-SCRUM-59-08
// @test: the assigned coordinator sees the open request and is notified
// @story: SCRUM-59
// @ac: 6
test('the assigned coordinator sees the open request and is notified', async ({ page }) => {
  const id = await approvedRequest('Notify Coordinator')
  await login(page, 'org2')
  await openRequest(page, id)
  await raiseChangeInPage(page, 'Please add a projector.', ['equipment'])
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Change request raised')

  await login(page, 'coord1')
  await page.getByTestId('layout-nav-notifications').click()
  await expect(notice(page, 'Notify Coordinator').first()).toHaveText('org2 has asked for a change to "Notify Coordinator".')
  await openRequest(page, id)

  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Open')
  await expect(page.locator('[data-testid^="request-detail-change-review-"]')).toHaveText('Equipment reservations')
  expect(await noticeCount('coord2', 'Notify Coordinator')).toBe(0)
  expect(await noticeCount('lead1', 'Notify Coordinator')).toBe(0)
})

// @tc: TC-SCRUM-59-09
// @test: a request raised before assignment waits and the coordinator is notified when assigned
// @story: SCRUM-59
// @ac: 6
test('a request raised before assignment waits and the coordinator is notified when assigned', async ({ page }) => {
  const id = await unassignedRequest('Wait For Coordinator')
  await raiseAs(id, { kind: 'Change', description: 'Please move it.', affects: ['date_time'] })
  const before = await noticeCount('coord1', 'Wait For Coordinator')
  await login(page, 'lead1')
  await page.getByTestId('layout-nav-queue').click()
  await page.getByTestId(`assignment-queue-coordinator-input-${id}`).selectOption({ label: 'coord1' })
  await page.getByTestId(`assignment-queue-assign-button-${id}`).click()
  await expect(page.getByTestId('assignment-queue-banner')).toContainText('assigned to coord1')

  await login(page, 'coord1')
  await page.getByTestId('layout-nav-notifications').click()
  // The two newest notices (the page lists newest first) are the assignment and the waiting request.
  await expect(notice(page, 'Wait For Coordinator')).toHaveCount(before + 2)
  const newest = [
    await notice(page, 'Wait For Coordinator').nth(0).textContent(),
    await notice(page, 'Wait For Coordinator').nth(1).textContent(),
  ]
  expect(newest.sort()).toEqual([
    'A change request is waiting on your event "Wait For Coordinator".',
    'You have been assigned the event "Wait For Coordinator".',
  ])
  await openRequest(page, id)

  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Open')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
})

// @tc: TC-SCRUM-59-10
// @test: the open request is closed without a decision when the event ends, and the Organiser sees it
// @story: SCRUM-59
// @ac: 7
test('the open request is closed without a decision when the event ends, and the Organiser sees it', async ({ page }) => {
  const rejected = await submittedRequest('End Rejected')
  const cancelled = await approvedRequest('End Cancelled')
  const completed = await confirmedRequest('End Completed')
  for (const id of [rejected, cancelled, completed]) {
    await raiseAs(id, { kind: 'Change', description: 'Please change it.', affects: ['other'] })
  }
  try {
    await login(page, 'coord1')

    await openRequest(page, rejected)
    await page.getByTestId('request-detail-reject-button').click()
    await page.getByTestId('request-detail-reject-reason-input').fill('Capacity cannot be met.')
    await page.getByTestId('request-detail-reject-confirm-button').click()
    await expect(page.getByTestId('request-detail-status')).toContainText('Rejected')

    await openRequest(page, cancelled)
    await page.getByTestId('request-detail-cancel-button').click()
    await page.getByTestId('request-detail-cancel-reason-input').fill('Organiser has withdrawn the event.')
    await page.getByTestId('request-detail-cancel-confirm-button').click()
    await expect(page.getByTestId('request-detail-status')).toContainText('Cancelled')

    pinClock(`${futureDate()}T12:00`)
    await openRequest(page, completed)
    await page.getByTestId('request-detail-complete-button').click()
    await page.getByTestId('request-detail-complete-confirm-button').click()
    await expect(page.getByTestId('request-detail-status')).toHaveText('Completed')

    await login(page, 'org2')
    for (const [id, status] of [[rejected, 'Rejected'], [cancelled, 'Cancelled'], [completed, 'Completed']]) {
      await openRequest(page, id)
      await expect(page.getByTestId('request-detail-status')).toContainText(status)
      await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Closed')
      await expect(page.locator('[data-testid^="request-detail-change-closed-"]')).toHaveText('Closed without a decision')
    }
  } finally {
    clearClock()
  }
})

// @tc: TC-SCRUM-59-11
// @test: an Organiser cannot raise a request on another Organiser's event
// @story: SCRUM-59
// @ac: 8
test("an Organiser cannot raise a request on another Organiser's event", async ({ page }) => {
  const id = await seededId('org1', 'Annual Dinner')
  const before = await noticeCount('coord1', 'Annual Dinner')
  await login(page, 'org2')

  const refused = await page.request.post(`/api/requests/${id}/change-requests`, {
    data: { kind: 'Change', description: 'Please change it.', affects: ['other'] },
  })

  expect(refused.status()).toBe(404)
  expect((await refused.json()).message).toBe('Event request not found.')
  expect((await detail('org1', id)).change_requests).toEqual([])
  expect(await noticeCount('coord1', 'Annual Dinner')).toBe(before)
})

// @tc: TC-SCRUM-59-12
// @test: a request is refused on a Draft, Rejected, Completed or Cancelled event
// @story: SCRUM-59
// @ac: 8
test('a request is refused on a Draft, Rejected, Completed or Cancelled event', async ({ page }) => {
  const rejected = await submittedRequest('Change Rejected')
  await as('coord1', async (api) => {
    const done = await api.post(`/api/requests/${rejected}/reject`, { data: { reason: 'Capacity cannot be met.' } })
    expect(done.ok()).toBeTruthy()
  })
  const owned = [
    [await seededId('org1', 'Design Workshop'), 'Draft', 'org1'],
    [await seededId('org1', 'Past Gala'), 'Completed', 'org1'],
    [await seededId('org1', 'Called Off Fair'), 'Cancelled', 'org1'],
    [rejected, 'Rejected', 'org2'],
  ]

  for (const [id, status, username] of owned) {
    await login(page, username)
    await openRequest(page, id)
    await expect(page.getByTestId('request-detail-status')).toContainText(status)
    for (const button of BUTTONS) await expect(page.getByTestId(button)).toHaveCount(0)

    for (const body of [
      { kind: 'Change', description: 'Please change it.', affects: ['other'] },
      { kind: 'Withdrawal' },
    ]) {
      const refused = await page.request.post(`/api/requests/${id}/change-requests`, { data: body })
      expect(refused.status()).toBe(409)
      expect((await refused.json()).message).toBe(REFUSED)
    }
    const stored = await detail(username, id)
    expect(stored.status).toBe(status)
    expect(stored.change_requests).toEqual([])
  }
})
