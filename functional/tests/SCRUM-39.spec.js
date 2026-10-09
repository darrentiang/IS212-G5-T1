import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-39 View Venue Availability Calendar. TC-SCRUM-39-01 through 08
// (test-case sheet), one test per row in the row's order. Every row creates
// its own venue through the API as venue1 ('SCRUM-39 TCxx Venue', Block T,
// capacity 100) and its own events, bookings and blocks, so rows never touch
// each other, the seeded venues or another spec's records. Dates are always
// relative to the Monday of the week the suite happens to run in, so a row
// never depends on which real weekday "today" is.

const BASE_URL = 'http://localhost:5173'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

// The Monday, 00:00, of the week containing `date` — the same rule
// VenueAvailabilityPage.jsx uses, so a test's expectations match the page's.
function mondayOf(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = start.getDay()
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day))
  return start
}

const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
const isoDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const label = (date) => `${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
const rangeLabel = (start, endInclusive) => `${label(start)} to ${label(endInclusive)}`

const THIS_MONDAY = mondayOf(new Date())
// Event creation refuses a past date, so rows that need "today's" week to
// hold a booking use a week two Mondays ahead instead, always safely in the
// future regardless of which real weekday the suite happens to run on, and
// navigate there with two clicks of Next.
const TARGET_MONDAY = addDays(THIS_MONDAY, 14)

async function goToTargetWeek(page) {
  await page.getByTestId('venue-availability-next-button').click()
  await page.getByTestId('venue-availability-next-button').click()
  await expect(page.getByTestId('venue-availability-range')).toHaveText(
    rangeLabel(TARGET_MONDAY, addDays(TARGET_MONDAY, 6)),
  )
}

async function makeVenue(name, times = null) {
  const staff = await apiAs('venue1')
  const created = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 100 } })
  expect(created.status()).toBe(201)
  const venue = await created.json()
  await staff.dispose()
  if (times) {
    const timed = await apiAs('venue1')
    const resp = await timed.patch(`/api/venues/${venue.id}/times`, { data: times })
    expect(resp.status()).toBe(200)
    await timed.dispose()
  }
  return venue.id
}

// org1 submits the event and coord1 approves it, then raises a booking for
// the given venue; it is Requested.
async function requestedBooking(name, venueId, date, startTime, endTime) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-39',
      date,
      start_time: startTime,
      end_time: endTime,
      attendance: 40,
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
    },
  })
  expect(submitted.status()).toBe(201)
  const { id: eventId } = await submitted.json()
  await organiser.dispose()

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${eventId}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  const raised = await coordinator.post(`/api/requests/${eventId}/bookings`, { data: { venue_id: venueId } })
  expect(raised.status()).toBe(201)
  const { id: bookingId } = await raised.json()
  await coordinator.dispose()
  return bookingId
}

async function decideAsVenueStaff(venueId, bookingId, action, reason = '') {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/${action}`, { data: { reason } })
  expect(resp.ok()).toBeTruthy()
  await staff.dispose()
}

async function withdrawAsCoordinator(venueId, bookingId) {
  const coordinator = await apiAs('coord1')
  const resp = await coordinator.post(`/api/venues/${venueId}/bookings/${bookingId}/withdraw`)
  expect(resp.ok()).toBeTruthy()
  await coordinator.dispose()
}

async function blockVenue(venueId, date, startTime, endTime, reason) {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/blocks`, {
    data: { start_date: date, start_time: startTime, end_date: date, end_time: endTime, reason },
  })
  expect(resp.status()).toBe(201)
  await staff.dispose()
}

async function openAvailability(page, venueId) {
  await page.goto(`/venues/${venueId}/availability`)
  await expect(page.getByTestId('venue-availability-title')).toBeVisible()
}

// @tc: TC-SCRUM-39-01
// @test: opening the calendar from the venue's own page defaults to the current week
// @story: SCRUM-39
// @ac: 1, 6
test("opening the calendar from the venue's own page defaults to the current week", async ({ page }) => {
  const venueId = await makeVenue('SCRUM-39 TC01 Venue')
  await login(page, 'coord1')
  await page.goto(`/venues/${venueId}`)
  await page.getByTestId('venue-detail-availability-link').click()

  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}/availability$`))
  await expect(page.getByTestId('venue-availability-title')).toHaveText('SCRUM-39 TC01 Venue')
  await expect(page.getByTestId('venue-availability-range')).toHaveText(
    rangeLabel(THIS_MONDAY, addDays(THIS_MONDAY, 6)),
  )
})

// @tc: TC-SCRUM-39-02
// @test: an Approved booking is shown with its period and event name
// @story: SCRUM-39
// @ac: 2
test('an Approved booking is shown with its period and event name', async ({ page }) => {
  const venueId = await makeVenue('SCRUM-39 TC02 Venue')
  const day = addDays(TARGET_MONDAY, 1)
  const bookingId = await requestedBooking('SCRUM-39 TC02 Event', venueId, isoDate(day), '10:00', '12:00')
  await decideAsVenueStaff(venueId, bookingId, 'approve')

  await login(page, 'coord1')
  await openAvailability(page, venueId)
  await goToTargetWeek(page)

  const row = page.getByTestId(`venue-availability-entry-row-booking-${bookingId}`)
  await expect(row).toBeVisible()
  await expect(page.getByTestId(`venue-availability-entry-name-booking-${bookingId}`)).toHaveText(
    'SCRUM-39 TC02 Event',
  )
  await expect(page.getByTestId(`venue-availability-entry-period-booking-${bookingId}`)).toHaveText(
    `${label(day)}, 10:00 to ${label(day)}, 12:00`,
  )
  await expect(page.getByTestId(`venue-availability-entry-status-booking-${bookingId}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-39-03
// @test: a blocked period is shown with its period and reason
// @story: SCRUM-39
// @ac: 3
test('a blocked period is shown with its period and reason', async ({ page }) => {
  const venueId = await makeVenue('SCRUM-39 TC03 Venue')
  const day = addDays(TARGET_MONDAY, 2)
  await blockVenue(venueId, isoDate(day), '13:00', '15:00', 'Maintenance')

  await login(page, 'coord1')
  await openAvailability(page, venueId)
  await goToTargetWeek(page)

  const row = page.locator('[data-testid^="venue-availability-entry-row-block-"]')
  await expect(row).toBeVisible()
  await expect(row.getByText('Maintenance')).toBeVisible()
  await expect(row.getByText('Block')).toBeVisible()
  await expect(row.getByText(`${label(day)}, 13:00 to ${label(day)}, 15:00`)).toBeVisible()
})

// @tc: TC-SCRUM-39-04
// @test: an Approved booking's unavailable period includes the venue's recorded setup and turnaround time
// @story: SCRUM-39
// @ac: 4
test("an Approved booking's unavailable period includes the venue's recorded setup and turnaround time", async ({
  page,
}) => {
  const venueId = await makeVenue('SCRUM-39 TC04 Venue', { setup_time: 30, turnaround_time: 15 })
  const day = addDays(TARGET_MONDAY, 1)
  const bookingId = await requestedBooking('SCRUM-39 TC04 Event', venueId, isoDate(day), '10:00', '12:00')
  await decideAsVenueStaff(venueId, bookingId, 'approve')

  await login(page, 'coord1')
  await openAvailability(page, venueId)
  await goToTargetWeek(page)

  await expect(page.getByTestId(`venue-availability-entry-period-booking-${bookingId}`)).toHaveText(
    `${label(day)}, 09:30 to ${label(day)}, 12:15`,
  )
})

// @tc: TC-SCRUM-39-05
// @test: a Requested booking is shown as pending, visibly distinct from an Approved booking
// @story: SCRUM-39
// @ac: 5
test('a Requested booking is shown as pending, visibly distinct from an Approved booking', async ({ page }) => {
  const venueId = await makeVenue('SCRUM-39 TC05 Venue')
  const approvedDay = addDays(TARGET_MONDAY, 1)
  const pendingDay = addDays(TARGET_MONDAY, 3)
  const approvedId = await requestedBooking('SCRUM-39 TC05 Approved Event', venueId, isoDate(approvedDay), '10:00', '11:00')
  await decideAsVenueStaff(venueId, approvedId, 'approve')
  const pendingId = await requestedBooking('SCRUM-39 TC05 Pending Event', venueId, isoDate(pendingDay), '10:00', '11:00')

  await login(page, 'coord1')
  await openAvailability(page, venueId)
  await goToTargetWeek(page)

  await expect(page.getByTestId(`venue-availability-entry-status-booking-${approvedId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-availability-entry-status-booking-${pendingId}`)).toHaveText('Pending')
})

// @tc: TC-SCRUM-39-06
// @test: Rejected and Withdrawn booking requests do not appear on the calendar
// @story: SCRUM-39
// @ac: 5
test('Rejected and Withdrawn booking requests do not appear on the calendar', async ({ page }) => {
  const venueId = await makeVenue('SCRUM-39 TC06 Venue')
  const day = addDays(TARGET_MONDAY, 1)
  const rejectedId = await requestedBooking('SCRUM-39 TC06 Rejected Event', venueId, isoDate(day), '09:00', '10:00')
  await decideAsVenueStaff(venueId, rejectedId, 'reject', 'No availability')
  const withdrawnId = await requestedBooking('SCRUM-39 TC06 Withdrawn Event', venueId, isoDate(day), '11:00', '12:00')
  await withdrawAsCoordinator(venueId, withdrawnId)

  await login(page, 'coord1')
  await openAvailability(page, venueId)
  await goToTargetWeek(page)

  await expect(page.getByTestId(`venue-availability-entry-row-booking-${rejectedId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-availability-entry-row-booking-${withdrawnId}`)).toHaveCount(0)
  await expect(page.getByTestId('venue-availability-empty')).toBeVisible()
})

// @tc: TC-SCRUM-39-07
// @test: navigating to a different week shows that week's own records only
// @story: SCRUM-39
// @ac: 1
test("navigating to a different week shows that week's own records only", async ({ page }) => {
  const venueId = await makeVenue('SCRUM-39 TC07 Venue')
  const nextWeekMonday = addDays(THIS_MONDAY, 7)
  const day = addDays(nextWeekMonday, 2)
  const bookingId = await requestedBooking('SCRUM-39 TC07 Event', venueId, isoDate(day), '10:00', '11:00')
  await decideAsVenueStaff(venueId, bookingId, 'approve')

  await login(page, 'coord1')
  await openAvailability(page, venueId)

  await expect(page.getByTestId(`venue-availability-entry-row-booking-${bookingId}`)).toHaveCount(0)

  await page.getByTestId('venue-availability-next-button').click()

  await expect(page.getByTestId('venue-availability-range')).toHaveText(
    rangeLabel(nextWeekMonday, addDays(nextWeekMonday, 6)),
  )
  await expect(page.getByTestId(`venue-availability-entry-row-booking-${bookingId}`)).toBeVisible()
})

// @tc: TC-SCRUM-39-08
// @test: an approved booking's setup/turnaround-widened period that crosses into the next calendar week is shown spanning both weeks
// @story: SCRUM-39
// @ac: 4
test("an approved booking's setup/turnaround-widened period that crosses into the next calendar week is shown spanning both weeks", async ({
  page,
}) => {
  const venueId = await makeVenue('SCRUM-39 TC08 Venue', { setup_time: 0, turnaround_time: 60 })
  const nextWeekMonday = addDays(THIS_MONDAY, 7)
  const sunday = addDays(nextWeekMonday, 6)
  const bookingId = await requestedBooking('SCRUM-39 TC08 Event', venueId, isoDate(sunday), '23:00', '23:45')
  await decideAsVenueStaff(venueId, bookingId, 'approve')

  await login(page, 'coord1')
  await openAvailability(page, venueId)

  // Week containing the Sunday: nextWeekMonday's week.
  await page.getByTestId('venue-availability-next-button').click()
  await expect(page.getByTestId('venue-availability-range')).toHaveText(
    rangeLabel(nextWeekMonday, addDays(nextWeekMonday, 6)),
  )
  await expect(page.getByTestId(`venue-availability-entry-row-booking-${bookingId}`)).toBeVisible()

  // The following week: the widened period rolls over into its Monday, 00:45.
  await page.getByTestId('venue-availability-next-button').click()
  const followingMonday = addDays(nextWeekMonday, 7)
  await expect(page.getByTestId('venue-availability-range')).toHaveText(
    rangeLabel(followingMonday, addDays(followingMonday, 6)),
  )
  await expect(page.getByTestId(`venue-availability-entry-row-booking-${bookingId}`)).toBeVisible()
})
