import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead, startPlanning } from './helpers/assign.js'

// SCRUM-60 Decide a Change Request. Curated rows: team test sheet, TC-SCRUM-60-01 to 11. Every
// event a row needs it creates itself through the API under the row's own name (org2 submits
// it, the Lead assigns coord1, org2 raises the request the row's Preconditions describe) and
// finds it by its id. org2 submits so that org1's notifications, which SCRUM-58 reads, stay as seeded.

const BASE_URL = 'http://localhost:5173'

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-60',
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

const CHANGE = (affects) => ({ kind: 'Change', description: 'Please change this.', affects })
const WITHDRAWAL = (description) => ({ kind: 'Withdrawal', ...(description ? { description } : {}) })

async function detail(username, id) {
  return as(username, async (api) => (await api.get(`/api/requests/${id}`)).json())
}

// The event, with the request the row says is already open.
async function withOpenRequest(make, name, body) {
  const id = await make(name)
  await raiseAs(id, body)
  return id
}

async function decideAs(username, id, body) {
  return as(username, async (api) => {
    const current = await (await api.get(`/api/requests/${id}`)).json()
    const row = current.change_requests?.[0]
    const resp = await api.post(`/api/requests/${id}/change-requests/${row?.id ?? 1}/decision`, { data: body })
    return { status: resp.status(), body: await resp.json() }
  })
}

const STATUS = '[data-testid^="request-detail-change-status-"]'
const DECIDED = '[data-testid^="request-detail-change-decided-"]'
const REVIEW = '[data-testid^="request-detail-change-review-"]'
const AFFECTS = '[data-testid^="request-detail-change-affects-"]:not([data-testid$="-input"])'
const BUTTONS = ['request-detail-change-accept-button', 'request-detail-change-decline-button']
const DECIDED_TEXT = (word) => new RegExp(`^${word} by coord1, \\d{2} \\w{3} \\d{4}, \\d{2}:\\d{2}$`)

async function openRequest(page, id) {
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
}

async function accept(page, ticks = {}) {
  await page.getByTestId('request-detail-change-accept-button').click()
  for (const [key, on] of Object.entries(ticks)) {
    await page.getByTestId(`request-detail-decide-review-${key}-input`).setChecked(on)
  }
  await page.getByTestId('request-detail-decide-confirm-button').click()
}

async function decline(page, reason) {
  await page.getByTestId('request-detail-change-decline-button').click()
  if (reason !== undefined) await page.getByTestId('request-detail-decide-reason-input').fill(reason)
  await page.getByTestId('request-detail-decide-confirm-button').click()
}

function expectSameDetails(after, before) {
  for (const field of ['name', 'purpose', 'description', 'date', 'start_time', 'end_time', 'attendance']) {
    expect(after[field]).toBe(before[field])
  }
}

// @tc: TC-SCRUM-60-01
// @test: the assigned coordinator accepts a change request and the Organiser sees the decision
// @story: SCRUM-60
// @ac: 1, 3, 6
test('the assigned coordinator accepts a change request and the Organiser sees the decision', async ({ page }) => {
  const id = await withOpenRequest(approvedRequest, 'Accept Change', CHANGE(['attendance']))
  const before = await detail('coord1', id)
  await login(page, 'coord1')
  await openRequest(page, id)

  await accept(page)

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Change request accepted')
  await expect(page.locator(STATUS)).toHaveText('Accepted')
  await expect(page.locator(DECIDED)).toHaveText(DECIDED_TEXT('Accepted'))
  for (const testId of BUTTONS) await expect(page.getByTestId(testId)).toHaveCount(0)
  await login(page, 'org2')
  await openRequest(page, id)
  await expect(page.locator(STATUS)).toHaveText('Accepted')
  await expect(page.locator(DECIDED)).toHaveText(DECIDED_TEXT('Accepted'))
  await expect(page.getByTestId('request-detail-status')).toContainText('Approved')
  expectSameDetails(await detail('org2', id), before)
})

// @tc: TC-SCRUM-60-02
// @test: declining a change request records the reason, and the Organiser sees it
// @story: SCRUM-60
// @ac: 1, 3, 5
test('declining a change request records the reason, and the Organiser sees it', async ({ page }) => {
  const id = await withOpenRequest(confirmedRequest, 'Decline Change', CHANGE(['equipment']))
  await login(page, 'coord1')
  await openRequest(page, id)

  await decline(page, 'The kit is already booked.')

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Change request declined')
  await expect(page.locator(STATUS)).toHaveText('Declined')
  await expect(page.locator(DECIDED)).toHaveText(DECIDED_TEXT('Declined'))
  await expect(page.locator('[data-testid^="request-detail-change-reason-"]')).toHaveText('The kit is already booked.')
  await login(page, 'org2')
  await openRequest(page, id)
  await expect(page.locator(STATUS)).toHaveText('Declined')
  await expect(page.locator(DECIDED)).toHaveText(DECIDED_TEXT('Declined'))
  await expect(page.locator('[data-testid^="request-detail-change-reason-"]')).toHaveText('The kit is already booked.')
  await expect(page.getByTestId('request-detail-status')).toContainText('Confirmed')
})

// @tc: TC-SCRUM-60-03
// @test: a decline without a reason is refused
// @story: SCRUM-60
// @ac: 1
test('a decline without a reason is refused', async ({ page }) => {
  const id = await withOpenRequest(approvedRequest, 'Decline Blank', CHANGE(['attendance']))
  await login(page, 'coord1')
  await openRequest(page, id)
  await page.getByTestId('request-detail-change-decline-button').click()

  await page.getByTestId('request-detail-decide-confirm-button').click()
  await expect(page.getByTestId('request-detail-decide-reason-error')).toHaveText('Give a reason for declining.')
  await page.getByTestId('request-detail-decide-reason-input').fill('   ')
  await page.getByTestId('request-detail-decide-confirm-button').click()

  await expect(page.getByTestId('request-detail-decide-reason-error')).toHaveText('Give a reason for declining.')
  await expect(page.locator(STATUS)).toHaveText('Open')
  await login(page, 'org2')
  await openRequest(page, id)
  await expect(page.locator(STATUS)).toHaveText('Open')
  await expect(page.locator(DECIDED)).toHaveCount(0)
})

// @tc: TC-SCRUM-60-04
// @test: accepting in Submitted and Planning keeps the event's status
// @story: SCRUM-60
// @ac: 1, 5
test("accepting in Submitted and Planning keeps the event's status", async ({ page }) => {
  const events = [
    [await withOpenRequest(submittedRequest, 'Accept Submitted', CHANGE(['date_time'])), 'Submitted'],
    [await withOpenRequest(planningRequest, 'Accept Planning', CHANGE(['date_time'])), 'Planning'],
  ]
  await login(page, 'coord1')

  for (const [id, status] of events) {
    const before = await detail('coord1', id)
    await openRequest(page, id)

    await accept(page)

    await expect(page.locator(STATUS)).toHaveText('Accepted')
    await expect(page.getByTestId('request-detail-status')).toContainText(status)
    expectSameDetails(await detail('coord1', id), before)
  }
})

// @tc: TC-SCRUM-60-05
// @test: accepting a change that needs reviewing returns a Safety Check or Confirmed event to Planning
// @story: SCRUM-60
// @ac: 5
test('accepting a change that needs reviewing returns a Safety Check or Confirmed event to Planning', async ({ page }) => {
  const events = [
    await withOpenRequest(safetyCheckRequest, 'Return Safety Check', CHANGE(['date_time'])),
    await withOpenRequest(confirmedRequest, 'Return Confirmed', CHANGE(['date_time'])),
  ]
  await login(page, 'coord1')

  for (const id of events) {
    const before = await detail('coord1', id)
    await openRequest(page, id)

    await accept(page)

    await expect(page.locator(STATUS)).toHaveText('Accepted')
    await expect(page.getByTestId('request-detail-status')).toContainText('Planning')
    expectSameDetails(await detail('coord1', id), before)
  }
})

// @tc: TC-SCRUM-60-06
// @test: the coordinator adds what needs reviewing before accepting, and the corrected value counts
// @story: SCRUM-60
// @ac: 2, 5
test('the coordinator adds what needs reviewing before accepting, and the corrected value counts', async ({ page }) => {
  const id = await withOpenRequest(confirmedRequest, 'Correct Up', CHANGE(['other']))
  await login(page, 'coord1')
  await openRequest(page, id)
  await expect(page.locator(REVIEW)).toHaveText('Nothing needs reviewing')

  await accept(page, { 'venue-bookings': true })

  await expect(page.locator(STATUS)).toHaveText('Accepted')
  await expect(page.locator(REVIEW)).toHaveText('Venue bookings')
  await expect(page.getByTestId('request-detail-status')).toContainText('Planning')
  await expect(page.locator(AFFECTS)).toHaveText('Affects: Other')
})

// @tc: TC-SCRUM-60-07
// @test: the coordinator removes what needs reviewing before accepting, and the event keeps its status
// @story: SCRUM-60
// @ac: 2, 5
test('the coordinator removes what needs reviewing before accepting, and the event keeps its status', async ({ page }) => {
  const id = await withOpenRequest(safetyCheckRequest, 'Correct Down', CHANGE(['date_time']))
  await login(page, 'coord1')
  await openRequest(page, id)
  await expect(page.locator(REVIEW)).toHaveText('Venue bookings and Equipment reservations')

  await accept(page, { 'venue-bookings': false, 'equipment-reservations': false })

  await expect(page.locator(STATUS)).toHaveText('Accepted')
  await expect(page.locator(REVIEW)).toHaveText('Nothing needs reviewing')
  await expect(page.getByTestId('request-detail-status')).toContainText('Safety Check')
  await expect(page.locator(AFFECTS)).toHaveText('Affects: Date or time')
})

// @tc: TC-SCRUM-60-08
// @test: accepting a withdrawal cancels the event and records who asked and when
// @story: SCRUM-60
// @ac: 4
test('accepting a withdrawal cancels the event and records who asked and when', async ({ page }) => {
  const withText = await withOpenRequest(approvedRequest, 'Withdraw With Text', WITHDRAWAL('Client cancelled the plan.'))
  const noText = await withOpenRequest(approvedRequest, 'Withdraw No Text', WITHDRAWAL())
  const reason = /^Withdrawn at the Event Organiser's request on \d{2} \w{3} \d{4}, \d{2}:\d{2}\./
  await login(page, 'coord1')

  for (const id of [withText, noText]) {
    await openRequest(page, id)
    await accept(page)
    await expect(page.getByTestId('request-detail-banner')).toHaveText('Withdrawal request accepted')
    await expect(page.locator(STATUS)).toHaveText('Accepted')
    await expect(page.getByTestId('request-detail-status')).toContainText('Cancelled')
  }

  await login(page, 'org2')
  await openRequest(page, withText)
  await expect(page.getByTestId('request-detail-cancellation-reason')).toHaveText(
    new RegExp(`${reason.source} Client cancelled the plan\\.$`),
  )
  await openRequest(page, noText)
  await expect(page.getByTestId('request-detail-cancellation-reason')).toHaveText(new RegExp(`${reason.source}$`))
})

// @tc: TC-SCRUM-60-09
// @test: a request that was already decided cannot be decided again
// @story: SCRUM-60
// @ac: 7
test('a request that was already decided cannot be decided again', async ({ page }) => {
  const id = await withOpenRequest(approvedRequest, 'Decide Twice', CHANGE(['attendance']))
  await login(page, 'coord1')
  await openRequest(page, id)
  await expect(page.locator(STATUS)).toHaveText('Open')
  const other = await decideAs('coord1', id, { decision: 'Accept' })
  expect(other.status).toBe(200)

  await decline(page, 'Changed my mind.')

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Only an open request can be decided.')
  await page.reload()
  await expect(page.locator(STATUS)).toHaveText('Accepted')
  await expect(page.locator('[data-testid^="request-detail-change-reason-"]')).toHaveCount(0)
  await login(page, 'org2')
  await openRequest(page, id)
  await expect(page.locator(DECIDED)).toHaveCount(1)
  await expect(page.locator(STATUS)).toHaveText('Accepted')
})

// @tc: TC-SCRUM-60-10
// @test: a closed request cannot be decided
// @story: SCRUM-60
// @ac: 7
test('a closed request cannot be decided', async ({ page }) => {
  const id = await withOpenRequest(approvedRequest, 'Decide Closed', CHANGE(['attendance']))
  await as('coord1', async (api) => {
    const cancelled = await api.post(`/api/requests/${id}/cancel`, { data: { reason: 'Venue lost.' } })
    expect(cancelled.ok()).toBeTruthy()
  })
  await login(page, 'coord1')
  await openRequest(page, id)

  await expect(page.locator(STATUS)).toHaveText('Closed')
  for (const testId of BUTTONS) await expect(page.getByTestId(testId)).toHaveCount(0)
  const direct = await decideAs('coord1', id, { decision: 'Accept' })

  expect(direct.status).toBe(409)
  expect(direct.body.message).toBe('Only an open request can be decided.')
  await page.reload()
  await expect(page.locator(STATUS)).toHaveText('Closed')
  await expect(page.getByTestId('request-detail-status')).toContainText('Cancelled')
})

// @tc: TC-SCRUM-60-11
// @test: only the assigned coordinator can decide a request
// @story: SCRUM-60
// @ac: 7
test('only the assigned coordinator can decide a request', async ({ page }) => {
  const id = await withOpenRequest(approvedRequest, 'Decide Wrong Account', CHANGE(['attendance']))
  const rowId = (await detail('coord1', id)).change_requests[0].id
  const send = (username) =>
    as(username, async (api) => {
      const resp = await api.post(`/api/requests/${id}/change-requests/${rowId}/decision`, { data: { decision: 'Accept' } })
      return { status: resp.status(), body: await resp.json() }
    })

  const wrong = await send('coord2')
  expect([wrong.status, wrong.body.message]).toEqual([404, 'Event request not found.'])
  for (const username of ['org2', 'lead1']) expect((await send(username)).status).toBe(403)

  const after = await detail('coord1', id)
  expect(after.status).toBe('Approved')
  expect(after.change_requests.map((row) => [row.status, row.decided_by])).toEqual([['Open', null]])
  await login(page, 'coord1')
  await openRequest(page, id)
  await expect(page.locator(STATUS)).toHaveText('Open')
})
