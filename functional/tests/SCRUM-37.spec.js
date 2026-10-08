import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-37 Approve or Reject a Venue Booking Request. No curated test-case
// sheet rows exist for this story (built directly from the Jira ACs); @tc is
// omitted rather than invented. Seeded Seminar Room 1 (/venues/1) and
// Auditorium (/venues/2) are read and booked against, never retired or
// renamed. Every event and booking a test decides it creates itself through
// the API, under its own name, so the booking is Requested before the UI
// step under test (AUTOMATION.md).

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2

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

// Submits as org1, approves as coord1, then raises a booking as coord1
// against the given venue, so it is Requested and ready to be decided.
async function requestedBooking(name, venueId, eventOverrides = {}) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-37',
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 80,
      venue_requirements: 'Seminar room with whiteboard',
      accessibility_needs: 'Step-free access',
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
      ...eventOverrides,
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

  return { eventId, bookingId }
}

async function openVenue(page, venueId, name) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${venueId}`).getByRole('link', { name }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText(name)
}

// @test: venue staff sees the event timing, attendance and venue requirements before deciding
// @story: SCRUM-37
// @ac: 1
test('venue staff sees the event timing, attendance and venue requirements before deciding', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-37 Visible Fields Event', SEMINAR_ROOM_1, {
    attendance: 42,
    venue_requirements: 'Stage and lighting rig',
  })
  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  const row = page.getByTestId(`venue-detail-booking-row-${bookingId}`)
  await expect(row.getByTestId(`venue-detail-booking-attendance-${bookingId}`)).toHaveText('42')
  await expect(row.getByTestId(`venue-detail-booking-venue-requirements-${bookingId}`)).toHaveText(
    'Stage and lighting rig',
  )
})

// @test: venue staff approves a booking request, committing the venue to the event
// @story: SCRUM-37
// @ac: 2, 4, 9
test('venue staff approves a booking request, committing the venue to the event', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-37 Approve Event', SEMINAR_ROOM_1)
  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-booking-decision-${bookingId}`)).toContainText('Approved by venue1')
  await expect(page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`)).toHaveCount(0)
})

// @test: venue staff rejects a booking request with a reason
// @story: SCRUM-37
// @ac: 3, 4, 9
test('venue staff rejects a booking request with a reason', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-37 Reject Event', SEMINAR_ROOM_1)
  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-reason-input').fill('Already committed that week')
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking rejected')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Rejected')
  await expect(page.getByTestId(`venue-detail-booking-decision-${bookingId}`)).toContainText(
    'Already committed that week',
  )
})

// @test: rejecting without a reason is refused, sending nothing
// @story: SCRUM-37
// @ac: 8
test('rejecting without a reason is refused, sending nothing', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-37 Blank Reason Event', SEMINAR_ROOM_1)
  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-decide-reason-error')).toBeVisible()
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
})

// @test: the Approve and Reject actions are not offered to an Event Coordinator
// @story: SCRUM-37
// @ac: 6
test('the Approve and Reject actions are not offered to an Event Coordinator', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-37 Coordinator View Event', SEMINAR_ROOM_1)
  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-row-${bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`)).toHaveCount(0)
})

// @test: the event coordinator sees the decision and reason once rejected
// @story: SCRUM-37
// @ac: 5
test('the event coordinator sees the decision and reason once rejected', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-37 Visible Decision Event', SEMINAR_ROOM_1)
  const venueStaff = await apiAs('venue1')
  const rejected = await venueStaff.post(`/api/venues/${SEMINAR_ROOM_1}/bookings/${bookingId}/reject`, {
    data: { reason: 'Venue under maintenance' },
  })
  expect(rejected.ok()).toBeTruthy()
  await venueStaff.dispose()

  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Rejected')
  await expect(page.getByTestId(`venue-detail-booking-decision-${bookingId}`)).toContainText('venue1')
  await expect(page.getByTestId(`venue-detail-booking-decision-${bookingId}`)).toContainText(
    'Venue under maintenance',
  )
})

// @test: deciding one booking request leaves the event's other booking requests unchanged
// @story: SCRUM-37
// @ac: 10
test("deciding one booking request leaves the event's other booking requests unchanged", async ({ page }) => {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name: 'SCRUM-37 Multi Venue Event',
      purpose: 'Client event',
      description: 'An event for SCRUM-37',
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 80,
      venue_requirements: 'Seminar room with whiteboard',
      accessibility_needs: 'Step-free access',
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
  const seminarBooking = await coordinator.post(`/api/requests/${eventId}/bookings`, {
    data: { venue_id: SEMINAR_ROOM_1 },
  })
  expect(seminarBooking.status()).toBe(201)
  const { id: seminarBookingId } = await seminarBooking.json()
  const auditoriumBooking = await coordinator.post(`/api/requests/${eventId}/bookings`, {
    data: { venue_id: AUDITORIUM },
  })
  expect(auditoriumBooking.status()).toBe(201)
  const { id: auditoriumBookingId } = await auditoriumBooking.json()
  await coordinator.dispose()

  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await page.getByTestId(`venue-detail-booking-approve-button-${seminarBookingId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()
  await expect(page.getByTestId(`venue-detail-booking-status-${seminarBookingId}`)).toHaveText('Approved')

  await openVenue(page, AUDITORIUM, 'Auditorium')
  await expect(page.getByTestId(`venue-detail-booking-status-${auditoriumBookingId}`)).toHaveText('Requested')
})
