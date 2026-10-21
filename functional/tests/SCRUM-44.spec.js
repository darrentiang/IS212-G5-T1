import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead, startPlanning } from './helpers/assign.js'

// SCRUM-44 Reassign an Event to Another Coordinator. Curated rows: team test
// sheet, TC-SCRUM-44-01 to 11. Every event a row needs it creates itself through
// the API under the row's own name (org2 submits it, the Lead assigns coord1, the
// coordinator does whatever the row's Preconditions say) and finds it by its id.
// A Safety Check or Confirmed event needs an Approved booking, so each gets a
// room of its own. org2 submits so that org1's notifications, which SCRUM-58
// reads, stay as seeded.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-44',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

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

function inDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

async function submittedRequest(name) {
  return as('org2', async (organiser) => {
    const resp = await organiser.post('/api/requests', { data: { name, ...FIELDS, date: inDays(30) } })
    expect(resp.status()).toBe(201)
    return (await resp.json()).id
  })
}

async function assignedRequest(name, coordinator = 'coord1') {
  const id = await submittedRequest(name)
  await assignAsLead(id, coordinator)
  return id
}

async function approvedRequest(name, coordinator = 'coord1') {
  const id = await assignedRequest(name, coordinator)
  await as(coordinator, async (api) => {
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

async function openAssignments(page) {
  await page.getByTestId('layout-nav-assignments').click()
  await expect(page.getByTestId('assignments-title')).toBeVisible()
}

async function reassignInPage(page, id, coordinator) {
  await page.getByTestId(`assignments-reassign-input-${id}`).selectOption(coordinator)
  await page.getByTestId(`assignments-reassign-button-${id}`).click()
}

async function reassignAsLead(id, coordinator = 'coord2', leadUsername = 'lead1') {
  return as(leadUsername, async (lead) => {
    const accounts = await (await lead.get('/api/assignments/coordinators')).json()
    const chosen = accounts.find((account) => account.username === coordinator)
    const moved = await lead.post(`/api/requests/${id}/reassign`, { data: { coordinator_id: chosen.id } })
    expect(moved.ok()).toBeTruthy()
  })
}

async function detail(username, id) {
  return as(username, async (api) => (await api.get(`/api/requests/${id}`)).json())
}

async function noticeCount(username, name) {
  return as(username, async (api) => {
    const notices = await (await api.get('/api/notifications')).json()
    return notices.filter((notice) => notice.message.includes(`"${name}"`)).length
  })
}

const notice = (page, name) => page.locator('[data-testid^="notifications-message-"]', { hasText: `"${name}"` })

// @tc: TC-SCRUM-44-01
// @test: the Lead reassigns a Planning event to another coordinator
// @story: SCRUM-44
// @ac: 1, 3
test('the Lead reassigns a Planning event to another coordinator', async ({ page }) => {
  const id = await planningRequest('Reassign Planning')
  await login(page, 'lead1')
  await openAssignments(page)
  await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText('coord1')

  await reassignInPage(page, id, 'coord2')

  await expect(page.getByTestId('assignments-banner')).toHaveText('Reassign Planning reassigned to coord2.')
  await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText('coord2')
  await expect(page.getByTestId(`assignments-status-${id}`)).toHaveText('Planning')
  await expect(page.getByTestId(`assignments-name-${id}`)).toHaveText('Reassign Planning')
})

// @tc: TC-SCRUM-44-02
// @test: each other allowed status reassigns the same way
// @story: SCRUM-44
// @ac: 1
test('each other allowed status reassigns the same way', async ({ page }) => {
  const events = [
    [await assignedRequest('Reassign Submitted'), 'Reassign Submitted', 'Submitted'],
    [await approvedRequest('Reassign Approved'), 'Reassign Approved', 'Approved'],
    [await safetyCheckRequest('Reassign Safety Check'), 'Reassign Safety Check', 'Safety Check'],
    [await confirmedRequest('Reassign Confirmed'), 'Reassign Confirmed', 'Confirmed'],
  ]
  await login(page, 'lead1')
  await openAssignments(page)

  for (const [id, name, status] of events) {
    await expect(page.getByTestId(`assignments-status-${id}`)).toHaveText(status)

    await reassignInPage(page, id, 'coord2')

    await expect(page.getByTestId('assignments-banner')).toHaveText(`${name} reassigned to coord2.`)
    await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText('coord2')
    await expect(page.getByTestId(`assignments-status-${id}`)).toHaveText(status)
  }
})

// @tc: TC-SCRUM-44-03
// @test: an event that stopped being active after the page loaded cannot be reassigned
// @story: SCRUM-44
// @ac: 1
test('an event that stopped being active after the page loaded cannot be reassigned', async ({ page }) => {
  const id = await assignedRequest('Reassign Rejected')
  await login(page, 'lead1')
  await openAssignments(page)
  await expect(page.getByTestId(`assignments-row-${id}`)).toBeVisible()
  await as('coord1', async (api) => {
    const rejected = await api.post(`/api/requests/${id}/reject`, { data: { reason: 'Venue capacity cannot be met.' } })
    expect(rejected.ok()).toBeTruthy()
  })

  await reassignInPage(page, id, 'coord2')

  await expect(page.getByTestId('assignments-banner')).toHaveText(
    'A Rejected event cannot be reassigned, only an active one.',
  )
  await page.reload()
  await expect(page.getByTestId('assignments-title')).toBeVisible()
  await expect(page.getByTestId(`assignments-row-${id}`)).toHaveCount(0)
  const stored = await detail('coord1', id)
  expect(stored.status).toBe('Rejected')
  expect(stored.assigned_coordinator).toBe('coord1')
})

// @tc: TC-SCRUM-44-04
// @test: an event with no coordinator offers no Reassign
// @story: SCRUM-44
// @ac: 1
test('an event with no coordinator offers no Reassign', async ({ page }) => {
  const id = await submittedRequest('Reassign Unassigned')
  await login(page, 'lead1')

  await openAssignments(page)

  await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText('Unassigned')
  await expect(page.getByTestId(`assignments-reassign-input-${id}`)).toHaveCount(0)
  await expect(page.getByTestId(`assignments-reassign-button-${id}`)).toHaveCount(0)
  await page.getByTestId('layout-nav-queue').click()
  await expect(page.getByTestId(`assignment-queue-row-${id}`)).toBeVisible()
})

// @tc: TC-SCRUM-44-05
// @test: only accounts holding the Event Coordinator role can be chosen
// @story: SCRUM-44
// @ac: 1
test('only accounts holding the Event Coordinator role can be chosen', async ({ page }) => {
  const id = await approvedRequest('Reassign Options')
  await login(page, 'lead1')
  await openAssignments(page)

  const options = await page.getByTestId(`assignments-reassign-input-${id}`).locator('option').allTextContents()

  expect(options).toEqual(['Choose a coordinator', 'coord1', 'coord2', 'leadcoord1', 'multi1'])
  expect((await detail('coord1', id)).assigned_coordinator).toBe('coord1')
})

// @tc: TC-SCRUM-44-06
// @test: reassigning to the current coordinator is refused and nothing changes
// @story: SCRUM-44
// @ac: 2
test('reassigning to the current coordinator is refused and nothing changes', async ({ page }) => {
  const id = await planningRequest('Reassign Same')
  const before = [await noticeCount('coord1', 'Reassign Same'), await noticeCount('org2', 'Reassign Same')]
  await login(page, 'lead1')
  await openAssignments(page)

  await reassignInPage(page, id, 'coord1')

  await expect(page.getByTestId('assignments-banner')).toHaveText('This event is already assigned to coord1.')
  await page.reload()
  await expect(page.getByTestId(`assignments-coordinator-${id}`)).toHaveText('coord1')
  await expect(page.getByTestId(`assignments-status-${id}`)).toHaveText('Planning')
  expect([await noticeCount('coord1', 'Reassign Same'), await noticeCount('org2', 'Reassign Same')]).toEqual(before)
})

// @tc: TC-SCRUM-44-07
// @test: reassigning leaves the event's information and arrangements untouched
// @story: SCRUM-44
// @ac: 3
test("reassigning leaves the event's information and arrangements untouched", async ({ page }) => {
  const id = await approvedRequest('Reassign Arrangements')
  const bookingId = await as('coord1', async (api) => {
    const raised = await api.post(`/api/requests/${id}/bookings`, { data: { venue_id: SEMINAR_ROOM_1 } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
  const holdId = await as('coord1', async (api) => {
    const placed = await api.post(`/api/requests/${id}/holds`, {
      data: { venue_id: AUDITORIUM, expiry_date: inDays(10), expiry_time: '17:00' },
    })
    expect(placed.status()).toBe(201)
    return (await placed.json()).id
  })
  const shown = async () => {
    await page.reload()
    const ids = [
      'request-detail-name',
      'request-detail-purpose',
      'request-detail-date',
      'request-detail-attendance',
      'request-detail-status',
      `request-detail-booking-venue-${bookingId}`,
      `request-detail-booking-status-${bookingId}`,
      `request-detail-hold-venue-${holdId}`,
      `request-detail-hold-status-${holdId}`,
    ]
    return Promise.all(ids.map((testId) => page.getByTestId(testId).textContent()))
  }
  await login(page, 'lead1')
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  const before = await shown()

  await reassignAsLead(id)

  await page.goto(`/requests/${id}`)
  expect(await shown()).toEqual(before)
  expect(before.slice(-4)).toEqual(['Seminar Room 1', 'Requested', 'Auditorium', 'Held'])
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
})

// @tc: TC-SCRUM-44-08
// @test: the new coordinator gains the event and the previous coordinator loses it
// @story: SCRUM-44
// @ac: 4
test('the new coordinator gains the event and the previous coordinator loses it', async ({ page }) => {
  const id = await approvedRequest('Reassign Access')
  await reassignAsLead(id)

  await login(page, 'coord2')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page.getByTestId('request-detail-name')).toHaveText('Reassign Access')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')

  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()
  await expect(page.getByTestId('requests-title')).toBeVisible()
  await expect(page.getByTestId(`requests-row-${id}`)).toHaveCount(0)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-name')).toHaveCount(0)
  expect((await detail('coord2', id)).assigned_coordinator).toBe('coord2')
})

// @tc: TC-SCRUM-44-09
// @test: both coordinators are notified
// @story: SCRUM-44
// @ac: 5
test('both coordinators are notified', async ({ page }) => {
  const id = await planningRequest('Reassign Notice')
  await reassignAsLead(id)

  await login(page, 'coord2')
  await page.getByTestId('layout-nav-notifications').click()
  await expect(notice(page, 'Reassign Notice')).toHaveCount(1)
  await expect(notice(page, 'Reassign Notice')).toHaveText('You have been assigned the event "Reassign Notice".')

  await login(page, 'coord1')
  await page.getByTestId('layout-nav-notifications').click()
  // Newest first: the reassignment, then the Lead's first assignment of the event to coord1.
  await expect(notice(page, 'Reassign Notice')).toHaveText([
    'The event "Reassign Notice" has been reassigned to coord2.',
    'You have been assigned the event "Reassign Notice".',
  ])
})

// @tc: TC-SCRUM-44-10
// @test: the Event Organiser is notified and sees the new coordinator
// @story: SCRUM-44
// @ac: 5
test('the Event Organiser is notified and sees the new coordinator', async ({ page }) => {
  const id = await approvedRequest('Reassign Organiser')
  const org1Before = await noticeCount('org1', 'Reassign Organiser')
  await reassignAsLead(id, 'coord2', 'leadcoord1')

  await login(page, 'org2')
  await page.getByTestId('layout-nav-notifications').click()
  await expect(notice(page, 'Reassign Organiser').first()).toHaveText(
    'coord2 has been assigned to your event "Reassign Organiser".',
  )
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.getByTestId('request-detail-assigned-by')).toHaveText('leadcoord1')
  expect(await noticeCount('org1', 'Reassign Organiser')).toBe(org1Before)
})

// @tc: TC-SCRUM-44-11
// @test: an account without the Lead role cannot reassign, even the event's own coordinator
// @story: SCRUM-44
// @ac: 6
test("an account without the Lead role cannot reassign, even the event's own coordinator", async ({ page }) => {
  const id = await planningRequest('Reassign Refused')
  const before = await noticeCount('org2', 'Reassign Refused')
  await login(page, 'coord1')
  await expect(page.getByTestId('layout-nav-assignments')).toHaveCount(0)

  await page.goto('/assignments')
  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.locator('[data-testid^="assignments-reassign-"]')).toHaveCount(0)
  const refused = await page.request.post(`/api/requests/${id}/reassign`, { data: { coordinator_id: 1 } })

  expect(refused.status()).toBe(403)
  const stored = await detail('coord1', id)
  expect(stored.assigned_coordinator).toBe('coord1')
  expect(stored.status).toBe('Planning')
  expect(await noticeCount('org2', 'Reassign Refused')).toBe(before)
})
