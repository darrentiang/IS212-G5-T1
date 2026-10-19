import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-82 Replace a Venue That Became Unavailable. TC-SCRUM-82-01 to 08
// (test-case sheet), one test per row in the row's order.
//
// Every row builds its own venues and events through the API (AUTOMATION.md:
// data a test changes it creates itself). The rows' Seminar Room 1 is a venue
// of the row's own with 30 minutes of setup and of turnaround, and their
// Auditorium one with none, each at a location of the row's own so the search
// can be narrowed to them. The Event Coordinator Lead assigns the coordinator
// (SCRUM-86), so "coord1" in the rows is whoever the event was assigned to,
// read from the event. Each row's event falls on a Saturday of its own (the rows'
// "5 Dec 2026" and "12 Dec 2026"), 10:00–12:00, so it occupies the Seminar
// Room 09:30–12:30 and the Auditorium 10:00–12:00. Dates are relative to today
// because an event cannot be submitted for a date already past. Notifications
// are checked by the row's own event name, never by count of the whole inbox.

const BASE_URL = 'http://localhost:5173'
const SETUP = { setup_time: 30, turnaround_time: 30 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-82',
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

// TC-05 pins the app clock; no other row may inherit it.
test.beforeEach(() => clearClock())
test.afterEach(() => clearClock())

const pad = (value) => String(value).padStart(2, '0')
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// The row's Saturday, well ahead and one per row (offset from SCRUM-83's).
function saturdayFor(offset) {
  const saturday = new Date()
  saturday.setDate(saturday.getDate() + 300 + offset * 7)
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7))
  return iso(saturday)
}

// A number of days before an ISO date, as an ISO date.
function daysBefore(isoDate, days) {
  const [year, month, dayOfMonth] = isoDate.split('-').map(Number)
  return iso(new Date(year, month - 1, dayOfMonth - days))
}

// '2026-12-05' -> '05 Dec 2026' (app/format.js formatDate).
function shown(isoDate) {
  const [year, month, dayOfMonth] = isoDate.split('-')
  return `${dayOfMonth} ${MONTHS[Number(month) - 1]} ${year}`
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

// The row's Seminar Room: 30 minutes of setup and turnaround.
async function seminarRoom(name, location) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location, max_capacity: 60 } })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const timed = await staff.patch(`/api/venues/${id}/times`, { data: SETUP })
    expect(timed.ok()).toBeTruthy()
    return id
  })
}

// The row's Auditorium: no setup or turnaround time.
async function auditorium(name, location) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location, max_capacity: 400 } })
    expect(created.status()).toBe(201)
    return (await created.json()).id
  })
}

// An event with its assigned coordinator: org1 submits it, the Lead assigns
// coord1 and coord1 approves it. It reaches Planning with its first booking.
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
  return { id, name, date, coordinator: body.assigned_coordinator }
}

// Sent for safety check by its coordinator and approved by the Safety Officer.
async function confirm(event) {
  await as(event.coordinator, async (coordinator) => {
    const sent = await coordinator.post(`/api/requests/${event.id}/send-for-safety-check`, { data: {} })
    expect(sent.ok()).toBeTruthy()
  })
  await as('safety1', async (officer) => {
    const approved = await officer.post(`/api/requests/${event.id}/safety/approve`, { data: {} })
    expect(approved.ok()).toBeTruthy()
    expect((await approved.json()).status).toBe('Confirmed')
  })
}

async function approvedBooking(event, venueId) {
  const bookingId = await as(event.coordinator, async (coordinator) => {
    const raised = await coordinator.post(`/api/requests/${event.id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
  await as('venue1', async (staff) => {
    const decided = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/approve`, { data: { reason: '' } })
    expect(decided.ok()).toBeTruthy()
  })
  return bookingId
}

// A block through the API, for rows whose precondition already holds one.
async function blockThroughApi(venueId, date, start, end, reason) {
  return as('venue1', async (staff) => {
    const created = await staff.post(`/api/venues/${venueId}/blocks`, {
      data: { start_date: date, start_time: start, end_date: date, end_time: end, reason },
    })
    expect(created.status()).toBe(201)
    return (await created.json()).id
  })
}

// Block venue on the venue page, as the rows' steps say.
async function blockInPage(page, venueId, { date, start, end, reason }) {
  await page.goto(`/venues/${venueId}`)
  await page.getByTestId('venue-detail-block-button').click()
  await page.getByTestId('venue-detail-block-start-date-input').fill(date)
  await page.getByTestId('venue-detail-block-start-time-input').fill(start)
  await page.getByTestId('venue-detail-block-end-date-input').fill(date)
  await page.getByTestId('venue-detail-block-end-time-input').fill(end)
  await page.getByTestId('venue-detail-block-reason-input').fill(reason)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/blocks') && r.request().method() === 'POST'),
    page.getByTestId('venue-detail-block-confirm-button').click(),
  ])
  expect(resp.status()).toBe(201)
  return (await resp.json()).id
}

async function openEvent(page, event) {
  await page.goto(`/requests/${event.id}`)
  await expect(page.getByTestId('request-detail-bookings')).toBeVisible()
}

// The row's own event's notifications on the Notifications page.
async function notificationsAbout(page, event) {
  await page.goto('/notifications')
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  return page.locator('[data-testid^="notifications-row-"]', { hasText: `booked for ${event.name},` })
}

async function expectMarked(page, bookingId) {
  await expect(page.getByTestId(`request-detail-booking-status-${bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`request-detail-booking-unavailable-${bookingId}`)).toHaveText('Venue unavailable')
}

async function expectNotMarked(page, bookingId, status = 'Approved') {
  await expect(page.getByTestId(`request-detail-booking-status-${bookingId}`)).toHaveText(status)
  await expect(page.getByTestId(`request-detail-booking-unavailable-${bookingId}`)).toHaveCount(0)
}

// The precondition of rows 04 to 08: the event's Seminar Room booking marked
// by a block from 11:00 to 15:00 (Pipe burst).
async function markedGala(row, day, { blockStart = '11:00', withHall = false } = {}) {
  const location = `TC82-${row} Block`
  const seminar = await seminarRoom(`TC82-${row} Seminar Room`, location)
  const hall = withHall ? await auditorium(`TC82-${row} Auditorium`, location) : null
  const gala = await planningEvent(`TC82-${row} Swap Gala`, day)
  const booking = await approvedBooking(gala, seminar)
  const blockId = await blockThroughApi(seminar, day, blockStart, '15:00', 'Pipe burst')
  return { location, seminar, hall, gala, booking, blockId }
}

// @tc: TC-SCRUM-82-01
// @test: a block over an approved booking marks it venue unavailable, keeps it approved and tells the coordinator once
// @story: SCRUM-82
// @ac: 1, 2, 4
test('a block over an approved booking marks it venue unavailable, keeps it approved and tells the coordinator once', async ({
  page,
}) => {
  const day = saturdayFor(1)
  const seminar = await seminarRoom('TC82-01 Seminar Room', 'TC82-01 Block')
  const hall = await auditorium('TC82-01 Auditorium', 'TC82-01 Block')
  const gala = await planningEvent('TC82-01 Swap Gala', day)
  const seminarBooking = await approvedBooking(gala, seminar)
  const hallBooking = await approvedBooking(gala, hall)

  await login(page, 'venue1')
  await blockInPage(page, seminar, { date: day, start: '11:00', end: '15:00', reason: 'Pipe burst' })
  await logout(page)
  await login(page, gala.coordinator)
  await openEvent(page, gala)

  await expectMarked(page, seminarBooking)
  await expectNotMarked(page, hallBooking)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  const rows = await notificationsAbout(page, gala)
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(
    `TC82-01 Seminar Room, booked for TC82-01 Swap Gala, is unavailable ${shown(day)}, 11:00 to ${shown(day)}, 15:00 (Pipe burst).`,
  )
})

// @tc: TC-SCRUM-82-02
// @test: a block that ends exactly at the booking's occupied start does not mark it
// @story: SCRUM-82
// @ac: 1
test("a block that ends exactly at the booking's occupied start does not mark it", async ({ page }) => {
  const day = saturdayFor(2)
  const seminar = await seminarRoom('TC82-02 Seminar Room', 'TC82-02 Block')
  const gala = await planningEvent('TC82-02 Swap Gala', day)
  const booking = await approvedBooking(gala, seminar)

  await login(page, 'venue1')
  const blockId = await blockInPage(page, seminar, { date: day, start: '08:00', end: '09:30', reason: 'Cleaning' })
  await expect(page.getByTestId(`venue-detail-block-reason-${blockId}`)).toHaveText('Cleaning')
  await logout(page)
  await login(page, gala.coordinator)
  await openEvent(page, gala)

  await expectNotMarked(page, booking)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(await notificationsAbout(page, gala)).toHaveCount(0)
})

// @tc: TC-SCRUM-82-03
// @test: a block over a confirmed event's booking returns it to planning with its details unchanged
// @story: SCRUM-82
// @ac: 3
test("a block over a confirmed event's booking returns it to planning with its details unchanged", async ({
  page,
}) => {
  const day = saturdayFor(3)
  const hall = await auditorium('TC82-03 Auditorium', 'TC82-03 Block')
  const expo = await planningEvent('TC82-03 Swap Expo', day)
  const booking = await approvedBooking(expo, hall)
  await confirm(expo)

  await login(page, 'venue1')
  await blockInPage(page, hall, { date: day, start: '09:00', end: '11:00', reason: 'Stage repair' })
  await logout(page)
  await login(page, expo.coordinator)
  await openEvent(page, expo)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-name')).toHaveText('TC82-03 Swap Expo')
  await expect(page.getByTestId('request-detail-date')).toHaveText(shown(day))
  await expect(page.getByTestId('request-detail-start-time')).toHaveText('10:00')
  await expect(page.getByTestId('request-detail-end-time')).toHaveText('12:00')
  await expect(page.getByTestId('request-detail-attendance')).toHaveText('40')
  await expectMarked(page, booking)
  await expect(await notificationsAbout(page, expo)).toHaveCount(1)
})

// @tc: TC-SCRUM-82-04
// @test: removing a block that has not started clears the marker and the event stays planning
// @story: SCRUM-82
// @ac: 5
test('removing a block that has not started clears the marker and the event stays planning', async ({ page }) => {
  const day = saturdayFor(4)
  const { seminar, gala, booking, blockId } = await markedGala('04', day)

  await login(page, 'venue1')
  await page.goto(`/venues/${seminar}`)
  await page.getByTestId(`venue-detail-block-remove-button-${blockId}`).click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Block removed')
  await expect(page.getByTestId(`venue-detail-block-row-${blockId}`)).toHaveCount(0)
  await logout(page)
  await login(page, gala.coordinator)
  await openEvent(page, gala)

  await expectNotMarked(page, booking)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-82-05
// @test: ending an in-progress block before the booking's occupied start clears the marker
// @story: SCRUM-82
// @ac: 5
test("ending an in-progress block before the booking's occupied start clears the marker", async ({ page }) => {
  const day = saturdayFor(5)
  const { seminar, gala, booking, blockId } = await markedGala('05', day, { blockStart: '08:00' })
  // The precondition: the block is in progress, the time pinned at 08:30 on the event's day.
  pinClock(`${day}T08:30`)

  await login(page, 'venue1')
  await page.goto(`/venues/${seminar}`)
  await page.getByTestId(`venue-detail-block-end-button-${blockId}`).click()
  await page.getByTestId('venue-detail-end-block-end-date-input').fill(day)
  await page.getByTestId('venue-detail-end-block-end-time-input').fill('09:00')
  await page.getByTestId('venue-detail-end-block-confirm-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Block ended')
  await expect(page.getByTestId(`venue-detail-block-period-${blockId}`)).toHaveText(
    `${shown(day)}, 08:00 to ${shown(day)}, 09:00`,
  )
  await logout(page)
  await login(page, gala.coordinator)
  await openEvent(page, gala)

  await expectNotMarked(page, booking)
})

// @tc: TC-SCRUM-82-06
// @test: cancelling the marked booking leaves a cancelled row with no venue unavailable marker
// @story: SCRUM-82
// @ac: 5
test('cancelling the marked booking leaves a cancelled row with no venue unavailable marker', async ({ page }) => {
  const day = saturdayFor(6)
  const { gala, booking } = await markedGala('06', day)

  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await expectMarked(page, booking)
  await page.getByTestId(`request-detail-booking-cancel-button-${booking}`).click()
  await page.getByTestId('request-detail-booking-cancel-reason-input').fill('Venue unavailable')
  await page.getByTestId('request-detail-booking-cancel-confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Booking cancelled')
  await page.reload()
  await expect(page.getByTestId('request-detail-bookings')).toBeVisible()

  await expectNotMarked(page, booking, 'Cancelled')
  await expect(page.getByTestId(`request-detail-booking-cancel-reason-${booking}`)).toHaveText('Venue unavailable')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// The search narrowed to the row's own location, so only its venues can be listed.
async function searchFor(page, event, location) {
  await openEvent(page, event)
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page.getByTestId('venue-search-event-name')).toHaveText(event.name)
  await page.getByTestId('venue-search-location-input').fill(location)
  await page.getByTestId('venue-search-apply-button').click()
}

// @tc: TC-SCRUM-82-07
// @test: request booking from the venue search opens the booking page with that venue chosen
// @story: SCRUM-82
// @ac: 6
test('request booking from the venue search opens the booking page with that venue chosen', async ({ page }) => {
  const day = saturdayFor(7)
  const { location, seminar, hall, gala } = await markedGala('07', day, { withHall: true })

  await login(page, gala.coordinator)
  await searchFor(page, gala, location)

  await expect(page.getByTestId(`venue-search-row-${hall}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${seminar}`)).toHaveCount(0)
  // A button-styled link in a table cell keeps the button's white text (index.css).
  const requestBooking = page.getByTestId(`venue-search-request-booking-button-${hall}`)
  await expect(requestBooking).toHaveText('Request booking')
  await expect(requestBooking).toHaveCSS('color', 'rgb(255, 255, 255)')
  // The plain venue-name link in the same row still takes the cell link's style.
  await expect(page.getByTestId(`venue-search-name-${hall}`)).toHaveCSS('font-weight', '500')
  await requestBooking.click()
  await expect(page.getByTestId('booking-new-venue-input')).toHaveValue(String(hall))
  await page.getByTestId('booking-new-raise-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue booking requested')
  await openEvent(page, gala)

  const row = page.locator('[data-testid^="request-detail-booking-row-"]', { hasText: 'TC82-07 Auditorium' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(`${shown(day)}, 10:00–12:00`)
  await expect(row).toContainText('Requested')
})

// @tc: TC-SCRUM-82-08
// @test: place hold from the venue search opens the request page's place hold form with that venue chosen
// @story: SCRUM-82
// @ac: 6
test("place hold from the venue search opens the request page's place hold form with that venue chosen", async ({
  page,
}) => {
  const day = saturdayFor(8)
  const { location, hall, gala } = await markedGala('08', day, { withHall: true })
  const expiry = daysBefore(day, 4)

  await login(page, gala.coordinator)
  await searchFor(page, gala, location)
  await page.getByTestId(`venue-search-place-hold-button-${hall}`).click()

  await expect(page.getByTestId('request-detail-hold-form')).toBeVisible()
  await expect(page.getByTestId('request-detail-hold-venue-input')).toHaveValue(String(hall))
  await page.getByTestId('request-detail-hold-expiry-date-input').fill(expiry)
  await page.getByTestId('request-detail-hold-expiry-time-input').fill('17:00')
  await page.getByTestId('request-detail-hold-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold placed')
  const row = page.locator('[data-testid^="request-detail-hold-row-"]', { hasText: 'TC82-08 Auditorium' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(`${shown(day)}, 10:00–12:00`)
  await expect(row).toContainText(`${shown(expiry)}, 17:00`)
  await expect(row).toContainText('Held')
})
