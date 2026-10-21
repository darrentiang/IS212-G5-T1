import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-78 Suggest an Alternative When Rejecting a Venue Booking. Curated rows:
// team test sheet, TC-SCRUM-78-01 to 14. Seeded Seminar Room 1 (/venues/1) is
// the venue every row books and rejects against, and seeded Auditorium
// (/venues/2) the venue it suggests; a rejection holds nothing, so neither is
// disturbed. TC-07 approves a booking, and since SCRUM-38 an approved booking
// holds its venue for its period, so that row approves on a venue it creates
// itself (the same convention as SCRUM-37.spec.js). Every event and booking a
// row needs it creates itself through the API, under the name the row gives:
// org1 submits the event, coord1 approves it and raises the booking (or the
// Coordinator the row names), so the booking is Requested before the steps.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2

// The event every row books: 10 Dec 2026, 14:00 to 17:00.
const EVENT = { date: '2026-12-10', start_time: '14:00', end_time: '17:00' }

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-78',
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

const NO_CHANGE = 'A suggestion must change the venue or the period from what was requested.'

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

// org1 submits the event; the Lead assigns `raisedBy`, who approves it and raises the
// booking at the venue (SCRUM-87: only the assigned coordinator), so it is Requested and ready to be decided.
async function requestedBooking(name, venueId, { raisedBy = 'coord1', ...event } = {}) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: { name, ...TEXT_FIELDS, ...EVENT, attendance: 40, ...event },
  })
  expect(submitted.status()).toBe(201)
  const { id: eventId } = await submitted.json()
  await organiser.dispose()

  await assignAsLead(eventId, raisedBy)

  const approver = await apiAs(raisedBy)
  const approved = await approver.post(`/api/requests/${eventId}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await approver.dispose()

  const coordinator = await apiAs(raisedBy)
  const raised = await coordinator.post(`/api/requests/${eventId}/bookings`, { data: { venue_id: venueId } })
  expect(raised.status()).toBe(201)
  const { id } = await raised.json()
  await coordinator.dispose()
  return id
}

// venue1 rejects through the API, before the steps.
async function rejectAsVenueStaff(venueId, bookingId, body) {
  const staff = await apiAs('venue1')
  const resp = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/reject`, { data: body })
  expect(resp.ok()).toBeTruthy()
  await staff.dispose()
}

// venue1 creates a venue of the row's own, so its approval never clashes with
// another row's (or a re-run's).
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

// Venue Staff open the booking's venue and start rejecting it.
async function startRejecting(page, bookingId, venueId = SEMINAR_ROOM_1, venueName = 'Seminar Room 1') {
  await login(page, 'venue1')
  await openVenue(page, venueId, venueName)
  await page.getByTestId(`venue-detail-booking-reject-button-${bookingId}`).click()
}

const reason = (page, text) => page.getByTestId('venue-detail-decide-reason-input').fill(text)
const suggestVenue = (page, name) =>
  page.getByTestId('venue-detail-decide-suggested-venue-input').selectOption({ label: name })
async function suggestPeriod(page, { date, start, end }) {
  if (date !== undefined) await page.getByTestId('venue-detail-decide-suggested-date-input').fill(date)
  if (start !== undefined) await page.getByTestId('venue-detail-decide-suggested-start-time-input').fill(start)
  if (end !== undefined) await page.getByTestId('venue-detail-decide-suggested-end-time-input').fill(end)
}
const confirmReject = (page) => page.getByTestId('venue-detail-decide-confirm-button').click()

const status = (page, id) => page.getByTestId(`venue-detail-booking-status-${id}`)
const decision = (page, id) => page.getByTestId(`venue-detail-booking-decision-${id}`)
const suggestedVenue = (page, id) => page.getByTestId(`venue-detail-booking-suggested-venue-${id}`)
const suggestedPeriod = (page, id) => page.getByTestId(`venue-detail-booking-suggested-period-${id}`)

// The booking is Rejected with the reason; checked again after a reload so it is what was recorded.
async function expectRejected(page, id, text) {
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await page.reload()
  await expect(status(page, id)).toHaveText('Rejected')
  await expect(decision(page, id)).toContainText(text)
}

// Refused: still Requested after a reload, with no decision, reason or suggestion recorded.
async function expectStillRequested(page, id) {
  await page.reload()
  await expect(status(page, id)).toHaveText('Requested')
  await expect(decision(page, id)).toHaveText('')
  await expect(page.getByTestId(`venue-detail-booking-suggestion-${id}`)).toBeEmpty()
}

// @tc: TC-SCRUM-78-01
// @test: venue staff reject a booking request with a reason and a suggested venue only
// @story: SCRUM-78
// @ac: 1
test('venue staff reject a booking request with a reason and a suggested venue only', async ({ page }) => {
  const id = await requestedBooking('Suggest Venue Only', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Seminar Room 1 is taken that day.')
  await suggestVenue(page, 'Auditorium')
  await confirmReject(page)

  await expectRejected(page, id, 'Seminar Room 1 is taken that day.')
  await expect(suggestedVenue(page, id)).toHaveText('Auditorium')
  await expect(suggestedPeriod(page, id)).toHaveCount(0)
})

// @tc: TC-SCRUM-78-02
// @test: venue staff reject a booking request with a reason and a suggested period only
// @story: SCRUM-78
// @ac: 1
test('venue staff reject a booking request with a reason and a suggested period only', async ({ page }) => {
  const id = await requestedBooking('Suggest Period Only', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Seminar Room 1 is taken that afternoon.')
  await suggestPeriod(page, { date: '2026-12-11', start: '09:00', end: '12:00' })
  await confirmReject(page)

  await expectRejected(page, id, 'Seminar Room 1 is taken that afternoon.')
  await expect(suggestedPeriod(page, id)).toHaveText('11 Dec 2026, 09:00–12:00')
  await expect(suggestedVenue(page, id)).toHaveCount(0)
})

// @tc: TC-SCRUM-78-03
// @test: venue staff reject a booking request with a reason, a suggested venue and a suggested period
// @story: SCRUM-78
// @ac: 1
test('venue staff reject a booking request with a reason, a suggested venue and a suggested period', async ({ page }) => {
  const id = await requestedBooking('Suggest Both', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Too small for this event.')
  await suggestVenue(page, 'Auditorium')
  await suggestPeriod(page, { date: '2026-12-11', start: '10:00', end: '13:00' })
  await confirmReject(page)

  await expectRejected(page, id, 'Too small for this event.')
  await expect(suggestedVenue(page, id)).toHaveText('Auditorium')
  await expect(suggestedPeriod(page, id)).toHaveText('11 Dec 2026, 10:00–13:00')
})

// @tc: TC-SCRUM-78-04
// @test: a suggestion is optional: venue staff can still reject with a reason alone
// @story: SCRUM-78
// @ac: 1
test('a suggestion is optional: venue staff can still reject with a reason alone', async ({ page }) => {
  const id = await requestedBooking('Suggest None', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Already committed that week.')
  await confirmReject(page)

  await expectRejected(page, id, 'Already committed that week.')
  await expect(suggestedVenue(page, id)).toHaveCount(0)
  await expect(suggestedPeriod(page, id)).toHaveCount(0)
})

// @tc: TC-SCRUM-78-05
// @test: the event coordinator who raised the booking request sees the suggestion alongside the rejection reason
// @story: SCRUM-78
// @ac: 3
test('the event coordinator who raised the booking request sees the suggestion alongside the rejection reason', async ({ page }) => {
  const id = await requestedBooking('Suggest Seen By Coordinator', SEMINAR_ROOM_1)
  await rejectAsVenueStaff(SEMINAR_ROOM_1, id, {
    reason: 'Too small for this event.',
    suggested_venue_id: AUDITORIUM,
    suggested_date: '2026-12-11',
    suggested_start_time: '10:00',
    suggested_end_time: '13:00',
  })
  await login(page, 'coord1')
  await openVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId(`venue-detail-booking-event-${id}`)).toHaveText('Suggest Seen By Coordinator')
  await expect(status(page, id)).toHaveText('Rejected')
  await expect(decision(page, id)).toContainText('Too small for this event.')
  await expect(suggestedVenue(page, id)).toHaveText('Auditorium')
  await expect(suggestedPeriod(page, id)).toHaveText('11 Dec 2026, 10:00–13:00')
})

// @tc: TC-SCRUM-78-06
// @test: a suggestion does not create a booking request at the suggested venue
// @story: SCRUM-78
// @ac: 4
test('a suggestion does not create a booking request at the suggested venue', async ({ page }) => {
  const id = await requestedBooking('Suggest No Booking', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Too small for this event.')
  await suggestVenue(page, 'Auditorium')
  await suggestPeriod(page, { date: '2026-12-11', start: '10:00', end: '13:00' })
  await confirmReject(page)
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')

  // Found by its id: an earlier run against the same database leaves an event
  // of the same name on this page.
  await expect(status(page, id)).toHaveText('Rejected')
  await expect(page.getByTestId(`venue-detail-booking-event-${id}`)).toHaveText('Suggest No Booking')

  await openVenue(page, AUDITORIUM, 'Auditorium')
  await expect(page.locator('[data-testid^="venue-detail-booking-event-"]', { hasText: 'Suggest No Booking' })).toHaveCount(0)
})

// @tc: TC-SCRUM-78-07
// @test: a suggestion does not hold the suggested venue or period: another booking request for it can still be approved
// @story: SCRUM-78
// @ac: 4
test('a suggestion does not hold the suggested venue or period: another booking request for it can still be approved', async ({ page }) => {
  // The suggested venue is one this row creates, so the approval cannot clash
  // with another row's or a re-run's.
  const venueId = await ownVenue('SCRUM-78 TC-07 Hall')
  const period = { date: '2026-12-11', start_time: '10:00', end_time: '13:00' }
  const sourceId = await requestedBooking('Suggest Held Source', SEMINAR_ROOM_1)
  await rejectAsVenueStaff(SEMINAR_ROOM_1, sourceId, {
    reason: 'Too small for this event.',
    suggested_venue_id: venueId,
    suggested_date: period.date,
    suggested_start_time: period.start_time,
    suggested_end_time: period.end_time,
  })
  const otherId = await requestedBooking('Suggest Held Other', venueId, { raisedBy: 'coord2', ...period })

  await login(page, 'venue1')
  await openVenue(page, venueId, 'SCRUM-78 TC-07 Hall')
  await page.getByTestId(`venue-detail-booking-approve-button-${otherId}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking approved')
  await expect(status(page, otherId)).toHaveText('Approved')
  await expect(page.locator('[data-testid^="venue-detail-booking-event-"]', { hasText: 'Suggest Held Source' })).toHaveCount(0)
})

// @tc: TC-SCRUM-78-08
// @test: a suggested period missing its end time is refused and the booking request stays Requested
// @story: SCRUM-78
// @ac: 2
test('a suggested period missing its end time is refused and the booking request stays Requested', async ({ page }) => {
  const id = await requestedBooking('Suggest Incomplete Period', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Seminar Room 1 is taken that afternoon.')
  await suggestPeriod(page, { date: '2026-12-11', start: '09:00' })
  await confirmReject(page)

  await expect(page.getByTestId('venue-detail-decide-suggested-end-time-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-decide-suggested-date-error')).toHaveCount(0)
  await expect(page.getByTestId('venue-detail-decide-suggested-date-input')).toHaveValue('2026-12-11')
  await expect(page.getByTestId('venue-detail-decide-suggested-start-time-input')).toHaveValue('09:00')
  await expect(page.getByTestId('venue-detail-decide-reason-input')).toHaveValue(
    'Seminar Room 1 is taken that afternoon.',
  )
  await expectStillRequested(page, id)
})

// @tc: TC-SCRUM-78-09
// @test: a suggested period whose start is after its end is refused and the booking request stays Requested
// @story: SCRUM-78
// @ac: 2
test('a suggested period whose start is after its end is refused and the booking request stays Requested', async ({ page }) => {
  const id = await requestedBooking('Suggest Start After End', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Seminar Room 1 is taken that afternoon.')
  await suggestPeriod(page, { date: '2026-12-11', start: '12:01', end: '12:00' })
  await confirmReject(page)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('The suggested start time must be before the end time.')
  await expectStillRequested(page, id)
})

// @tc: TC-SCRUM-78-10
// @test: a suggested period whose start equals its end is refused and the booking request stays Requested
// @story: SCRUM-78
// @ac: 2
test('a suggested period whose start equals its end is refused and the booking request stays Requested', async ({ page }) => {
  const id = await requestedBooking('Suggest Start Equals End', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Seminar Room 1 is taken that afternoon.')
  await suggestPeriod(page, { date: '2026-12-11', start: '12:00', end: '12:00' })
  await confirmReject(page)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('The suggested start time must be before the end time.')
  await expectStillRequested(page, id)
})

// @tc: TC-SCRUM-78-11
// @test: a suggested period whose start is one minute before its end is accepted
// @story: SCRUM-78
// @ac: 2
test('a suggested period whose start is one minute before its end is accepted', async ({ page }) => {
  const id = await requestedBooking('Suggest One Minute', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Seminar Room 1 is taken that afternoon.')
  await suggestPeriod(page, { date: '2026-12-11', start: '12:00', end: '12:01' })
  await confirmReject(page)

  await expectRejected(page, id, 'Seminar Room 1 is taken that afternoon.')
  await expect(suggestedPeriod(page, id)).toHaveText('11 Dec 2026, 12:00–12:01')
})

// @tc: TC-SCRUM-78-12
// @test: a suggested venue that is the venue already requested, with no suggested period, is refused
// @story: SCRUM-78
// @ac: 2
test('a suggested venue that is the venue already requested, with no suggested period, is refused', async ({ page }) => {
  const id = await requestedBooking('Suggest Same Venue', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Please try again later.')
  await suggestVenue(page, 'Seminar Room 1')
  await confirmReject(page)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(NO_CHANGE)
  await expectStillRequested(page, id)
})

// @tc: TC-SCRUM-78-13
// @test: a suggestion that repeats both the requested venue and the requested period is refused
// @story: SCRUM-78
// @ac: 2
test('a suggestion that repeats both the requested venue and the requested period is refused', async ({ page }) => {
  const id = await requestedBooking('Suggest Same Everything', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await reason(page, 'Please try again later.')
  await suggestVenue(page, 'Seminar Room 1')
  await suggestPeriod(page, { date: '2026-12-10', start: '14:00', end: '17:00' })
  await confirmReject(page)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(NO_CHANGE)
  await expectStillRequested(page, id)
})

// @tc: TC-SCRUM-78-14
// @test: CHECK rejecting with a suggestion but no reason is refused
// @story: SCRUM-78
// @ac: 1
test('CHECK rejecting with a suggestion but no reason is refused', async ({ page }) => {
  const id = await requestedBooking('Suggest Missing Reason', SEMINAR_ROOM_1)
  await startRejecting(page, id)

  await suggestVenue(page, 'Auditorium')
  await confirmReject(page)

  await expect(page.getByTestId('venue-detail-decide-reason-error')).toBeVisible()
  await expectStillRequested(page, id)
})
