import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-77 Withdraw a Venue Booking Request. No curated test-case sheet rows
// exist for this story (built directly from the Jira ACs); @tc is omitted
// rather than invented. Seeded Seminar Room 1 (/venues/1) and Auditorium
// (/venues/2) are read and booked against, never retired or renamed. Every
// event and booking a test withdraws it creates itself through the API,
// under its own name, so the booking is Requested before the UI step under
// test (AUTOMATION.md).

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
// against the given venue, so it is Requested and ready to be withdrawn.
async function requestedBooking(name, venueId, raisedBy = 'coord1') {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-77',
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
  await coordinator.dispose()

  const raiser = await apiAs(raisedBy)
  const raised = await raiser.post(`/api/requests/${eventId}/bookings`, { data: { venue_id: venueId } })
  expect(raised.status()).toBe(201)
  const { id: bookingId } = await raised.json()
  await raiser.dispose()

  return { eventId, bookingId }
}

async function openVenue(page, venueId, name) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${venueId}`).getByRole('link', { name }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText(name)
}

// @test: the raising Coordinator withdraws their own Requested booking
// @story: SCRUM-77
// @ac: 1
test('the raising Coordinator withdraws their own Requested booking', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-77 Withdraw Event', SEMINAR_ROOM_1)
  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  // Acts at once: no confirmation form, unlike Approve/Reject.
  await page.getByTestId(`venue-detail-booking-withdraw-button-${bookingId}`).click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking withdrawn')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Withdrawn')
  await expect(page.getByTestId(`venue-detail-booking-withdraw-button-${bookingId}`)).toHaveCount(0)
})

// @test: a withdrawn request no longer offers Approve or Reject to Venue Staff
// @story: SCRUM-77
// @ac: 2
test('a withdrawn request no longer offers Approve or Reject to Venue Staff', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-77 No Longer Decidable Event', SEMINAR_ROOM_1)
  const coordinator = await apiAs('coord1')
  const withdrawn = await coordinator.post(`/api/venues/${SEMINAR_ROOM_1}/bookings/${bookingId}/withdraw`)
  expect(withdrawn.ok()).toBeTruthy()
  await coordinator.dispose()

  await login(page, 'venue1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Withdrawn')
  await expect(page.getByTestId(`venue-detail-booking-approve-button-${bookingId}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`)).toHaveCount(0)
})

// @test: an already-approved request cannot be withdrawn
// @story: SCRUM-77
// @ac: 3
test('an already-approved request cannot be withdrawn', async ({ page }) => {
  const { bookingId } = await requestedBooking('SCRUM-77 Already Approved Event', SEMINAR_ROOM_1)
  const venueStaff = await apiAs('venue1')
  const approved = await venueStaff.post(`/api/venues/${SEMINAR_ROOM_1}/bookings/${bookingId}/approve`, {
    data: {},
  })
  expect(approved.ok()).toBeTruthy()
  await venueStaff.dispose()

  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  // Withdraw is only offered on a Requested row (AC3 enforced by hiding the control).
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-booking-withdraw-button-${bookingId}`)).toHaveCount(0)
})

// @test: a different Event Coordinator does not see a Withdraw action on someone else's booking
// @story: SCRUM-77
// @ac: 4
test("a different Event Coordinator does not see a Withdraw action on someone else's booking", async ({
  page,
}) => {
  const { bookingId } = await requestedBooking('SCRUM-77 Different Coordinator Event', SEMINAR_ROOM_1, 'coord1')
  await login(page, 'coord2')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-row-${bookingId}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-booking-withdraw-button-${bookingId}`)).toHaveCount(0)
})

// @test: withdrawing one booking request leaves the event's other booking requests unchanged
// @story: SCRUM-77
// @ac: 5
test("withdrawing one booking request leaves the event's other booking requests unchanged", async ({ page }) => {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name: 'SCRUM-77 Multi Venue Event',
      purpose: 'Client event',
      description: 'An event for SCRUM-77',
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

  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await page.getByTestId(`venue-detail-booking-withdraw-button-${seminarBookingId}`).click()
  await expect(page.getByTestId(`venue-detail-booking-status-${seminarBookingId}`)).toHaveText('Withdrawn')

  await openVenue(page, AUDITORIUM, 'Auditorium')
  await expect(page.getByTestId(`venue-detail-booking-status-${auditoriumBookingId}`)).toHaveText('Requested')
})
