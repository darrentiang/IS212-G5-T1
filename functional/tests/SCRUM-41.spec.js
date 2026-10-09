import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-41 Reserve Setup and Turnaround Time Around a Booking. Curated rows:
// team test sheet, TC-SCRUM-41-01 to 12, one test per row in the row's order,
// each named for its Scenario. Every row creates its own venue through the API
// as venue1 ('SCRUM-41 TCxx Venue', Block T, capacity 100) and its own events
// and bookings on 15 Dec 2026, so rows never touch each other, the seeded
// venues or another spec's records. Durations are recorded through the
// authorised time endpoint in setup where a row's precondition needs them
// (docs/test-cases/AUTOMATION.md). Only the step under test goes through the
// UI: the occupied period is read on the venue page, search on the event's
// venue-search page, approval and the clash list on the venue page.

const BASE_URL = 'http://localhost:5173'
const DATE = '2026-12-15'
const HELD = 'This venue is already committed for an overlapping period: '

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

// Its own venue; `times` records setup/turnaround beforehand (a precondition,
// never the step under test).
async function makeVenue(name, times = null) {
  const staff = await apiAs('venue1')
  const created = await staff.post('/api/venues', {
    data: { name, location: 'Block T', max_capacity: 100 },
  })
  expect(created.status()).toBe(201)
  const venue = await created.json()
  await staff.dispose()
  if (times) await recordTimes(venue.id, times.setup_time, times.turnaround_time)
  return venue
}

async function recordTimes(venueId, setupTime, turnaroundTime) {
  const staff = await apiAs('venue1')
  const resp = await staff.patch(`/api/venues/${venueId}/times`, {
    data: { setup_time: setupTime, turnaround_time: turnaroundTime },
  })
  expect(resp.status()).toBe(200)
  await staff.dispose()
}

// org1 submits the event (attendance 40) and coord1 approves it, so it may be
// searched and booked.
async function approvedEvent(name, startTime, endTime, date = DATE) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-41',
      date,
      start_time: startTime,
      end_time: endTime,
      attendance: 40,
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
    },
  })
  expect(submitted.status()).toBe(201)
  const { id } = await submitted.json()
  await organiser.dispose()

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await coordinator.dispose()
  return id
}

// coord1 raises a booking for the event on the venue; it is Requested.
async function raisedBooking(eventId, venueId) {
  const coordinator = await apiAs('coord1')
  const raised = await coordinator.post(`/api/requests/${eventId}/bookings`, {
    data: { venue_id: venueId },
  })
  expect(raised.status()).toBe(201)
  const { id } = await raised.json()
  await coordinator.dispose()
  return id
}

async function decideAsVenueStaff(venueId, bookingId, action, reason = '') {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/${action}`, {
    data: { reason },
  })
  expect(resp.ok()).toBeTruthy()
  await staff.dispose()
}

// An approved event with a Requested booking on the venue: both ids.
async function requested(name, venueId, startTime, endTime, date = DATE) {
  const eventId = await approvedEvent(name, startTime, endTime, date)
  return { eventId, bookingId: await raisedBooking(eventId, venueId) }
}

// The same, already Approved: the booking holding the venue.
async function holding(name, venueId, startTime, endTime, date = DATE) {
  const rows = await requested(name, venueId, startTime, endTime, date)
  await decideAsVenueStaff(venueId, rows.bookingId, 'approve')
  return rows
}

async function openVenue(page, venueId) {
  await page.goto(`/venues/${venueId}`)
  await expect(page.getByTestId('venue-detail-name')).toBeVisible()
  await expect(page.getByTestId('venue-detail-fields')).toBeVisible()
}

async function openTimes(page) {
  await page.getByTestId('venue-detail-times-button').click()
  await expect(page.getByTestId('venue-detail-times-setup-time-input')).toBeVisible()
}

async function fillTimes(page, setup, turnaround) {
  await page.getByTestId('venue-detail-times-setup-time-input').fill(setup)
  await page.getByTestId('venue-detail-times-turnaround-time-input').fill(turnaround)
}

async function saveTimes(page) {
  await page.getByTestId('venue-detail-times-save-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Times updated')
}

async function approveInUi(page, bookingId) {
  await page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()
}

async function expectApproved(page, bookingId) {
  const banner = page.getByTestId('venue-detail-banner')
  await expect(banner).toHaveAttribute('role', 'status')
  await expect(banner).toHaveText('Booking approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
}

// Refused, and after a reload still Requested with no decision shown.
async function expectRefused(page, bookingId, message) {
  const banner = page.getByTestId('venue-detail-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(message)
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
  await expect(page.getByTestId(`venue-detail-booking-decision-${bookingId}`)).toHaveText('')
}

// The occupied period cell on the venue page (AC1), both endpoints in full.
function occupiedCell(page, bookingId) {
  return page.getByTestId(`venue-detail-occupied-period-${bookingId}`)
}

// Opens the event's venue-search page; the search runs on load.
async function openSearch(page, eventId) {
  await page.goto(`/requests/${eventId}`)
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}/venues/search$`))
  await expect(page.getByTestId('venue-search-event-name')).toBeVisible()
}

// As coord1, who is the one searching (AC2).
async function openSearchAsCoordinator(page, eventId) {
  await login(page, 'coord1')
  await openSearch(page, eventId)
}

// @tc: TC-SCRUM-41-01
// @test: An approved booking occupies the venue for setup, event and turnaround without changing its event times.
// @story: SCRUM-41
// @ac: 1, 2
test('An approved booking occupies the venue for setup, event and turnaround without changing its event times.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC01 Venue', { setup_time: 30, turnaround_time: 15 })
  const { eventId, bookingId } = await holding('TC41 Booking A', venue.id, '10:00', '12:00')

  await login(page, 'coord1')
  await openVenue(page, venue.id)

  // AC1: 30 minutes of setup and 15 of turnaround around 10:00–12:00.
  await expect(occupiedCell(page, bookingId)).toHaveText('15 Dec 2026, 09:30 to 15 Dec 2026, 12:15')

  // The event's own times are untouched.
  await page.getByTestId(`venue-detail-occupied-event-${bookingId}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}$`))
  await expect(page.getByTestId('request-detail-date')).toHaveText('15 Dec 2026')
  await expect(page.getByTestId('request-detail-start-time')).toHaveText('10:00')
  await expect(page.getByTestId('request-detail-end-time')).toHaveText('12:00')
})

// @tc: TC-SCRUM-41-02
// @test: Setup extends the occupied period into the previous date.
// @story: SCRUM-41
// @ac: 1, 2
test('Setup extends the occupied period into the previous date.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC02 Venue', { setup_time: 30, turnaround_time: 15 })
  const { eventId, bookingId } = await holding('TC41 Booking A', venue.id, '00:15', '01:15')

  await login(page, 'coord1')
  await openVenue(page, venue.id)

  // Both dates show: 30 minutes before 00:15 is on the 14th.
  await expect(occupiedCell(page, bookingId)).toHaveText('14 Dec 2026, 23:45 to 15 Dec 2026, 01:30')

  await page.getByTestId(`venue-detail-occupied-event-${bookingId}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}$`))
  await expect(page.getByTestId('request-detail-date')).toHaveText('15 Dec 2026')
  await expect(page.getByTestId('request-detail-start-time')).toHaveText('00:15')
  await expect(page.getByTestId('request-detail-end-time')).toHaveText('01:15')
})

// @tc: TC-SCRUM-41-03
// @test: Turnaround extends the occupied period into the next date.
// @story: SCRUM-41
// @ac: 1, 2
test('Turnaround extends the occupied period into the next date.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC03 Venue', { setup_time: 30, turnaround_time: 30 })
  const { eventId, bookingId } = await holding('TC41 Booking A', venue.id, '23:00', '23:45')

  await login(page, 'coord1')
  await openVenue(page, venue.id)

  // Both dates show: 30 minutes after 23:45 is on the 16th.
  await expect(occupiedCell(page, bookingId)).toHaveText('15 Dec 2026, 22:30 to 16 Dec 2026, 00:15')

  await page.getByTestId(`venue-detail-occupied-event-${bookingId}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}$`))
  await expect(page.getByTestId('request-detail-date')).toHaveText('15 Dec 2026')
  await expect(page.getByTestId('request-detail-start-time')).toHaveText('23:00')
  await expect(page.getByTestId('request-detail-end-time')).toHaveText('23:45')
})

// @tc: TC-SCRUM-41-04
// @test: Venue search excludes a venue during an existing approved booking's setup or turnaround period.
// @story: SCRUM-41
// @ac: 2
test("Venue search excludes a venue during an existing approved booking's setup or turnaround period.", async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC04 Venue', { setup_time: 30, turnaround_time: 15 })
  await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  // Occupied 09:30–12:15: one search event ends inside the setup period, the
  // other starts inside the turnaround one.
  const setupHit = await approvedEvent('TC41 Setup Search', '09:40', '09:50')
  const turnaroundHit = await approvedEvent('TC41 Turnaround Search', '12:05', '12:10')

  await openSearchAsCoordinator(page, setupHit)
  await expect(page.getByTestId(`venue-search-row-${venue.id}`)).toHaveCount(0)

  await openSearch(page, turnaroundHit)
  await expect(page.getByTestId(`venue-search-row-${venue.id}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-41-05
// @test: Venue search excludes a venue when the proposed event's setup overlaps an existing booking's turnaround.
// @story: SCRUM-41
// @ac: 1, 2, 3
test("Venue search excludes a venue when the proposed event's setup overlaps an existing booking's turnaround.", async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC05 Venue', { setup_time: 30, turnaround_time: 15 })
  await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  // The proposed event's published period 12:30–13:30 is clear of A's
  // 10:00–12:00, but its own occupied period 12:00–13:45 reaches into A's
  // turnaround (12:00–12:15).
  const eventId = await approvedEvent('TC41 Setup Pick', '12:30', '13:30')

  await openSearchAsCoordinator(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${venue.id}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-41-06
// @test: A one-minute overlap between occupied periods prevents approval.
// @story: SCRUM-41
// @ac: 1, 3
test('A one-minute overlap between occupied periods prevents approval.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC06 Venue', { setup_time: 30, turnaround_time: 15 })
  const first = await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  const { bookingId } = await requested('TC41 Booking B', venue.id, '12:44', '13:44')

  await login(page, 'venue1')
  await openVenue(page, venue.id)
  await approveInUi(page, bookingId)

  // B would occupy 12:14–13:59; A holds to 12:15.
  await expectRefused(page, bookingId, `${HELD}TC41 Booking A, 15 Dec 2026, 10:00–12:00.`)
  await expect(page.getByTestId(`venue-detail-booking-status-${first.bookingId}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-41-07
// @test: Occupied periods that exactly touch allow approval.
// @story: SCRUM-41
// @ac: 1, 3
test('Occupied periods that exactly touch allow approval.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC07 Venue', { setup_time: 30, turnaround_time: 15 })
  const first = await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  const { bookingId } = await requested('TC41 Booking B', venue.id, '12:45', '13:45')

  await login(page, 'venue1')
  await openVenue(page, venue.id)
  await approveInUi(page, bookingId)

  // B occupies 12:15–14:00, which only touches A's 09:30–12:15.
  await expectApproved(page, bookingId)
  await expect(occupiedCell(page, bookingId)).toHaveText('15 Dec 2026, 12:15 to 15 Dec 2026, 14:00')
  await expect(page.getByTestId(`venue-detail-booking-status-${first.bookingId}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-41-08
// @test: A one-minute gap between occupied periods allows approval.
// @story: SCRUM-41
// @ac: 1, 3
test('A one-minute gap between occupied periods allows approval.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC08 Venue', { setup_time: 30, turnaround_time: 15 })
  const first = await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  const { bookingId } = await requested('TC41 Booking B', venue.id, '12:46', '13:46')

  await login(page, 'venue1')
  await openVenue(page, venue.id)
  await approveInUi(page, bookingId)

  // B occupies 12:16–14:01, a minute clear of A's 09:30–12:15.
  await expectApproved(page, bookingId)
  await expect(occupiedCell(page, bookingId)).toHaveText('15 Dec 2026, 12:16 to 15 Dec 2026, 14:01')
  await expect(page.getByTestId(`venue-detail-booking-status-${first.bookingId}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-41-09
// @test: Unrecorded venue durations default to zero and allow consecutive bookings whose event periods only touch.
// @story: SCRUM-41
// @ac: 1, 3, 4
test('Unrecorded venue durations default to zero and allow consecutive bookings whose event periods only touch.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC09 Venue')
  const first = await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  const { bookingId } = await requested('TC41 Booking B', venue.id, '12:00', '13:00')

  await login(page, 'venue1')
  await openVenue(page, venue.id)

  // AC4: zero buffers, so A occupies exactly its own period.
  await expect(occupiedCell(page, first.bookingId)).toHaveText('15 Dec 2026, 10:00 to 15 Dec 2026, 12:00')
  await expect(page.getByTestId('venue-detail-setup-time')).toHaveText('0 minutes')
  await expect(page.getByTestId('venue-detail-turnaround-time')).toHaveText('0 minutes')

  await approveInUi(page, bookingId)
  await expectApproved(page, bookingId)
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${first.bookingId}`)).toHaveText('Approved')
  await expect(occupiedCell(page, bookingId)).toHaveText('15 Dec 2026, 12:00 to 15 Dec 2026, 13:00')
})

// @tc: TC-SCRUM-41-10
// @test: Recording venue durations lists all affected approved bookings without including undecided bookings or changing records.
// @story: SCRUM-41
// @ac: 1, 5
test('Recording venue durations lists all affected approved bookings without including undecided bookings or changing records.', async ({ page }) => {
  const venue = await makeVenue('SCRUM-41 TC10 Venue')
  const other = await makeVenue('SCRUM-41 TC10 Other Venue', { setup_time: 30, turnaround_time: 15 })
  const a = await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  const b = await holding('TC41 Booking B', venue.id, '12:30', '13:30')
  const c = await holding('TC41 Booking C', venue.id, '14:00', '15:00')
  const d = await requested('TC41 Booking D', venue.id, '15:15', '16:00')
  const e = await holding('TC41 Booking E', other.id, '10:30', '11:30')

  await login(page, 'venue1')
  await openVenue(page, venue.id)
  await openTimes(page)
  await fillTimes(page, '30', '15')
  await saveTimes(page)

  // The A–B–C chain, each named once, as the new durations make it clash.
  await expect(page.getByTestId(`venue-detail-clash-row-${a.bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-clash-row-${b.bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-clash-row-${c.bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-clash-event-${a.bookingId}`)).toHaveText('TC41 Booking A')
  await expect(page.getByTestId(`venue-detail-clash-period-${a.bookingId}`)).toHaveText(
    '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
  )
  await expect(page.getByTestId(`venue-detail-clash-period-${b.bookingId}`)).toHaveText(
    '15 Dec 2026, 12:00 to 15 Dec 2026, 13:45',
  )
  await expect(page.getByTestId(`venue-detail-clash-period-${c.bookingId}`)).toHaveText(
    '15 Dec 2026, 13:30 to 15 Dec 2026, 15:15',
  )
  // Never the undecided one, and never another venue's.
  await expect(page.getByTestId(`venue-detail-clash-row-${d.bookingId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-clash-row-${e.bookingId}`)).toHaveCount(0)

  // The booking records themselves are unchanged.
  await page.reload()
  for (const row of [a, b, c]) {
    await expect(page.getByTestId(`venue-detail-booking-status-${row.bookingId}`)).toHaveText('Approved')
  }
  await expect(page.getByTestId(`venue-detail-booking-status-${d.bookingId}`)).toHaveText('Requested')
  await expect(page.getByTestId(`venue-detail-booking-period-${a.bookingId}`)).toHaveText(
    '15 Dec 2026, 10:00–12:00',
  )
  await expect(page.getByTestId(`venue-detail-booking-period-${b.bookingId}`)).toHaveText(
    '15 Dec 2026, 12:30–13:30',
  )
  await expect(page.getByTestId(`venue-detail-booking-period-${c.bookingId}`)).toHaveText(
    '15 Dec 2026, 14:00–15:00',
  )
  await expect(page.getByTestId(`venue-detail-booking-period-${d.bookingId}`)).toHaveText(
    '15 Dec 2026, 15:15–16:00',
  )
})

// @tc: TC-SCRUM-41-11
// @test: Reducing one venue duration removes resolved clashes from the current list without changing bookings.
// @story: SCRUM-41
// @ac: 1, 3, 5
test('Reducing one venue duration removes resolved clashes from the current list without changing bookings.', async ({ page }) => {
  // Precondition: approve both with zero durations, then record 30/15.
  const venue = await makeVenue('SCRUM-41 TC11 Venue')
  const a = await holding('TC41 Booking A', venue.id, '10:00', '12:00')
  const b = await holding('TC41 Booking B', venue.id, '12:30', '13:30')
  await recordTimes(venue.id, 30, 15)

  await login(page, 'venue1')
  await openVenue(page, venue.id)
  await expect(page.getByTestId(`venue-detail-clash-row-${a.bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-clash-row-${b.bookingId}`)).toBeVisible()

  await openTimes(page)
  await fillTimes(page, '0', '15')
  await saveTimes(page)

  // A occupies 10:00–12:15 and B 12:30–13:45: clear of each other.
  await expect(page.getByTestId('venue-detail-clashes-empty')).toHaveText(
    'No approved bookings currently clash.',
  )
  await expect(page.getByTestId(`venue-detail-clash-row-${a.bookingId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-clash-row-${b.bookingId}`)).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('venue-detail-clashes-empty')).toBeVisible()
  await expect(page.getByTestId(`venue-detail-booking-status-${a.bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${b.bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-booking-period-${a.bookingId}`)).toHaveText(
    '15 Dec 2026, 10:00–12:00',
  )
  await expect(page.getByTestId(`venue-detail-booking-period-${b.bookingId}`)).toHaveText(
    '15 Dec 2026, 12:30–13:30',
  )
  await expect(page.getByTestId('venue-detail-turnaround-time')).toHaveText('15 minutes')
})

// @tc: TC-SCRUM-41-12
// @test: Overlapping occupied periods on different venues do not prevent approval.
// @story: SCRUM-41
// @ac: 3
test('Overlapping occupied periods on different venues do not prevent approval.', async ({ page }) => {
  const venueA = await makeVenue('SCRUM-41 TC12 Venue A', { setup_time: 30, turnaround_time: 15 })
  const venueB = await makeVenue('SCRUM-41 TC12 Venue B', { setup_time: 30, turnaround_time: 15 })
  const first = await holding('TC41 Booking A', venueA.id, '10:00', '12:00')
  const { bookingId } = await requested('TC41 Booking B', venueB.id, '10:00', '12:00')

  await login(page, 'venue1')
  await openVenue(page, venueB.id)
  await approveInUi(page, bookingId)

  // Both occupy 09:30–12:15, but never the same venue.
  await expectApproved(page, bookingId)
  await expect(occupiedCell(page, bookingId)).toHaveText('15 Dec 2026, 09:30 to 15 Dec 2026, 12:15')

  await openVenue(page, venueA.id)
  await expect(page.getByTestId(`venue-detail-booking-status-${first.bookingId}`)).toHaveText('Approved')
})
