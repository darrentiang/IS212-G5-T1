import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-33 Search Venues by Date and Capacity. One test per curated row of the
// Test cases tab, in the row's order; every row can be reached through the
// running app, so none is left manual.
//
// TC-SCRUM-33-02, -11, -14 and -15 were first proved only at the API
// (backend/tests/test_venue_search.py), because the app could not yet create an
// event in Planning or an Approved venue booking. SCRUM-43 now moves an
// approved event to Planning, and SCRUM-37 lets Venue Staff approve a booking,
// so these four go through the real flow: raise a booking as coord1, approve it
// as venue1, search.
//
// Seeded Seminar Room 1 (/venues/1, Block A Level 2, capacity 60) and Auditorium
// (/venues/2, Block C Level 1, capacity 400) are read, never changed. One SQLite
// file is shared by every spec, so each test creates its own events under its own
// name, on a date of its own, and asserts on result rows by id: never on a count,
// and never on another spec's records. An approved booking holds a venue, so the
// three booking tests book a venue of their own (no setup or turnaround time, so
// the rows' exact times hold) rather than the seeded Auditorium, which another
// spec's recorded times could widen.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2
const OPEN_HOUSE = 4 // seeded Confirmed event; nothing can change a Confirmed one

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

// A date far enough ahead to be clear of every other spec's events, blocks and
// the seeded 2026-2027 series; each test passes its own offset so no two tests
// share a day. 600 keeps this band clear of the other specs' bands, which start
// at +30/+90/+200/+300/+400/+700 days: every band advances one day per day, so
// the separation between them is permanent.
function dateAhead(offset) {
  const date = new Date()
  date.setDate(date.getDate() + 600 + offset)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

function dayAfter(iso) {
  const date = new Date(`${iso}T12:00:00`)
  date.setDate(date.getDate() + 1)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Mirrors app/format.js's formatPeriod for the event's own (dynamic) date.
function expectedPeriod(iso, start, end) {
  const [year, month, day] = iso.split('-')
  return `${day} ${MONTHS[Number(month) - 1]} ${year}, ${start}–${end}`
}

async function submittedEvent(name, overrides = {}) {
  const organiser = await apiAs('org1')
  const resp = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-33',
      date: dateAhead(0),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 50,
      equipment_requirements: 'None',
      registration_needs: 'None',
      ...overrides,
    },
  })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await organiser.dispose()
  return id
}

// Submits as org1 and approves as coord1, so the event may be searched (AC1).
async function approvedEvent(name, overrides = {}) {
  const id = await submittedEvent(name, overrides)
  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await coordinator.dispose()
  return id
}

// Blocks a seeded venue through the API as venue1.
async function blockVenue(venueId, startDate, startTime, endDate, endTime) {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/blocks`, {
    data: {
      start_date: startDate,
      start_time: startTime,
      end_date: endDate,
      end_time: endTime,
      reason: 'SCRUM-33 test block',
    },
  })
  expect(resp.status()).toBe(201)
  await staff.dispose()
}

// A venue of its own, with no setup or turnaround time recorded, so the times in
// the rows are the whole occupied period.
async function makeVenue(name) {
  const staff = await apiAs('venue1')
  const created = await staff.post('/api/venues', {
    data: { name, location: 'Block T', max_capacity: 100 },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await staff.dispose()
  return id
}

// A venue of its own with a Requested booking on it, for another event on `day`
// at the given times: both ids.
async function bookedVenue(label, day, startTime, endTime) {
  const venueId = await makeVenue(`SCRUM-33 Hall ${label}`)
  const bookedEventId = await approvedEvent(`SCRUM-33 Booked Event ${label}`, {
    date: day,
    start_time: startTime,
    end_time: endTime,
    attendance: 10,
  })
  const coordinator = await apiAs('coord1')
  const raised = await coordinator.post(`/api/requests/${bookedEventId}/bookings`, {
    data: { venue_id: venueId },
  })
  expect(raised.status()).toBe(201)
  const { id: bookingId } = await raised.json()
  await coordinator.dispose()
  return { venueId, bookingId }
}

// Venue Staff approve the booking through the real endpoint (SCRUM-37).
async function approveBooking(venueId, bookingId) {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/approve`, {
    data: { reason: '' },
  })
  expect(resp.ok()).toBeTruthy()
  expect((await resp.json()).status).toBe('Approved')
  await staff.dispose()
}

const row = (page, id) => page.getByTestId(`venue-search-row-${id}`)

async function openRequest(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

// Logs in as coord1, opens the event and opens venue search for it.
async function openSearch(page, eventId) {
  await login(page, 'coord1')
  await openRequest(page, eventId)
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}/venues/search$`))
  await expect(page.getByTestId('venue-search-event-name')).toBeVisible()
}

async function applyLocation(page, text) {
  await page.getByTestId('venue-search-location-input').fill(text)
  await page.getByTestId('venue-search-apply-button').click()
}

// @tc: TC-SCRUM-33-01
// @test: coordinator searches an Approved event with no location and sees every venue that fits
// @story: SCRUM-33
// @ac: 1, 2, 6, 7
test('coordinator searches an Approved event with no location and sees every venue that fits', async ({ page }) => {
  const day = dateAhead(1)
  const eventId = await approvedEvent('SCRUM-33 Happy Path Event', { date: day })
  await openSearch(page, eventId)

  // AC1: the search used the event's own date, times and attendance.
  await expect(page.getByTestId('venue-search-period')).toHaveText(expectedPeriod(day, '10:00', '12:00'))
  await expect(page.getByTestId('venue-search-attendance')).toHaveText('50')
  // AC7: each result identifies the venue and shows its location and capacity.
  await expect(page.getByTestId(`venue-search-name-${SEMINAR_ROOM_1}`)).toHaveText('Seminar Room 1')
  await expect(page.getByTestId(`venue-search-location-${SEMINAR_ROOM_1}`)).toHaveText('Block A Level 2')
  await expect(page.getByTestId(`venue-search-capacity-${SEMINAR_ROOM_1}`)).toHaveText('60')
  await expect(page.getByTestId(`venue-search-name-${AUDITORIUM}`)).toHaveText('Auditorium')
  await expect(page.getByTestId(`venue-search-location-${AUDITORIUM}`)).toHaveText('Block C Level 1')
  await expect(page.getByTestId(`venue-search-capacity-${AUDITORIUM}`)).toHaveText('400')
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-02
// @test: venue search is also available for an event in Planning and searches with that event's values
// @story: SCRUM-33
// @ac: 1
test("venue search is also available for an event in Planning and searches with that event's values", async ({ page }) => {
  const day = dateAhead(40)
  const eventId = await approvedEvent('SCRUM-33 Planning Event', { date: day })
  await login(page, 'coord1')
  await openRequest(page, eventId)
  // Approving assigned an Event Coordinator, which moves the event to Planning (SCRUM-43).
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')

  await page.getByTestId('request-detail-search-venues-button').click()

  await expect(page.getByTestId('venue-search-event-name')).toHaveText('SCRUM-33 Planning Event')
  await expect(page.getByTestId('venue-search-period')).toHaveText(expectedPeriod(day, '10:00', '12:00'))
  await expect(page.getByTestId('venue-search-attendance')).toHaveText('50')
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
  await page.getByTestId('venue-search-back-link').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-33-03
// @test: choosing a location shows only venues whose recorded location is exactly that value
// @story: SCRUM-33
// @ac: 6
test('choosing a location shows only venues whose recorded location is exactly that value', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-33 Location Event', { date: dateAhead(2) })
  await openSearch(page, eventId)

  await applyLocation(page, 'Block C Level 1')

  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-04
// @test: a location that only partly matches excludes every venue and the result is empty, not an error
// @story: SCRUM-33
// @ac: 6, 8
test('a location that only partly matches excludes every venue and the result is empty, not an error', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-33 Partial Location Event', { date: dateAhead(3) })
  await openSearch(page, eventId)

  await applyLocation(page, 'Block C')

  // "Block C" is not the recorded location of any venue any spec creates.
  await expect(page.getByTestId('venue-search-empty')).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-05
// @test: venue search is not available for a Submitted event
// @story: SCRUM-33
// @ac: 1
test('venue search is not available for a Submitted event', async ({ page }) => {
  // The seeded Annual Dinner is Submitted too, but SCRUM-29 decides it, so this
  // test submits an event of its own.
  const eventId = await submittedEvent('SCRUM-33 Submitted Event', { date: dateAhead(4) })
  await login(page, 'coord1')
  await openRequest(page, eventId)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-search-venues-button')).toHaveCount(0)

  // Reached directly, the API still refuses and no results are shown.
  await page.goto(`/requests/${eventId}/venues/search`)
  await expect(page.getByTestId('venue-search-banner')).toHaveText(
    'Venue search is available only for an Approved or Planning event.',
  )
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toHaveCount(0)
  await page.goto(`/requests/${eventId}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
})

// @tc: TC-SCRUM-33-06
// @test: venue search is not available for a Confirmed event
// @story: SCRUM-33
// @ac: 1
test('venue search is not available for a Confirmed event', async ({ page }) => {
  await login(page, 'coord1')
  await page.goto(`/requests/${OPEN_HOUSE}`)

  await expect(page.getByTestId('request-detail-name')).toHaveText('Open House')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  await expect(page.getByTestId('request-detail-search-venues-button')).toHaveCount(0)

  await page.goto(`/requests/${OPEN_HOUSE}/venues/search`)
  await expect(page.getByTestId('venue-search-banner')).toHaveText(
    'Venue search is available only for an Approved or Planning event.',
  )
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-33-07
// @test: attendance just below a venue's capacity keeps that venue in the results
// @story: SCRUM-33
// @ac: 2
test("attendance just below a venue's capacity keeps that venue in the results", async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-33 Attendance 59', { date: dateAhead(5), attendance: 59 })
  await openSearch(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-08
// @test: attendance exactly equal to a venue's capacity keeps that venue in the results
// @story: SCRUM-33
// @ac: 2
test("attendance exactly equal to a venue's capacity keeps that venue in the results", async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-33 Attendance 60', { date: dateAhead(6), attendance: 60 })
  await openSearch(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-capacity-${SEMINAR_ROOM_1}`)).toHaveText('60')
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-09
// @test: attendance just above a venue's capacity excludes that venue
// @story: SCRUM-33
// @ac: 2
test("attendance just above a venue's capacity excludes that venue", async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-33 Attendance 61', { date: dateAhead(7), attendance: 61 })
  await openSearch(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-10
// @test: attendance larger than every capacity gives an empty result, not an error
// @story: SCRUM-33
// @ac: 2, 8
test('attendance larger than every capacity gives an empty result, not an error', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-33 Attendance 401', { date: dateAhead(8), attendance: 401 })
  await openSearch(page, eventId)

  // No spec creates a venue holding 401 or more, so nothing fits.
  await expect(page.getByTestId('venue-search-empty')).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-11
// @test: a venue with an approved booking that overlaps the event period is excluded
// @story: SCRUM-33
// @ac: 3
test('a venue with an approved booking that overlaps the event period is excluded', async ({ page }) => {
  const day = dateAhead(41)
  const { venueId, bookingId } = await bookedVenue('11', day, '09:00', '13:00')
  const eventId = await approvedEvent('SCRUM-33 Overlapping Booking Event', { date: day })
  await openSearch(page, eventId)
  // Still Requested, the booking holds nothing (AC4), so the venue is offered.
  await expect(row(page, venueId)).toBeVisible()

  await approveBooking(venueId, bookingId)
  await page.reload()

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, venueId)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-12
// @test: a venue with a block that overlaps the event period is excluded, including a block spanning two days
// @story: SCRUM-33
// @ac: 3
test('a venue with a block that overlaps the event period is excluded, including a block spanning two days', async ({ page }) => {
  // This block runs into the next day, so the day is kept well clear of every other test's.
  const day = dateAhead(30)
  const eventId = await approvedEvent('SCRUM-33 Block Overlap Event', { date: day })
  await blockVenue(SEMINAR_ROOM_1, day, '11:00', dayAfter(day), '11:00')
  await openSearch(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-13
// @test: a booking that is requested but not yet decided does not exclude the venue
// @story: SCRUM-33
// @ac: 4
test('a booking that is requested but not yet decided does not exclude the venue', async ({ page }) => {
  const day = dateAhead(10)
  const eventId = await approvedEvent('SCRUM-33 Requested Booking Search Event', { date: day })
  // Another event books the Auditorium 09:00-13:00 the same day; the request stays Requested.
  const bookedEventId = await approvedEvent('SCRUM-33 Requested Booking Event', {
    date: day,
    start_time: '09:00',
    end_time: '13:00',
  })
  const coordinator = await apiAs('coord1')
  const raised = await coordinator.post(`/api/requests/${bookedEventId}/bookings`, {
    data: { venue_id: AUDITORIUM },
  })
  expect(raised.status()).toBe(201)
  await coordinator.dispose()
  await openSearch(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-14
// @test: an approved booking that overlaps the event start by one minute excludes the venue
// @story: SCRUM-33
// @ac: 3, 5
test('an approved booking that overlaps the event start by one minute excludes the venue', async ({ page }) => {
  const day = dateAhead(42)
  // The booking ends 10:01; the event starts 10:00.
  const { venueId, bookingId } = await bookedVenue('14', day, '09:00', '10:01')
  const eventId = await approvedEvent('SCRUM-33 One Minute Overlap Event', { date: day })
  await openSearch(page, eventId)
  await expect(row(page, venueId)).toBeVisible()

  await approveBooking(venueId, bookingId)
  await page.reload()

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, venueId)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-15
// @test: an approved booking that ends exactly when the event starts does not exclude the venue
// @story: SCRUM-33
// @ac: 5
test('an approved booking that ends exactly when the event starts does not exclude the venue', async ({ page }) => {
  const day = dateAhead(43)
  // The booking ends 10:00; the event starts 10:00.
  const { venueId, bookingId } = await bookedVenue('15', day, '09:00', '10:00')
  const eventId = await approvedEvent('SCRUM-33 Touching Booking Event', { date: day })
  await approveBooking(venueId, bookingId)
  await openSearch(page, eventId)

  // Approved, but only touching: the venue is still offered.
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, venueId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-33-16
// @test: a venue block that starts exactly when the event ends does not exclude the venue
// @story: SCRUM-33
// @ac: 3, 5
test('a venue block that starts exactly when the event ends does not exclude the venue', async ({ page }) => {
  const day = dateAhead(11)
  const eventId = await approvedEvent('SCRUM-33 Touching Block Event', { date: day })
  await blockVenue(SEMINAR_ROOM_1, day, '12:00', day, '14:00')
  await openSearch(page, eventId)

  await expect(page.getByTestId(`venue-search-row-${SEMINAR_ROOM_1}`)).toBeVisible()
  await expect(page.getByTestId(`venue-search-row-${AUDITORIUM}`)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})
