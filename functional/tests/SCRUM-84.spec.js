import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead, startPlanning } from './helpers/assign.js'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-84 Place a Tentative Venue Hold. TC-SCRUM-84-01 and 03 to 10 (test-case
// sheet), one test per row in the row's order.
//
// TC-SCRUM-84-02 (placing the first hold on an Approved event moves it to
// Planning) has no test here and is proved by backend/tests/test_venue_holds.py
// (test_the_first_hold_on_an_approved_event_moves_it_to_planning). SCRUM-86 now
// lets an Approved event with an assigned coordinator be built through the app
// (approvedEvent below), so a Playwright test for the row is possible.
//
// Every row builds its own venue, with 30 minutes of setup and of turnaround as
// the curated preconditions give Seminar Room 1, and its own events through the
// API (AUTOMATION.md: data a test changes it creates itself; changing Seminar
// Room 1's times would change every other spec's venue). The Event
// Coordinator Lead assigns the coordinator (SCRUM-86), so "coord1" and "coord2"
// in the rows are coord1 for every event here, read from the event. Each event falls on a
// Saturday of its own, like 5 Dec 2026 in the rows, 10:00–12:00, so it occupies
// its venue 09:30–12:30; the app clock is pinned to the Tuesday before, 09:00,
// as the rows pin 2026-12-01 09:00 against 2026-12-05. Dates are relative to
// today because an event cannot be submitted for a date already past.

const BASE_URL = 'http://localhost:5173'
const SETUP = { setup_time: 30, turnaround_time: 30 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-84',
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

test.beforeEach(() => clearClock())
test.afterEach(() => clearClock())

const pad = (value) => String(value).padStart(2, '0')
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// The row's Saturday (its "5 Dec 2026"), well ahead and one per row, so no
// row's events meet another's; and the days around it the row names.
function daysFor(offset) {
  const saturday = new Date()
  saturday.setDate(saturday.getDate() + 90 + offset * 7)
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7))
  const shift = (days) => {
    const day = new Date(saturday)
    day.setDate(day.getDate() + days)
    return iso(day)
  }
  return { event: iso(saturday), dayBefore: shift(-1), now: shift(-4) }
}

// '2026-12-05' -> '05 Dec 2026' (app/format.js formatDate).
function shown(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`
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

async function as(username, work) {
  const api = await apiAs(username)
  try {
    return await work(api)
  } finally {
    await api.dispose()
  }
}

// A venue of the row's own, with 30 minutes of setup and turnaround.
async function ownVenue(name) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 60 } })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const timed = await staff.patch(`/api/venues/${id}/times`, { data: SETUP })
    expect(timed.ok()).toBeTruthy()
    return id
  })
}

// An Approved event with its assigned coordinator: org1 submits it, the Lead
// assigns coord1 and coord1 approves it. Approving leaves it Approved.
async function approvedEvent(name, date, start = '10:00', end = '12:00') {
  const id = await as('org1', async (organiser) => {
    const submitted = await organiser.post('/api/requests', {
      data: { name, ...TEXT_FIELDS, date, start_time: start, end_time: end, attendance: 40 },
    })
    expect(submitted.status()).toBe(201)
    return (await submitted.json()).id
  })
  await assignAsLead(id)
  const body = await as('coord1', async (coordinator) => {
    const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
    return approved.json()
  })
  expect(body.status).toBe('Approved')
  return { id, name, coordinator: body.assigned_coordinator }
}

// The rows' "Planning event": the same, started on its way to Planning with the
// first booking request (SCRUM-86 AC8), which is withdrawn so nothing is booked.
async function planningEvent(name, date, start, end) {
  const event = await approvedEvent(name, date, start, end)
  await startPlanning(event.id, event.coordinator)
  return event
}

async function raiseBooking(event, venueId) {
  return as(event.coordinator, async (coordinator) => {
    const raised = await coordinator.post(`/api/requests/${event.id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
}

async function approveBooking(venueId, bookingId) {
  await as('venue1', async (staff) => {
    const decided = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/approve`, { data: {} })
    expect(decided.ok()).toBeTruthy()
  })
}

// A precondition hold, placed through the API by the event's assigned coordinator.
async function placeHoldFor(event, venueId, expiryDate, expiryTime = '17:00') {
  return as(event.coordinator, async (coordinator) => {
    const placed = await coordinator.post(`/api/requests/${event.id}/holds`, {
      data: { venue_id: venueId, expiry_date: expiryDate, expiry_time: expiryTime },
    })
    expect(placed.status()).toBe(201)
    return (await placed.json()).id
  })
}

async function holdsOf(event) {
  return as('coord1', async (coordinator) => (await coordinator.get(`/api/requests/${event.id}/holds`)).json())
}

async function placeHoldInPage(page, venueId, expiryDate, expiryTime) {
  await page.getByTestId('request-detail-place-hold-button').click()
  await page.getByTestId('request-detail-hold-venue-input').selectOption(String(venueId))
  await page.getByTestId('request-detail-hold-expiry-date-input').fill(expiryDate)
  await page.getByTestId('request-detail-hold-expiry-time-input').fill(expiryTime)
  await page.getByTestId('request-detail-hold-confirm-button').click()
}

// @tc: TC-SCRUM-84-01
// @test: the assigned coordinator holds a venue for a Planning event; it shows Held on the request page and the calendar
// @story: SCRUM-84
// @ac: 1, 2, 5, 8
test('the assigned coordinator holds a venue for a Planning event; it shows Held on the request page and the calendar', async ({
  page,
}) => {
  const days = daysFor(1)
  const venue = await ownVenue('TC84-01 Room')
  const holder = await planningEvent('TC84-01 Hold Seminar', days.event)
  const morning = await planningEvent('TC84-01 Morning Talk', days.dayBefore)
  await approveBooking(venue, await raiseBooking(morning, venue))
  const evening = await planningEvent('TC84-01 Evening Talk', days.event, '14:00', '16:00')
  const eveningBooking = await raiseBooking(evening, venue)
  pinClock(`${days.now}T09:00`)

  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await placeHoldInPage(page, venue, days.event, '09:59')

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold placed')
  const [hold] = await holdsOf(holder)
  await expect(page.getByTestId(`request-detail-hold-venue-${hold.id}`)).toHaveText('TC84-01 Room')
  await expect(page.getByTestId(`request-detail-hold-period-${hold.id}`)).toHaveText(`${shown(days.event)}, 09:30–12:30`)
  await expect(page.getByTestId(`request-detail-hold-status-${hold.id}`)).toHaveText('Held')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')

  // The calendar opens on the browser's own week: the week of the event.
  await page.clock.setFixedTime(new Date(`${days.event}T12:00:00`))
  await page.goto(`/venues/${venue}/availability`)
  const holdKey = `hold-${hold.id}-${days.event}`
  await expect(page.getByTestId(`venue-availability-entry-status-${holdKey}`)).toHaveText('Held')
  await expect(page.getByTestId(`venue-availability-entry-name-${holdKey}`)).toHaveText('TC84-01 Hold Seminar')
  await expect(page.getByTestId(`venue-availability-entry-period-${holdKey}`)).toHaveText(
    `${shown(days.event)}, 09:30 to ${shown(days.event)}, 12:30`,
  )
  const morningBooking = (await (await page.request.get(`/api/venues/${venue}/bookings`)).json()).find(
    (row) => row.event_request_name === 'TC84-01 Morning Talk',
  )
  await expect(
    page.getByTestId(`venue-availability-entry-status-booking-${morningBooking.id}-${days.dayBefore}`),
  ).toHaveText('Approved')
  await expect(page.getByTestId(`venue-availability-entry-status-booking-${eveningBooking}-${days.event}`)).toHaveText(
    'Pending',
  )
})

// @tc: TC-SCRUM-84-03
// @test: a hold whose expiry is exactly the current time is refused and nothing is recorded
// @story: SCRUM-84
// @ac: 2
test('a hold whose expiry is exactly the current time is refused and nothing is recorded', async ({ page }) => {
  const days = daysFor(3)
  const venue = await ownVenue('TC84-03 Room')
  const holder = await planningEvent('TC84-03 Hold Seminar', days.event)
  pinClock(`${days.now}T09:00`)

  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await placeHoldInPage(page, venue, days.now, '09:00')

  await expect(page.getByTestId('request-detail-banner')).toHaveText('The expiry must be in the future.')
  await page.reload()
  await expect(page.getByTestId('request-detail-holds-empty')).toBeVisible()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-84-04
// @test: a hold whose expiry is exactly the event's published start is refused and nothing is recorded
// @story: SCRUM-84
// @ac: 2
test("a hold whose expiry is exactly the event's published start is refused and nothing is recorded", async ({
  page,
}) => {
  const days = daysFor(4)
  const venue = await ownVenue('TC84-04 Room')
  const holder = await planningEvent('TC84-04 Hold Seminar', days.event)
  pinClock(`${days.now}T09:00`)

  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await placeHoldInPage(page, venue, days.event, '10:00')

  await expect(page.getByTestId('request-detail-banner')).toHaveText("The expiry must be before the event's start.")
  await page.reload()
  await expect(page.getByTestId('request-detail-holds-empty')).toBeVisible()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-84-05
// @test: a hold overlapping another event's Held hold is refused, naming that event
// @story: SCRUM-84
// @ac: 3
test("a hold overlapping another event's Held hold is refused, naming that event", async ({ page }) => {
  const days = daysFor(5)
  const venue = await ownVenue('TC84-05 Room')
  const holder = await planningEvent('TC84-05 Hold Seminar', days.event)
  const rival = await planningEvent('TC84-05 Rival Workshop', days.event)
  pinClock(`${days.now}T09:00`)
  const rivalHold = await placeHoldFor(rival, venue, days.dayBefore)

  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await placeHoldInPage(page, venue, days.dayBefore, '17:00')

  await expect(page.getByTestId('request-detail-banner')).toHaveText(
    `This venue is already committed for an overlapping period: TC84-05 Rival Workshop, ${shown(days.event)}, 10:00–12:00.`,
  )
  await page.reload()
  await expect(page.getByTestId('request-detail-holds-empty')).toBeVisible()
  expect((await holdsOf(rival)).map((hold) => [hold.id, hold.status])).toEqual([[rivalHold, 'Held']])
})

// @tc: TC-SCRUM-84-06
// @test: a hold beginning exactly when another event's Approved booking's occupied period ends is placed
// @story: SCRUM-84
// @ac: 3
test("a hold beginning exactly when another event's Approved booking's occupied period ends is placed", async ({
  page,
}) => {
  const days = daysFor(6)
  const venue = await ownVenue('TC84-06 Room')
  const holder = await planningEvent('TC84-06 Hold Seminar', days.event)
  // 08:30–09:00 plus 30 minutes of turnaround occupies the venue until 09:30.
  const early = await planningEvent('TC84-06 Early Briefing', days.event, '08:30', '09:00')
  const earlyBooking = await raiseBooking(early, venue)
  await approveBooking(venue, earlyBooking)
  pinClock(`${days.now}T09:00`)

  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await placeHoldInPage(page, venue, days.dayBefore, '17:00')

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold placed')
  const [hold] = await holdsOf(holder)
  await expect(page.getByTestId(`request-detail-hold-period-${hold.id}`)).toHaveText(`${shown(days.event)}, 09:30–12:30`)
  await expect(page.getByTestId(`request-detail-hold-status-${hold.id}`)).toHaveText('Held')
  const bookings = await (await page.request.get(`/api/venues/${venue}/bookings`)).json()
  expect(bookings.find((row) => row.id === earlyBooking).status).toBe('Approved')
})

// @tc: TC-SCRUM-84-07
// @test: venue1 cannot approve another event's request overlapping a Held hold; the refusal names the holding event
// @story: SCRUM-84
// @ac: 4
test("venue1 cannot approve another event's request overlapping a Held hold; the refusal names the holding event", async ({
  page,
}) => {
  const days = daysFor(7)
  const venue = await ownVenue('TC84-07 Room')
  const holder = await planningEvent('TC84-07 Hold Seminar', days.event)
  const rival = await planningEvent('TC84-07 Rival Workshop', days.event)
  pinClock(`${days.now}T09:00`)
  await placeHoldFor(holder, venue, days.dayBefore)
  const rivalBooking = await raiseBooking(rival, venue)

  await login(page, 'venue1')
  await page.goto(`/venues/${venue}`)
  await page.getByTestId(`venue-detail-booking-approve-button-${rivalBooking}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText(
    `This venue is already committed for an overlapping period: TC84-07 Hold Seminar, ${shown(days.event)}, 10:00–12:00.`,
  )
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${rivalBooking}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-84-08
// @test: for another event, search leaves out the held venue and choosing it warns naming the hold
// @story: SCRUM-84
// @ac: 4
test('for another event, search leaves out the held venue and choosing it warns naming the hold', async ({ page }) => {
  const days = daysFor(8)
  const venue = await ownVenue('TC84-08 Room')
  // A free venue of the row's own, standing in for the row's Auditorium, which
  // other specs may book: search must still list what is free.
  const spare = await ownVenue('TC84-08 Spare Room')
  const holder = await planningEvent('TC84-08 Hold Seminar', days.event)
  const rival = await planningEvent('TC84-08 Rival Workshop', days.event)
  pinClock(`${days.now}T09:00`)
  const hold = await placeHoldFor(holder, venue, days.dayBefore)

  await login(page, rival.coordinator)
  await page.goto(`/requests/${rival.id}`)
  await page.getByTestId('request-detail-search-venues-button').click()

  await expect(page.getByTestId(`venue-search-row-${spare}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${venue}`)).toHaveCount(0)

  await page.getByTestId('venue-search-back-link').click()
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption(String(venue))

  await expect(page.getByTestId(`booking-new-warning-hold-${hold}`)).toHaveText(
    `The venue is held for TC84-08 Hold Seminar, ${shown(days.event)}, 10:00–12:00.`,
  )
})

// @tc: TC-SCRUM-84-09
// @test: approving the holding event's own request for the held venue succeeds and releases the hold
// @story: SCRUM-84
// @ac: 6
test("approving the holding event's own request for the held venue succeeds and releases the hold", async ({
  page,
}) => {
  const days = daysFor(9)
  const venue = await ownVenue('TC84-09 Room')
  const holder = await planningEvent('TC84-09 Hold Seminar', days.event)
  pinClock(`${days.now}T09:00`)
  const hold = await placeHoldFor(holder, venue, days.dayBefore)
  const booking = await raiseBooking(holder, venue)

  await login(page, 'venue1')
  await page.goto(`/venues/${venue}`)
  await page.getByTestId(`venue-detail-booking-approve-button-${booking}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId(`venue-detail-booking-status-${booking}`)).toHaveText('Approved')
  await expect(page.getByTestId('venue-detail-banner')).not.toContainText('already committed')

  await logout(page)
  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await expect(page.getByTestId(`request-detail-hold-status-${hold}`)).toHaveText('Released')
})

// @tc: TC-SCRUM-84-10
// @test: the assigned coordinator releases a hold; it shows Released and the venue is searchable again
// @story: SCRUM-84
// @ac: 7
test('the assigned coordinator releases a hold; it shows Released and the venue is searchable again', async ({
  page,
}) => {
  const days = daysFor(10)
  const venue = await ownVenue('TC84-10 Room')
  const holder = await planningEvent('TC84-10 Hold Seminar', days.event)
  const rival = await planningEvent('TC84-10 Rival Workshop', days.event)
  pinClock(`${days.now}T09:00`)
  const hold = await placeHoldFor(holder, venue, days.dayBefore)

  await login(page, holder.coordinator)
  await page.goto(`/requests/${holder.id}`)
  await page.getByTestId(`request-detail-hold-release-button-${hold}`).click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold released')
  await expect(page.getByTestId(`request-detail-hold-status-${hold}`)).toHaveText('Released')

  await logout(page)
  await login(page, rival.coordinator)
  await page.goto(`/requests/${rival.id}`)
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page.getByTestId(`venue-search-row-${venue}`)).toBeVisible()
})
