import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-37 Approve or Reject a Venue Booking Request. Curated rows: team test
// sheet, TC-SCRUM-37-01 to 08. Seeded Seminar Room 1 (/venues/1) is read and
// booked against, never retired or renamed. A row that approves a booking
// does so on a venue it creates itself: since SCRUM-38 an approved booking
// holds its venue for its period, so two rows approving on a shared venue at
// the same time would clash, and so would a local re-run against the same
// database. Every event and booking a row needs it creates itself through the
// API, under its own name: org1 submits the event, coord1 approves it and
// raises the booking, so the booking is Requested before the steps
// (AUTOMATION.md). A booking a row needs already decided is decided by venue1
// through the API too.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-37',
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

// A decision's moment as formatDateTime shows it, e.g. (08 Oct 2026, 09:15).
// Matched as a pattern, not a value, so the test cannot flake near midnight.
const DECIDED_AT = /\(\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\)/

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

function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

// org1 submits the event and coord1 approves it, then coord1 raises one
// booking per venue, so each is Requested and ready to be decided.
async function requestedBookings(name, venueIds, eventFields = {}) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      ...TEXT_FIELDS,
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 40,
      ...eventFields,
    },
  })
  expect(submitted.status()).toBe(201)
  const { id: eventId } = await submitted.json()
  await organiser.dispose()

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${eventId}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  const bookingIds = []
  for (const venueId of venueIds) {
    const raised = await coordinator.post(`/api/requests/${eventId}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    bookingIds.push((await raised.json()).id)
  }
  await coordinator.dispose()
  return bookingIds
}

async function requestedBooking(name, venueId, eventFields = {}) {
  const [bookingId] = await requestedBookings(name, [venueId], eventFields)
  return bookingId
}

// venue1 decides the booking through the API, before the steps.
async function decideAsVenueStaff(venueId, bookingId, action, reason) {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/${action}`, { data: { reason } })
  expect(resp.ok()).toBeTruthy()
  await staff.dispose()
}

// venue1 creates a venue of the row's own (location Block T, capacity 100,
// no operating hours), so its approvals never clash with another row's.
async function ownVenue(name) {
  const staff = await apiAs('venue1')
  const resp = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 100 } })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await staff.dispose()
  return id
}

async function openVenue(page, venueId, name) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${venueId}`).getByRole('link', { name }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText(name)
}

// @tc: TC-SCRUM-37-01
// @test: venue staff sees the event's timing, attendance and venue requirements before deciding
// @story: SCRUM-37
// @ac: 1
test("venue staff sees the event's timing, attendance and venue requirements before deciding", async ({ page }) => {
  const bookingId = await requestedBooking('SCRUM-37 TC-01 Event', SEMINAR_ROOM_1, {
    date: '2026-12-10',
    start_time: '10:00',
    end_time: '12:00',
    attendance: 42,
    layout: 'Theatre',
    facilities: ['Projector', 'Whiteboard'],
  })

  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-period-${bookingId}`)).toHaveText('10 Dec 2026, 10:00–12:00')
  await expect(page.getByTestId(`venue-detail-booking-attendance-${bookingId}`)).toHaveText('42')
  await expect(page.getByTestId(`venue-detail-booking-layout-${bookingId}`)).toHaveText('Theatre')
  await expect(page.getByTestId(`venue-detail-booking-facilities-${bookingId}`)).toHaveText('Projector, Whiteboard')
})

// @tc: TC-SCRUM-37-02
// @test: venue staff approves a requested booking, committing the venue
// @story: SCRUM-37
// @ac: 2, 4, 9
test('venue staff approves a requested booking, committing the venue', async ({ page }) => {
  const venueId = await ownVenue('TC37 Room 02')
  const bookingId = await requestedBooking('SCRUM-37 TC-02 Event', venueId)

  await login(page, 'venue1')
  await openVenue(page, venueId, 'TC37 Room 02')
  await page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
  const decision = page.getByTestId(`venue-detail-booking-decision-${bookingId}`)
  await expect(decision).toContainText('Approved by venue1')
  await expect(decision).toHaveText(DECIDED_AT)
  await expect(page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-37-03
// @test: venue staff rejects a requested booking with a reason
// @story: SCRUM-37
// @ac: 3, 4, 9
test('venue staff rejects a requested booking with a reason', async ({ page }) => {
  const bookingId = await requestedBooking('SCRUM-37 TC-03 Event', SEMINAR_ROOM_1)

  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-reason-input').fill('Already committed that week')
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking rejected')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Rejected')
  const decision = page.getByTestId(`venue-detail-booking-decision-${bookingId}`)
  await expect(decision).toContainText('Already committed that week')
  await expect(decision).toHaveText(DECIDED_AT)
})

// @tc: TC-SCRUM-37-04
// @test: rejecting without a reason is refused, sending nothing
// @story: SCRUM-37
// @ac: 8
test('rejecting without a reason is refused, sending nothing', async ({ page }) => {
  const bookingId = await requestedBooking('SCRUM-37 TC-04 Event', SEMINAR_ROOM_1)

  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-decide-reason-error')).toBeVisible()
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-37-05
// @test: approve and reject are not offered to an event coordinator
// @story: SCRUM-37
// @ac: 6
test('approve and reject are not offered to an event coordinator', async ({ page }) => {
  const bookingId = await requestedBooking('SCRUM-37 TC-05 Event', SEMINAR_ROOM_1)

  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-row-${bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-37-06
// @test: an already-decided booking cannot be decided again
// @story: SCRUM-37
// @ac: 7
test('an already-decided booking cannot be decided again', async ({ page }) => {
  const venueId = await ownVenue('TC37 Room 06')
  const bookingId = await requestedBooking('SCRUM-37 TC-06 Event', venueId)
  await decideAsVenueStaff(venueId, bookingId, 'approve', '')

  await login(page, 'venue1')
  await openVenue(page, venueId, 'TC37 Room 06')

  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-37-07
// @test: event coordinator sees the decision and reason once a booking is rejected
// @story: SCRUM-37
// @ac: 5
test('event coordinator sees the decision and reason once a booking is rejected', async ({ page }) => {
  const bookingId = await requestedBooking('SCRUM-37 TC-07 Event', SEMINAR_ROOM_1)
  await decideAsVenueStaff(SEMINAR_ROOM_1, bookingId, 'reject', 'Venue under maintenance')

  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Rejected')
  const decision = page.getByTestId(`venue-detail-booking-decision-${bookingId}`)
  await expect(decision).toContainText('venue1')
  await expect(decision).toContainText('Venue under maintenance')
})

// @tc: TC-SCRUM-37-08
// @test: deciding one booking request leaves the event's other booking requests unchanged
// @story: SCRUM-37
// @ac: 10
test("deciding one booking request leaves the event's other booking requests unchanged", async ({ page }) => {
  const firstVenueId = await ownVenue('TC37 Room 08A')
  const secondVenueId = await ownVenue('TC37 Room 08B')
  const [firstBookingId, secondBookingId] = await requestedBookings('SCRUM-37 TC-08 Event', [
    firstVenueId,
    secondVenueId,
  ])

  await login(page, 'venue1')
  await openVenue(page, firstVenueId, 'TC37 Room 08A')
  await page.getByTestId(`venue-detail-booking-approve-button-${firstBookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()
  await expect(page.getByTestId(`venue-detail-booking-status-${firstBookingId}`)).toHaveText('Approved')

  await openVenue(page, secondVenueId, 'TC37 Room 08B')
  await expect(page.getByTestId(`venue-detail-booking-status-${secondBookingId}`)).toHaveText('Requested')
})
