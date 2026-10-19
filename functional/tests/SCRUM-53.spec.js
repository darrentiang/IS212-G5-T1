import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead, startPlanning } from './helpers/assign.js'

// SCRUM-53 Send an Event for Safety Check. TC-SCRUM-53-01 through 12 (test-case
// sheet), one test per row in the row's order.
//
// Every event a row sends it creates itself through the API under its own
// name, on its own venue and date (AUTOMATION.md): org2 submits it, the Event
// Coordinator Lead assigns a coordinator (SCRUM-86) who approves it, the
// coordinator raises a booking (which moves it to Planning) and venue1 approves
// it. "The assigned coordinator" is whoever the Lead assigned, read from the event.
//
// Rows 05, 06 and 07 were pending SCRUM-82 (the Venue unavailable marker) and
// SCRUM-48/81 (equipment requirements) and run now that those are merged: the
// marker comes from a block venue1 puts over the Approved booking, and the
// requirements are recorded by the assigned coordinator and reviewed by tech1
// through the API. Row 09 uses SCRUM-90's Request changes control.

const BASE_URL = 'http://localhost:5173'

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-53',
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
  await expect(page.getByTestId('login-submit-button')).toBeVisible()
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

// A date well ahead, one per row, so no row's approved booking meets another's.
function dateFor(offset) {
  const date = new Date()
  date.setDate(date.getDate() + 90 + offset)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

async function ownVenue(name) {
  const staff = await apiAs('venue1')
  const resp = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 100 } })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await staff.dispose()
  return id
}

// A Planning event, assigned to a coordinator by the Lead, with one booking
// per venue id, each left Requested or approved by venue1.
async function planningEvent(name, offset, { venues = [], approve = true } = {}) {
  // Submitted by org2, not org1: the Lead's assignment notifies the Organiser
  // (SCRUM-86 AC6), and SCRUM-58.spec.js, which runs after this file, reads
  // org1's seeded notifications and expects no others.
  const organiser = await apiAs('org2')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      ...TEXT_FIELDS,
      date: dateFor(offset),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 40,
    },
  })
  expect(submitted.status()).toBe(201)
  const { id } = await submitted.json()
  await organiser.dispose()

  await assignAsLead(id)
  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  const body = await approved.json()
  expect(body.status).toBe('Approved')

  const bookingIds = []
  for (const venueId of venues) {
    const raised = await coordinator.post(`/api/requests/${id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    bookingIds.push((await raised.json()).id)
  }
  await coordinator.dispose()

  if (approve && venues.length > 0) {
    const staff = await apiAs('venue1')
    for (const [index, venueId] of venues.entries()) {
      const decided = await staff.post(`/api/venues/${venueId}/bookings/${bookingIds[index]}/approve`, {
        data: {},
      })
      expect(decided.ok()).toBeTruthy()
    }
    await staff.dispose()
  }
  return { id, name, coordinator: body.assigned_coordinator, bookingIds }
}

// A block venue1 puts over the venue for the whole day of offset, which marks
// the event's Approved booking there Venue unavailable (SCRUM-82).
async function blockVenue(venueId, offset) {
  const staff = await apiAs('venue1')
  const day = dateFor(offset)
  const created = await staff.post(`/api/venues/${venueId}/blocks`, {
    data: { start_date: day, start_time: '08:00', end_date: day, end_time: '20:00', reason: 'Maintenance for SCRUM-53' },
  })
  expect(created.status()).toBe(201)
  await staff.dispose()
}

async function typeId(api, name) {
  const types = await (await api.get('/api/equipment')).json()
  const found = types.find((row) => row.name === name)
  expect(found, `equipment type ${name}`).toBeTruthy()
  return found.id
}

// The assigned coordinator records a requirement (it starts Requested); tech1
// then approves it when approve is true (SCRUM-48 and SCRUM-81).
async function recordRequirement(event, typeName, quantity, { approve = false } = {}) {
  const coordinator = await apiAs(event.coordinator)
  const recorded = await coordinator.post(`/api/requests/${event.id}/equipment`, {
    data: { equipment_type_id: await typeId(coordinator, typeName), quantity },
  })
  expect(recorded.status()).toBe(201)
  const { id } = await recorded.json()
  await coordinator.dispose()
  if (approve) {
    const staff = await apiAs('tech1')
    const decided = await staff.patch(`/api/requests/${event.id}/equipment/${id}/decision`, {
      data: { decision: 'Approved' },
    })
    expect(decided.ok()).toBeTruthy()
    await staff.dispose()
  }
  return id
}

async function requirementsOf(event) {
  const staff = await apiAs('tech1')
  const detail = await (await staff.get(`/api/requests/${event.id}/equipment`)).json()
  await staff.dispose()
  return detail.requirements.map((row) => `${row.equipment_type_name}, ${row.quantity} (${row.status})`)
}

async function openEvent(page, name) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByTestId('request-detail-fields')).toContainText(name)
}

async function sendAs(page, event) {
  await login(page, event.coordinator)
  await openEvent(page, event.name)
  await page.getByTestId('request-detail-send-safety-button').click()
}

// @tc: TC-SCRUM-53-01
// @test: the assigned coordinator sends a ready event and it moves to Safety Check, not Confirmed
// @story: SCRUM-53
// @ac: 1, 2, 4, 8
test('the assigned coordinator sends a ready event and it moves to Safety Check, not Confirmed', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 01')
  const event = await planningEvent('SCRUM-53 TC-01 Send Gala', 1, { venues: [venue] })

  await sendAs(page, event)

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Sent for safety check')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-status')).not.toHaveText('Confirmed')
  await expect(page.getByTestId('request-detail-safety-check-at')).toBeVisible()

  const bookings = await (await page.request.get(`/api/venues/${venue}/bookings`)).json()
  expect(bookings.filter((item) => item.event_request_name === event.name).map((item) => item.status)).toEqual([
    'Approved',
  ])
})

// @tc: TC-SCRUM-53-02
// @test: a sent event appears in the Safety Officer's list with the time it was sent
// @story: SCRUM-53
// @ac: 4
test("a sent event appears in the Safety Officer's list with the time it was sent", async ({ page }) => {
  const venue = await ownVenue('TC53 Room 02')
  const event = await planningEvent('SCRUM-53 TC-02 Listed Gala', 2, { venues: [venue] })

  await sendAs(page, event)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  const sent = await page.getByTestId('request-detail-safety-check-at').textContent()
  await logout(page)

  await login(page, 'safety1')
  await openEvent(page, event.name)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-sent-at')).toHaveText(sent)
})

// @tc: TC-SCRUM-53-03
// @test: an event with no Approved venue booking is refused and the missing booking is listed
// @story: SCRUM-53
// @ac: 2, 3
test('an event with no Approved venue booking is refused and the missing booking is listed', async ({ page }) => {
  const event = await planningEvent('SCRUM-53 TC-03 Bare Gala', 3)
  await startPlanning(event.id, event.coordinator)

  await sendAs(page, event)

  await expect(page.getByTestId('request-detail-banner')).toContainText('No Approved venue booking')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-safety-check-at')).toHaveCount(0)
})

// @tc: TC-SCRUM-53-04
// @test: a booking request still awaiting a decision is refused, and every outstanding item is listed
// @story: SCRUM-53
// @ac: 2, 3
test('a booking request still awaiting a decision is refused, and every outstanding item is listed', async ({
  page,
}) => {
  const venue = await ownVenue('TC53 Room 04')
  const event = await planningEvent('SCRUM-53 TC-04 Waiting Gala', 4, { venues: [venue], approve: false })

  await sendAs(page, event)

  const banner = page.getByTestId('request-detail-banner')
  await expect(banner).toContainText('No Approved venue booking')
  await expect(banner).toContainText('TC53 Room 04 is awaiting a decision')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  const bookings = await (await page.request.get(`/api/venues/${venue}/bookings`)).json()
  expect(bookings.filter((item) => item.event_request_name === event.name).map((item) => item.status)).toEqual([
    'Requested',
  ])
})

// @tc: TC-SCRUM-53-05
// @test: an Approved booking marked Venue unavailable is refused and listed
// @story: SCRUM-53
// @ac: 2, 3
test('an Approved booking marked Venue unavailable is refused and listed', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 05')
  const event = await planningEvent('SCRUM-53 TC-05 Blocked Gala', 5, { venues: [venue] })
  await blockVenue(venue, 5)

  await sendAs(page, event)

  await expect(page.getByTestId('request-detail-banner')).toContainText(
    'The booking at TC53 Room 05 is marked Venue unavailable',
  )
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-safety-check-at')).toHaveCount(0)
  const bookings = await (await page.request.get(`/api/venues/${venue}/bookings`)).json()
  expect(bookings.filter((item) => item.event_request_name === event.name).map((item) => item.status)).toEqual([
    'Approved',
  ])
})

// @tc: TC-SCRUM-53-06
// @test: an equipment requirement that is not Approved is refused and listed
// @story: SCRUM-53
// @ac: 2, 3
test('an equipment requirement that is not Approved is refused and listed', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 06')
  const event = await planningEvent('SCRUM-53 TC-06 Gear Gala', 6, { venues: [venue] })
  await recordRequirement(event, 'Projector', 2)

  await sendAs(page, event)

  await expect(page.getByTestId('request-detail-banner')).toContainText('Projector, 2 (Requested)')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  expect(await requirementsOf(event)).toEqual(['Projector, 2 (Requested)'])
})

// @tc: TC-SCRUM-53-07
// @test: when every equipment requirement is Approved the event is sent
// @story: SCRUM-53
// @ac: 2
test('when every equipment requirement is Approved the event is sent', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 07')
  const event = await planningEvent('SCRUM-53 TC-07 Ready Gear Gala', 7, { venues: [venue] })
  await recordRequirement(event, 'Projector', 2, { approve: true })
  await recordRequirement(event, 'Microphones', 3, { approve: true })

  await sendAs(page, event)

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Sent for safety check')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-check-at')).toBeVisible()
  expect(await requirementsOf(event)).toEqual(['Projector, 2 (Approved)', 'Microphones, 3 (Approved)'])
})

// @tc: TC-SCRUM-53-08
// @test: an event already in Safety Check cannot be sent again
// @story: SCRUM-53
// @ac: 1
test('an event already in Safety Check cannot be sent again', async ({ browser }) => {
  const venue = await ownVenue('TC53 Room 08')
  const event = await planningEvent('SCRUM-53 TC-08 Twice Gala', 8, { venues: [venue] })
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()

  await login(first, event.coordinator)
  await openEvent(first, event.name)
  const address = first.url()
  await second.goto(address)
  await expect(second.getByTestId('request-detail-send-safety-button')).toBeVisible()

  await first.getByTestId('request-detail-send-safety-button').click()
  await expect(first.getByTestId('request-detail-status')).toHaveText('Safety Check')
  const firstSent = await first.getByTestId('request-detail-safety-check-at').textContent()

  await second.getByTestId('request-detail-send-safety-button').click()
  await expect(second.getByTestId('request-detail-banner')).toContainText('Only an event in Planning')
  await expect(second.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(second.getByTestId('request-detail-safety-check-at')).toHaveText(firstSent)
  await context.close()
})

// @tc: TC-SCRUM-53-09
// @test: an event returned by the Safety Officer can be sent again, and the requested changes are then gone
// @story: SCRUM-53
// @ac: 5
test('an event returned by the Safety Officer can be sent again, and the requested changes are then gone', async ({
  page,
}) => {
  const venue = await ownVenue('TC53 Room 09')
  const event = await planningEvent('SCRUM-53 TC-09 Loop Gala', 9, { venues: [venue] })

  await sendAs(page, event)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await logout(page)

  await login(page, 'safety1')
  await openEvent(page, event.name)
  await page.getByTestId('request-detail-safety-area-venue-arrangements').check()
  await page.getByTestId('request-detail-safety-reason-input').fill('Stage blocks the exit')
  await page.getByTestId('request-detail-safety-request-changes-button').click()
  await expect(page.getByTestId('requests-banner')).toBeVisible()
  await logout(page)

  await login(page, event.coordinator)
  await openEvent(page, event.name)
  await expect(page.getByTestId('request-detail-requested-changes-reason')).toHaveText('Stage blocks the exit')
  await page.getByTestId('request-detail-send-safety-button').click()

  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-requested-changes')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-safety-decisions')).toContainText('Stage blocks the exit')
})

// @tc: TC-SCRUM-53-10
// @test: while the event is in Safety Check a venue booking request cannot be added
// @story: SCRUM-53
// @ac: 6
test('while the event is in Safety Check a venue booking request cannot be added', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 10')
  const other = await ownVenue('TC53 Room 10b')
  const event = await planningEvent('SCRUM-53 TC-10 Locked Gala', 10, { venues: [venue] })

  await sendAs(page, event)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-raise-booking-button')).toHaveCount(0)

  await page.goto(`/requests/${event.id}/bookings/new`)
  await page.getByTestId('booking-new-venue-input').selectOption(String(other))
  await page.getByTestId('booking-new-raise-button').click()
  await expect(page.getByTestId('booking-new-banner')).toContainText('Approved or Planning')

  const bookings = await (await page.request.get(`/api/venues/${other}/bookings`)).json()
  expect(bookings.filter((item) => item.event_request_name === event.name)).toHaveLength(0)
})

// @tc: TC-SCRUM-53-11
// @test: a coordinator who is not assigned to the event cannot send it
// @story: SCRUM-53
// @ac: 7
test('a coordinator who is not assigned to the event cannot send it', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 11')
  const event = await planningEvent('SCRUM-53 TC-11 Other Gala', 11, { venues: [venue] })
  const other = ['coord1', 'coord2'].find((name) => name !== event.coordinator)

  await login(page, other)
  await openEvent(page, event.name)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-send-safety-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-safety-check-at')).toHaveCount(0)
})

// @tc: TC-SCRUM-53-12
// @test: an account that is not an Event Coordinator cannot send the event
// @story: SCRUM-53
// @ac: 7
test('an account that is not an Event Coordinator cannot send the event', async ({ page }) => {
  const venue = await ownVenue('TC53 Room 12')
  const event = await planningEvent('SCRUM-53 TC-12 Org Gala', 12, { venues: [venue] })

  await login(page, 'org2')
  await openEvent(page, event.name)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-send-safety-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-safety-check-at')).toHaveCount(0)
})
