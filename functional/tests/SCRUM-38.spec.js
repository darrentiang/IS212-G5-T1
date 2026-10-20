import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-38 Prevent Double-Booking of a Venue. Curated rows: team test sheet,
// TC-SCRUM-38-01 to 13. Every row creates its own venue through the API as
// venue1 (location Block T, maximum capacity 100, no operating hours), so rows
// never clash with each other or with other specs, and a retry creates a fresh
// one; venues are therefore chosen by id, never by name. Events, bookings,
// decisions and blocks are set up through the API: org1 submits each event and
// coord1 approves it and raises its booking; venue1 decides and blocks. Only
// the step under test goes through the UI (AUTOMATION.md).

const BASE_URL = 'http://localhost:5173'
const DATE = '2026-12-10'
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

async function ownVenue(name) {
  const staff = await apiAs('venue1')
  const resp = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 100 } })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await staff.dispose()
  return id
}

// org1 submits the event (attendance 40) and coord1 approves it.
async function approvedEvent(name, startTime, endTime, date = DATE) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-38',
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

  await assignAsLead(id) // SCRUM-87: only the assigned coordinator decides

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await coordinator.dispose()
  return id
}

// coord1 raises a booking for the event on the venue; it is Requested.
async function raisedBooking(eventId, venueId) {
  const coordinator = await apiAs('coord1')
  const raised = await coordinator.post(`/api/requests/${eventId}/bookings`, { data: { venue_id: venueId } })
  expect(raised.status()).toBe(201)
  const { id } = await raised.json()
  await coordinator.dispose()
  return id
}

// An approved event with a Requested booking on the venue: the rows' usual precondition.
async function requestedBooking(name, venueId, startTime, endTime, date = DATE) {
  return raisedBooking(await approvedEvent(name, startTime, endTime, date), venueId)
}

async function decideAsVenueStaff(venueId, bookingId, action, reason = '') {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/${action}`, { data: { reason } })
  expect(resp.ok()).toBeTruthy()
  await staff.dispose()
}

async function approvedBooking(name, venueId, startTime, endTime) {
  const bookingId = await requestedBooking(name, venueId, startTime, endTime)
  await decideAsVenueStaff(venueId, bookingId, 'approve')
  return bookingId
}

async function blockVenue(venueId, startTime, endTime, reason) {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/blocks`, {
    data: { start_date: DATE, start_time: startTime, end_date: DATE, end_time: endTime, reason },
  })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await staff.dispose()
  return id
}

async function openVenue(page, venueId) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${venueId}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`))
  await expect(page.getByTestId('venue-detail-name')).toBeVisible()
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

// AC6: refused, and after a reload still Requested with no decision shown.
async function expectRefused(page, bookingId, message) {
  const banner = page.getByTestId('venue-detail-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(message)
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
  await expect(page.getByTestId(`venue-detail-booking-decision-${bookingId}`)).toHaveText('')
}

// Request page -> Request venue booking -> choose the venue by id; resolves
// once the venue's warnings check has answered.
async function chooseVenue(page, eventId, venueId) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${eventId}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}$`))
  await page.getByTestId('request-detail-raise-booking-button').click()
  const checked = page.waitForResponse(
    (resp) => resp.url().endsWith(`/api/requests/${eventId}/venues/${venueId}/warnings`) && resp.ok(),
  )
  await page.getByTestId('booking-new-venue-input').selectOption(String(venueId))
  await checked
}

// @tc: TC-SCRUM-38-01
// @test: approving a booking that overlaps the end of an approved booking is refused and names the holder
// @story: SCRUM-38
// @ac: 1, 2, 6
test('approving a booking that overlaps the end of an approved booking is refused and names the holder', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 01')
  await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  const bookingId = await requestedBooking('TC38 Overlap', venueId, '16:00', '18:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectRefused(page, bookingId, `${HELD}TC38 Holder, 10 Dec 2026, 14:00–17:00.`)
})

// @tc: TC-SCRUM-38-02
// @test: approving a booking whose period encloses an approved booking is refused
// @story: SCRUM-38
// @ac: 1, 2, 6
test('approving a booking whose period encloses an approved booking is refused', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 02')
  await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  const bookingId = await requestedBooking('TC38 Enclose', venueId, '13:00', '18:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectRefused(page, bookingId, `${HELD}TC38 Holder, 10 Dec 2026, 14:00–17:00.`)
})

// @tc: TC-SCRUM-38-03
// @test: a booking that ends exactly when an approved booking starts is not a conflict
// @story: SCRUM-38
// @ac: 4
test('a booking that ends exactly when an approved booking starts is not a conflict', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 03')
  await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  const bookingId = await requestedBooking('TC38 Before', venueId, '11:00', '14:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectApproved(page, bookingId)
})

// @tc: TC-SCRUM-38-04
// @test: a booking that starts exactly when an approved booking ends is not a conflict
// @story: SCRUM-38
// @ac: 4
test('a booking that starts exactly when an approved booking ends is not a conflict', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 04')
  await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  const bookingId = await requestedBooking('TC38 After', venueId, '17:00', '19:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectApproved(page, bookingId)
})

// @tc: TC-SCRUM-38-05
// @test: the same period at a different venue is not a conflict
// @story: SCRUM-38
// @ac: 1
test('the same period at a different venue is not a conflict', async ({ page }) => {
  const holderVenueId = await ownVenue('TC38 Room 05')
  const venueId = await ownVenue('TC38 Room 05B')
  await approvedBooking('TC38 Holder', holderVenueId, '14:00', '17:00')
  const bookingId = await requestedBooking('TC38 Other Venue', venueId, '14:00', '17:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectApproved(page, bookingId)
})

// @tc: TC-SCRUM-38-06
// @test: the same times at the same venue on a different date are not a conflict
// @story: SCRUM-38
// @ac: 1
test('the same times at the same venue on a different date are not a conflict', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 06')
  await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  const bookingId = await requestedBooking('TC38 Other Day', venueId, '14:00', '17:00', '2026-12-11')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectApproved(page, bookingId)
})

// @tc: TC-SCRUM-38-07
// @test: only approved bookings hold a venue: requested or rejected overlapping bookings do not block an approval
// @story: SCRUM-38
// @ac: 1
test('only approved bookings hold a venue: requested or rejected overlapping bookings do not block an approval', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 07')
  const pendingId = await requestedBooking('TC38 Pending', venueId, '14:00', '17:00')
  const turnedDownId = await requestedBooking('TC38 Turned Down', venueId, '14:00', '17:00')
  await decideAsVenueStaff(venueId, turnedDownId, 'reject', 'Room not suitable')
  const bookingId = await requestedBooking('TC38 Clear', venueId, '15:00', '16:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectApproved(page, bookingId)
  await expect(page.getByTestId(`venue-detail-booking-status-${pendingId}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-38-08
// @test: approving a booking that overlaps a block on the venue is refused and names the block
// @story: SCRUM-38
// @ac: 2, 3, 6
test('approving a booking that overlaps a block on the venue is refused and names the block', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 08')
  await blockVenue(venueId, '13:00', '15:00', 'Projector replacement')
  const bookingId = await requestedBooking('TC38 Blocked', venueId, '14:00', '16:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectRefused(
    page,
    bookingId,
    `${HELD}blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement).`,
  )
})

// @tc: TC-SCRUM-38-09
// @test: a booking that starts exactly when a block ends is not a conflict
// @story: SCRUM-38
// @ac: 3, 4
test('a booking that starts exactly when a block ends is not a conflict', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 09')
  await blockVenue(venueId, '09:00', '12:00', 'Deep clean')
  const bookingId = await requestedBooking('TC38 After Block', venueId, '12:00', '14:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, bookingId)

  await expectApproved(page, bookingId)
})

// @tc: TC-SCRUM-38-10
// @test: two bookings raised while the venue was free cannot both be approved
// @story: SCRUM-38
// @ac: 2, 5, 6
test('two bookings raised while the venue was free cannot both be approved', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 10')
  const firstId = await requestedBooking('TC38 First', venueId, '14:00', '17:00')
  const secondId = await requestedBooking('TC38 Second', venueId, '15:00', '18:00')

  await login(page, 'venue1')
  await openVenue(page, venueId)
  await approveInUi(page, firstId)
  await expectApproved(page, firstId)
  await approveInUi(page, secondId)

  await expectRefused(page, secondId, `${HELD}TC38 First, 10 Dec 2026, 14:00–17:00.`)
  await expect(page.getByTestId(`venue-detail-booking-status-${firstId}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-38-11
// @test: choosing a venue that already holds an overlapping approved booking warns the coordinator, who can still raise
// @story: SCRUM-38
// @ac: 7
test('choosing a venue that already holds an overlapping approved booking warns the coordinator, who can still raise', async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 11')
  const holderId = await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  const eventId = await approvedEvent('TC38 Late Pick', '16:00', '18:00')

  await login(page, 'coord1')
  await chooseVenue(page, eventId, venueId)

  await expect(page.getByTestId(`booking-new-warning-approved-booking-${holderId}`)).toHaveText(
    'The venue already holds an approved booking for TC38 Holder, 10 Dec 2026, 14:00–17:00.',
  )
  const raised = page.waitForResponse(
    (resp) => resp.url().endsWith(`/api/requests/${eventId}/bookings`) && resp.request().method() === 'POST',
  )
  await page.getByTestId('booking-new-raise-button').click()
  const { id: bookingId } = await (await raised).json()

  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}$`))
  await expect(page.getByTestId(`venue-detail-booking-event-${bookingId}`)).toHaveText('TC38 Late Pick')
  await expect(page.getByTestId(`venue-detail-booking-status-${bookingId}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-38-12
// @test: choosing a venue blocked over the event's period warns the coordinator
// @story: SCRUM-38
// @ac: 7
test("choosing a venue blocked over the event's period warns the coordinator", async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 12')
  const blockId = await blockVenue(venueId, '13:00', '15:00', 'Projector replacement')
  const eventId = await approvedEvent('TC38 Block Pick', '14:00', '16:00')

  await login(page, 'coord1')
  await chooseVenue(page, eventId, venueId)

  await expect(page.getByTestId(`booking-new-warning-block-${blockId}`)).toHaveText(
    'The venue is blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement).',
  )
})

// @tc: TC-SCRUM-38-13
// @test: no taken-venue warning when the only other booking is requested or merely touches the event's period
// @story: SCRUM-38
// @ac: 7
test("no taken-venue warning when the only other booking is requested or merely touches the event's period", async ({ page }) => {
  const venueId = await ownVenue('TC38 Room 13')
  await approvedBooking('TC38 Holder', venueId, '14:00', '17:00')
  await requestedBooking('TC38 Pending Pick Other', venueId, '17:30', '18:30')
  const eventId = await approvedEvent('TC38 Touch Pick', '17:00', '19:00')

  await login(page, 'coord1')
  await chooseVenue(page, eventId, venueId)

  await expect(page.locator('[data-testid^="booking-new-warning-approved-booking-"]')).toHaveCount(0)
  await expect(page.locator('[data-testid^="booking-new-warning-block-"]')).toHaveCount(0)
})
