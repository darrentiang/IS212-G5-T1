import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-83 Manage Several Venues for One Event. TC-SCRUM-83-01 to 07 (test-case
// sheet), one test per row in the row's order.
//
// Every row builds its own venues and events through the API (AUTOMATION.md:
// data a test changes it creates itself). The rows' Seminar Room 1 is a venue
// of the row's own with 30 minutes of setup and of turnaround, and their
// Auditorium one with none, so changing the seeded venues' times never touches
// another spec. Approval assigns the coordinator by workload, so "coord1" and
// "coord2" in the rows are whoever approval assigned to each event, read from
// the event. Each row's events fall on a Saturday of its own, 10:00–12:00, so
// they occupy the Seminar Room 09:30–12:30 and the Auditorium 10:00–12:00.
// Dates are relative to today because an event cannot be submitted for a date
// already past.

const BASE_URL = 'http://localhost:5173'
const SETUP = { setup_time: 30, turnaround_time: 30 }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const REASON = 'Room too small'

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-83',
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

const pad = (value) => String(value).padStart(2, '0')
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

// The row's Saturday (its "5 Dec 2026"), well ahead and one per row.
function saturdayFor(offset) {
  const saturday = new Date()
  saturday.setDate(saturday.getDate() + 200 + offset * 7)
  saturday.setDate(saturday.getDate() + ((6 - saturday.getDay() + 7) % 7))
  return iso(saturday)
}

// '2026-12-05' -> '05 Dec 2026' (app/format.js formatDate).
function shown(isoDate) {
  const [year, month, day] = isoDate.split('-')
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`
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
async function seminarRoom(name) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 60 } })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    const timed = await staff.patch(`/api/venues/${id}/times`, { data: SETUP })
    expect(timed.ok()).toBeTruthy()
    return id
  })
}

// The row's Auditorium: no setup or turnaround time.
async function auditorium(name) {
  return as('venue1', async (staff) => {
    const created = await staff.post('/api/venues', { data: { name, location: 'Block T', max_capacity: 400 } })
    expect(created.status()).toBe(201)
    return (await created.json()).id
  })
}

// A Planning event with its assigned coordinator: org1 submits it and an
// Event Coordinator approves it, which assigns one and moves it to Planning.
async function planningEvent(name, date) {
  const id = await as('org1', async (organiser) => {
    const submitted = await organiser.post('/api/requests', {
      data: { name, ...TEXT_FIELDS, date, start_time: '10:00', end_time: '12:00', attendance: 40 },
    })
    expect(submitted.status()).toBe(201)
    return (await submitted.json()).id
  })
  const body = await as('coord1', async (coordinator) => {
    const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
    return approved.json()
  })
  expect(body.status).toBe('Planning')
  return { id, name, coordinator: body.assigned_coordinator }
}

// Raised by the event's assigned coordinator, as the rows' "raised by coord1".
async function raiseBooking(event, venueId) {
  return as(event.coordinator, async (coordinator) => {
    const raised = await coordinator.post(`/api/requests/${event.id}/bookings`, { data: { venue_id: venueId } })
    expect(raised.status()).toBe(201)
    return (await raised.json()).id
  })
}

async function decideBooking(venueId, bookingId, action, reason = '') {
  await as('venue1', async (staff) => {
    const decided = await staff.post(`/api/venues/${venueId}/bookings/${bookingId}/${action}`, { data: { reason } })
    expect(decided.ok()).toBeTruthy()
  })
}

async function approvedBooking(event, venueId) {
  const bookingId = await raiseBooking(event, venueId)
  await decideBooking(venueId, bookingId, 'approve')
  return bookingId
}

async function openEvent(page, event) {
  await page.goto(`/requests/${event.id}`)
  await expect(page.getByTestId('request-detail-bookings')).toBeVisible()
}

async function cancelInPage(page, bookingId, reason) {
  await page.getByTestId(`request-detail-booking-cancel-button-${bookingId}`).click()
  if (reason) await page.getByTestId('request-detail-booking-cancel-reason-input').fill(reason)
  await page.getByTestId('request-detail-booking-cancel-confirm-button').click()
}

// @tc: TC-SCRUM-83-01
// @test: the venue section lists every booking request with its venue, period and status, offering Cancel booking and Withdraw only where they apply
// @story: SCRUM-83
// @ac: 1
test('the venue section lists every booking request with its venue, period and status, offering Cancel booking and Withdraw only where they apply', async ({
  page,
}) => {
  const day = saturdayFor(1)
  const seminar = await seminarRoom('TC83-01 Seminar Room')
  const hall = await auditorium('TC83-01 Auditorium')
  const gala = await planningEvent('TC83-01 Multi Venue Gala', day)
  const approved = await approvedBooking(gala, seminar)
  const rejected = await raiseBooking(gala, hall)
  await decideBooking(hall, rejected, 'reject', 'Stage under repair')
  const requested = await raiseBooking(gala, hall)

  await login(page, gala.coordinator)
  await openEvent(page, gala)

  const rows = [
    [approved, 'TC83-01 Seminar Room', '09:30–12:30', 'Approved'],
    [requested, 'TC83-01 Auditorium', '10:00–12:00', 'Requested'],
    [rejected, 'TC83-01 Auditorium', '10:00–12:00', 'Rejected'],
  ]
  for (const [id, venue, period, status] of rows) {
    await expect(page.getByTestId(`request-detail-booking-venue-${id}`)).toHaveText(venue)
    await expect(page.getByTestId(`request-detail-booking-period-${id}`)).toHaveText(`${shown(day)}, ${period}`)
    await expect(page.getByTestId(`request-detail-booking-status-${id}`)).toHaveText(status)
  }
  await expect(page.getByTestId(`request-detail-booking-cancel-button-${approved}`)).toBeVisible()
  await expect(page.getByTestId(`request-detail-booking-withdraw-button-${approved}`)).toHaveCount(0)
  await expect(page.getByTestId(`request-detail-booking-withdraw-button-${requested}`)).toBeVisible()
  await expect(page.getByTestId(`request-detail-booking-cancel-button-${requested}`)).toHaveCount(0)
  await expect(page.getByTestId(`request-detail-booking-row-${rejected}`).getByRole('button')).toHaveCount(0)
})

// @tc: TC-SCRUM-83-02
// @test: venue staff approve the event's request at a second venue for the same period while it holds an approved booking at the first
// @story: SCRUM-83
// @ac: 2
test("venue staff approve the event's request at a second venue for the same period while it holds an approved booking at the first", async ({
  page,
}) => {
  const day = saturdayFor(2)
  const seminar = await seminarRoom('TC83-02 Seminar Room')
  const hall = await auditorium('TC83-02 Auditorium')
  const gala = await planningEvent('TC83-02 Multi Venue Gala', day)
  const seminarBooking = await approvedBooking(gala, seminar)
  const hallBooking = await raiseBooking(gala, hall)

  await login(page, 'venue1')
  await page.goto(`/venues/${hall}`)
  await page.getByTestId(`venue-detail-booking-approve-button-${hallBooking}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${hallBooking}`)).toHaveText('Approved')

  await logout(page)
  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await expect(page.getByTestId(`request-detail-booking-status-${seminarBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId(`request-detail-booking-status-${hallBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-83-03
// @test: the assigned coordinator cancels the Seminar Room booking with a reason and only that booking changes
// @story: SCRUM-83
// @ac: 3, 5
test('the assigned coordinator cancels the Seminar Room booking with a reason and only that booking changes', async ({
  page,
}) => {
  const day = saturdayFor(3)
  const seminar = await seminarRoom('TC83-03 Seminar Room')
  const hall = await auditorium('TC83-03 Auditorium')
  const gala = await planningEvent('TC83-03 Multi Venue Gala', day)
  const seminarBooking = await approvedBooking(gala, seminar)
  const hallBooking = await approvedBooking(gala, hall)

  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await cancelInPage(page, seminarBooking, REASON)
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Booking cancelled')
  await page.reload()

  await expect(page.getByTestId(`request-detail-booking-status-${seminarBooking}`)).toHaveText('Cancelled')
  await expect(page.getByTestId(`request-detail-booking-cancel-reason-${seminarBooking}`)).toHaveText(REASON)
  await expect(page.getByTestId(`request-detail-booking-cancel-button-${seminarBooking}`)).toHaveCount(0)
  await expect(page.getByTestId(`request-detail-booking-status-${hallBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-83-04
// @test: once the Seminar Room booking is cancelled, another event's overlapping request for it is approved with no conflict
// @story: SCRUM-83
// @ac: 3
test("once the Seminar Room booking is cancelled, another event's overlapping request for it is approved with no conflict", async ({
  page,
}) => {
  const day = saturdayFor(4)
  const seminar = await seminarRoom('TC83-04 Seminar Room')
  const hall = await auditorium('TC83-04 Auditorium')
  const gala = await planningEvent('TC83-04 Multi Venue Gala', day)
  const galaBooking = await approvedBooking(gala, seminar)
  await approvedBooking(gala, hall)
  const rival = await planningEvent('TC83-04 Rival Workshop', day)
  const rivalBooking = await raiseBooking(rival, seminar)

  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await cancelInPage(page, galaBooking, REASON)
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Booking cancelled')
  await logout(page)
  await login(page, 'venue1')
  await page.goto(`/venues/${seminar}`)
  await page.getByTestId(`venue-detail-booking-approve-button-${rivalBooking}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${rivalBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId(`venue-detail-occupied-event-${rivalBooking}`)).toHaveText('TC83-04 Rival Workshop')
  await expect(page.getByTestId(`venue-detail-occupied-period-${rivalBooking}`)).toHaveText(
    `${shown(day)}, 09:30 to ${shown(day)}, 12:30`,
  )
  await expect(page.getByTestId(`venue-detail-occupied-row-${galaBooking}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-83-05
// @test: confirming Cancel booking with an empty reason is refused in the form and nothing changes
// @story: SCRUM-83
// @ac: 4
test('confirming Cancel booking with an empty reason is refused in the form and nothing changes', async ({ page }) => {
  const day = saturdayFor(5)
  const seminar = await seminarRoom('TC83-05 Seminar Room')
  const hall = await auditorium('TC83-05 Auditorium')
  const gala = await planningEvent('TC83-05 Multi Venue Gala', day)
  const seminarBooking = await approvedBooking(gala, seminar)
  await approvedBooking(gala, hall)
  const sent = []
  page.on('request', (req) => {
    if (req.url().endsWith('/cancel')) sent.push(req.url())
  })

  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await cancelInPage(page, seminarBooking, '')

  await expect(page.getByTestId('request-detail-booking-cancel-reason-error')).toHaveText('Reason is required.')
  expect(sent).toEqual([])
  await page.reload()
  await expect(page.getByTestId(`request-detail-booking-status-${seminarBooking}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-83-06
// @test: a booking request awaiting a decision cannot be cancelled, in the page or directly
// @story: SCRUM-83
// @ac: 4
test('a booking request awaiting a decision cannot be cancelled, in the page or directly', async ({ page }) => {
  const day = saturdayFor(6)
  const hall = await auditorium('TC83-06 Auditorium')
  const gala = await planningEvent('TC83-06 Multi Venue Gala', day)
  const hallBooking = await raiseBooking(gala, hall)

  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await expect(page.getByTestId(`request-detail-booking-withdraw-button-${hallBooking}`)).toBeVisible()
  await expect(page.getByTestId(`request-detail-booking-cancel-button-${hallBooking}`)).toHaveCount(0)

  const direct = await page.request.post(`/api/venues/${hall}/bookings/${hallBooking}/cancel`, {
    data: { reason: REASON },
  })
  expect(direct.status()).toBe(409)
  expect((await direct.json()).message).toBe('Only an approved booking can be cancelled.')

  await page.reload()
  await expect(page.getByTestId(`request-detail-booking-status-${hallBooking}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-83-07
// @test: an approved booking cannot be cancelled while its event is in Safety Check, in the page or directly
// @story: SCRUM-83
// @ac: 4
test('an approved booking cannot be cancelled while its event is in Safety Check, in the page or directly', async ({
  page,
}) => {
  const day = saturdayFor(7)
  const seminar = await seminarRoom('TC83-07 Seminar Room')
  const gala = await planningEvent('TC83-07 Multi Venue Gala', day)
  const seminarBooking = await approvedBooking(gala, seminar)
  await as(gala.coordinator, async (coordinator) => {
    const sentForCheck = await coordinator.post(`/api/requests/${gala.id}/send-for-safety-check`)
    expect(sentForCheck.ok()).toBeTruthy()
  })

  await login(page, gala.coordinator)
  await openEvent(page, gala)
  await expect(page.getByTestId(`request-detail-booking-status-${seminarBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId(`request-detail-booking-cancel-button-${seminarBooking}`)).toHaveCount(0)

  const direct = await page.request.post(`/api/venues/${seminar}/bookings/${seminarBooking}/cancel`, {
    data: { reason: REASON },
  })
  expect(direct.status()).toBe(409)
  expect((await direct.json()).message).toBe(
    'A booking can be cancelled only while the event is Approved or Planning.',
  )

  await page.reload()
  await expect(page.getByTestId(`request-detail-booking-status-${seminarBooking}`)).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
})
