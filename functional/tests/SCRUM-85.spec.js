import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead, startPlanning } from './helpers/assign.js'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-85 Expire a Tentative Venue Hold. TC-SCRUM-85-01 to 08 (test-case
// sheet), one test per row in the row's order.
//
// The rows name 5 Dec 2026 for the event, and around it 29 Nov (the hold is
// placed), 30 Nov (24 hours before expiry) and 1 Dec, 17:00 (the expiry).
// Here each row has a Saturday of its own, well ahead of today because an
// event cannot be submitted for a date already past, and the same days before
// it: placed 6 days before, warned 5 days before, expiring 4 days before at
// 17:00. The app clock is pinned with CONNECTSPHERE_CLOCK_FILE at the row's
// times, and cleared before and after every test.
//
// Every row builds its own venue, with the 30 minutes of setup and turnaround
// the rows give Seminar Room 1 (changing Seminar Room 1's times would change
// every other spec's venue), and its own events through the API. Approval
// assigns the coordinator by workload, so the rows' "coord1" and "coord2" are
// whoever approval assigned to each event, read from the event.
//
// "New" notifications are those not on the Notifications page when the row
// notes them. One SQLite file is shared by every spec in a run and moving the
// clock can expire other specs' holds too, so a row counts only the new
// notifications about its own event (AUTOMATION.md: a test asserts on its own
// records by name).

const BASE_URL = 'http://localhost:5173'
const SETUP = { setup_time: 30, turnaround_time: 30 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-85',
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

test.beforeEach(() => clearClock())
test.afterEach(() => clearClock())

const pad = (value) => String(value).padStart(2, '0')
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// The row's Saturday (its "5 Dec 2026") and the days before it the row names
// (its "29 Nov", "30 Nov" and "1 Dec"). Offsets stay clear of SCRUM-84's.
function daysFor(offset) {
  const saturday = new Date()
  saturday.setDate(saturday.getDate() + 230 + offset * 7)
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7))
  const shift = (days) => {
    const day = new Date(saturday)
    day.setDate(day.getDate() + days)
    return iso(day)
  }
  return { event: iso(saturday), placed: shift(-6), warned: shift(-5), expiry: shift(-4) }
}

// '2026-12-05' -> '05 Dec 2026' (app/format.js formatDate).
function shown(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`
}

// The curated texts (ui-guidelines.md §7, Hold expiry), with the expiry at 17:00.
const warning = (venue, event, days) => `The hold on ${venue} for ${event} expires ${shown(days.expiry)}, 17:00.`
const expiredNotice = (venue, event, days) =>
  `The hold on ${venue} for ${event} expired ${shown(days.expiry)}, 17:00 and the venue was released.`

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

async function as(username, work) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  try {
    const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
    expect(resp.ok()).toBeTruthy()
    return await work(api)
  } finally {
    await api.dispose()
  }
}

// A venue of the row's own; setup and turnaround of 30 minutes unless told otherwise.
async function ownVenue(name, times = SETUP) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 60 } })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const timed = await staff.patch(`/api/venues/${id}/times`, { data: times })
    expect(timed.ok()).toBeTruthy()
    return id
  })
}

// A Planning event, 10:00–12:00 for 40 people, with its assigned coordinator:
// org1 submits it, the Event Coordinator Lead assigns coord1 (SCRUM-86) and coord1
// approves it, and its first booking request, withdrawn, starts planning.
async function planningEvent(name, date) {
  const id = await as('org1', async (organiser) => {
    const submitted = await organiser.post('/api/requests', {
      data: { name, ...TEXT_FIELDS, date, start_time: '10:00', end_time: '12:00', attendance: 40 },
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
  await startPlanning(id, body.assigned_coordinator)
  return { id, name, coordinator: body.assigned_coordinator }
}

async function raiseBooking(event, venueId) {
  return as(event.coordinator, async (coordinator) => {
    const raised = await coordinator.post(`/api/requests/${event.id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
}

// The rows' precondition: the assigned coordinator places the hold with the
// clock pinned at the row's "29 Nov 2026, 12:00", expiring "1 Dec 2026, 17:00".
async function placedHold(event, venueId, days) {
  pinClock(`${days.placed}T12:00`)
  return as(event.coordinator, async (coordinator) => {
    const placed = await coordinator.post(`/api/requests/${event.id}/holds`, {
      data: { venue_id: venueId, expiry_date: days.expiry, expiry_time: '17:00' },
    })
    expect(placed.status()).toBe(201)
    return (await placed.json()).id
  })
}

// Every notification on the Notifications page, as id -> message.
async function notifications(page) {
  await page.goto('/notifications')
  await expect(page.getByTestId(/^notifications-(row-\d+|empty)$/).first()).toBeVisible()
  const rows = await page
    .locator('[data-testid^="notifications-message-"]')
    .evaluateAll((elements) => elements.map((element) => [element.dataset.testid, element.textContent.trim()]))
  return new Map(rows)
}

// The messages about this event that were not in ``noted``, oldest first.
async function newAbout(page, noted, event) {
  const now = await notifications(page)
  return [...now]
    .filter(([key, message]) => !noted.has(key) && message.includes(` for ${event.name} `))
    .map(([, message]) => message)
    .reverse()
}

async function approveInPage(page, venueId, bookingId) {
  await page.goto(`/venues/${venueId}`)
  await page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()
}

async function searchFor(page, event) {
  await page.goto(`/requests/${event.id}`)
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page.getByTestId('venue-search-back-link')).toBeVisible()
}

async function holdsOf(event) {
  return as(event.coordinator, async (coordinator) => (await coordinator.get(`/api/requests/${event.id}/holds`)).json())
}

// @tc: TC-SCRUM-85-01
// @test: one minute before expiry the hold still shows Held and keeps the venue from another event
// @story: SCRUM-85
// @ac: 1
test('one minute before expiry the hold still shows Held and keeps the venue from another event', async ({
  page,
}) => {
  const days = daysFor(1)
  const venue = await ownVenue('TC85-01 Room')
  const gala = await planningEvent('TC85-01 Clock Gala', days.event)
  const rival = await planningEvent('TC85-01 Rival Workshop', days.event)
  const rivalBooking = await raiseBooking(rival, venue)
  const hold = await placedHold(gala, venue, days)
  pinClock(`${days.expiry}T16:59`)

  await login(page, gala.coordinator)
  await page.goto(`/requests/${gala.id}`)
  await expect(page.getByTestId(`request-detail-hold-status-${hold}`)).toHaveText('Held')

  await logout(page)
  await login(page, 'venue1')
  await approveInPage(page, venue, rivalBooking)
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(
    `This venue is already committed for an overlapping period: TC85-01 Clock Gala, ${shown(days.event)}, 10:00–12:00.`,
  )
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${rivalBooking}`)).toHaveText('Requested')

  await logout(page)
  await login(page, rival.coordinator)
  await searchFor(page, rival)
  await expect(page.getByTestId(`venue-search-row-${venue}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-85-02
// @test: at its expiry the hold becomes Expired and the coordinator is told once that the venue was released
// @story: SCRUM-85
// @ac: 1, 3
test('at its expiry the hold becomes Expired and the coordinator is told once that the venue was released', async ({
  page,
}) => {
  const days = daysFor(2)
  const venue = await ownVenue('TC85-02 Room')
  const gala = await planningEvent('TC85-02 Clock Gala', days.event)
  const hold = await placedHold(gala, venue, days)
  pinClock(`${days.expiry}T16:59`)
  await login(page, gala.coordinator)
  const noted = await notifications(page)

  pinClock(`${days.expiry}T17:00`)
  await page.goto(`/requests/${gala.id}`)

  await expect(page.getByTestId(`request-detail-hold-status-${hold}`)).toHaveText('Expired')
  await expect(page.getByTestId(`request-detail-hold-release-button-${hold}`)).toHaveCount(0)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  const expected = [expiredNotice('TC85-02 Room', gala.name, days)]
  expect(await newAbout(page, noted, gala)).toEqual(expected)
  await page.reload()
  expect(await newAbout(page, noted, gala)).toEqual(expected)
})

// @tc: TC-SCRUM-85-03
// @test: after the hold expires another event finds the venue, is approved for it, and the calendar no longer shows the hold
// @story: SCRUM-85
// @ac: 1
test('after the hold expires another event finds the venue, is approved for it, and the calendar no longer shows the hold', async ({
  page,
}) => {
  const days = daysFor(3)
  const venue = await ownVenue('TC85-03 Room')
  const gala = await planningEvent('TC85-03 Clock Gala', days.event)
  const rival = await planningEvent('TC85-03 Rival Workshop', days.event)
  const rivalBooking = await raiseBooking(rival, venue)
  const hold = await placedHold(gala, venue, days)
  pinClock(`${days.expiry}T17:00`)

  await login(page, rival.coordinator)
  await searchFor(page, rival)
  await expect(page.getByTestId(`venue-search-row-${venue}`)).toBeVisible()

  await logout(page)
  await login(page, 'venue1')
  await approveInPage(page, venue, rivalBooking)
  await expect(page.getByTestId(`venue-detail-booking-status-${rivalBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId('venue-detail-banner')).not.toContainText('already committed')

  // The calendar opens on the browser's own week, which the app clock does not
  // pin: the browser is set to the same moment, then Month and Next reach the
  // event's month.
  await page.clock.setFixedTime(new Date(`${days.expiry}T17:00:00`))
  await page.goto(`/venues/${venue}/availability`)
  await page.getByTestId('venue-availability-month-button').click()
  if (days.event.slice(0, 7) !== days.expiry.slice(0, 7)) {
    await page.getByTestId('venue-availability-next-button').click()
  }
  await expect(page.getByTestId(`venue-availability-entry-status-booking-${rivalBooking}-${days.event}`)).toHaveText(
    'Approved',
  )
  await expect(page.getByTestId(`venue-availability-entry-row-hold-${hold}-${days.event}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-85-04
// @test: with 24 hours and one minute left no warning is sent
// @story: SCRUM-85
// @ac: 2
test('with 24 hours and one minute left no warning is sent', async ({ page }) => {
  const days = daysFor(4)
  const venue = await ownVenue('TC85-04 Room')
  const gala = await planningEvent('TC85-04 Clock Gala', days.event)
  await placedHold(gala, venue, days)
  await login(page, gala.coordinator)
  const noted = await notifications(page)

  pinClock(`${days.warned}T16:59`)
  await page.reload()

  expect(await newAbout(page, noted, gala)).toEqual([])
})

// @tc: TC-SCRUM-85-05
// @test: with exactly 24 hours left the coordinator is warned once and not again an hour later
// @story: SCRUM-85
// @ac: 2
test('with exactly 24 hours left the coordinator is warned once and not again an hour later', async ({ page }) => {
  const days = daysFor(5)
  const venue = await ownVenue('TC85-05 Room')
  const gala = await planningEvent('TC85-05 Clock Gala', days.event)
  await placedHold(gala, venue, days)
  pinClock(`${days.warned}T16:59`)
  await login(page, gala.coordinator)
  const noted = await notifications(page)
  const expected = [warning('TC85-05 Room', gala.name, days)]

  pinClock(`${days.warned}T17:00`)
  await page.reload()
  expect(await newAbout(page, noted, gala)).toEqual(expected)

  pinClock(`${days.warned}T18:00`)
  await page.reload()
  expect(await newAbout(page, noted, gala)).toEqual(expected)
})

// @tc: TC-SCRUM-85-06
// @test: a hold placed with less than 24 hours to go warns the coordinator straight away
// @story: SCRUM-85
// @ac: 2
test('a hold placed with less than 24 hours to go warns the coordinator straight away', async ({ page }) => {
  const days = daysFor(6)
  const venue = await ownVenue('TC85-06 Room')
  // A venue of the row's own, standing in for the row's Auditorium, which other
  // specs may book; the seeded Auditorium records no setup or turnaround time.
  const hall = await ownVenue('TC85-06 Hall', { setup_time: 0, turnaround_time: 0 })
  const gala = await planningEvent('TC85-06 Clock Gala', days.event)
  await placedHold(gala, venue, days)
  pinClock(`${days.expiry}T10:00`)
  await login(page, gala.coordinator)
  // TC85-06 Room's own warning is due by now and is among the noted ones.
  const noted = await notifications(page)

  await page.goto(`/requests/${gala.id}`)
  await page.getByTestId('request-detail-place-hold-button').click()
  await page.getByTestId('request-detail-hold-venue-input').selectOption(String(hall))
  await page.getByTestId('request-detail-hold-expiry-date-input').fill(days.expiry)
  await page.getByTestId('request-detail-hold-expiry-time-input').fill('17:00')
  await page.getByTestId('request-detail-hold-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold placed')
  const hallHold = (await holdsOf(gala)).find((hold) => hold.venue_id === hall)
  await expect(page.getByTestId(`request-detail-hold-status-${hallHold.id}`)).toHaveText('Held')
  expect(await newAbout(page, noted, gala)).toEqual([warning('TC85-06 Hall', gala.name, days)])
})

// @tc: TC-SCRUM-85-07
// @test: when the first check after the warning moment comes after expiry only the expiry notice is sent
// @story: SCRUM-85
// @ac: 2, 3
test('when the first check after the warning moment comes after expiry only the expiry notice is sent', async ({
  page,
}) => {
  const days = daysFor(7)
  const venue = await ownVenue('TC85-07 Room')
  const gala = await planningEvent('TC85-07 Clock Gala', days.event)
  const hold = await placedHold(gala, venue, days)
  await login(page, gala.coordinator)
  const noted = await notifications(page)

  pinClock(`${days.expiry}T17:30`)
  await page.goto(`/requests/${gala.id}`)

  await expect(page.getByTestId(`request-detail-hold-status-${hold}`)).toHaveText('Expired')
  expect(await newAbout(page, noted, gala)).toEqual([expiredNotice('TC85-07 Room', gala.name, days)])
})

// @tc: TC-SCRUM-85-08
// @test: a hold released before expiry gets neither a warning nor an expiry notice
// @story: SCRUM-85
// @ac: 3
test('a hold released before expiry gets neither a warning nor an expiry notice', async ({ page }) => {
  const days = daysFor(8)
  const venue = await ownVenue('TC85-08 Room')
  const gala = await planningEvent('TC85-08 Clock Gala', days.event)
  const hold = await placedHold(gala, venue, days)

  await login(page, gala.coordinator)
  await page.goto(`/requests/${gala.id}`)
  await page.getByTestId(`request-detail-hold-release-button-${hold}`).click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold released')
  const noted = await notifications(page)

  pinClock(`${days.warned}T18:00`)
  await page.reload()
  expect(await newAbout(page, noted, gala)).toEqual([])

  pinClock(`${days.expiry}T17:30`)
  await page.goto(`/requests/${gala.id}`)
  await expect(page.getByTestId(`request-detail-hold-status-${hold}`)).toHaveText('Released')
  await expect(page.getByTestId(`request-detail-hold-release-button-${hold}`)).toHaveCount(0)
  expect(await newAbout(page, noted, gala)).toEqual([])
})
