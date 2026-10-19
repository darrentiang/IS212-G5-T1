import { test, expect, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// SCRUM-63 Notify on Venue and Equipment Decisions. TC-SCRUM-63-01 to 14
// (test-case sheet), one test per row in the row's order.
//
// Each row stages and clears only its own "SCRUM-63 TCnn" records through
// fixtures/scrum63.py, on the rows' date, 15 Dec 2026, 10:00–12:00. Venue A,
// Venue B, Projector and Microphones are the row's own, named with its prefix,
// so no other spec's bookings or reservations touch them. A notification is
// found by the row's own event, never by counting the whole inbox.
//
// SCRUM-44 (reassignment) is not built, so TC08 stages its effect: the event
// is assigned to coord2. There is no Event Coordinator Lead account yet, so
// TC13 checks coord1 and venue1 only.

const script = fileURLToPath(new URL('../fixtures/scrum63.py', import.meta.url))
const BASE_URL = 'http://localhost:5173'
const PERIOD = '15 Dec 2026, 10:00–12:00'
let currentCase
let contexts = []

const fixture = (n, option) =>
  execFileSync('python', [script, String(n), ...(option ? [option] : [])], { encoding: 'utf8' })

function setup(n) {
  currentCase = n
  return JSON.parse(fixture(n))
}

test.afterEach(async () => {
  await Promise.all(contexts.map((c) => c.dispose()))
  contexts = []
  if (currentCase) fixture(currentCase, '--clear')
  currentCase = undefined
})

async function apiAs(username) {
  const api = await request.newContext({ baseURL: BASE_URL })
  contexts.push(api)
  expect((await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })).status()).toBe(200)
  return api
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

// The signed-in account's notifications about the event, as the page's own API reads them.
async function noticesAbout(page, event) {
  const reply = await page.request.get('/api/notifications')
  expect(reply.status()).toBe(200)
  return (await reply.json()).filter((row) => row.event_request_id === event.id || row.message.includes(event.name))
}

// Signs in, opens My Notifications and returns the event's rows shown there.
async function openNotifications(page, username, event) {
  await login(page, username)
  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  return noticesAbout(page, event)
}

async function expectOneNotice(page, event, message) {
  const rows = await noticesAbout(page, event)
  expect(rows).toHaveLength(1)
  const id = rows[0].id
  await expect(page.getByTestId(`notifications-message-${id}`)).toHaveText(message)
  await expect(page.getByTestId(`notifications-event-${id}`)).toHaveText(event.name)
  await expect(page.getByTestId(`notifications-status-${id}`)).toHaveText('Unread')
  return id
}

// --- venue page (venue1) ---
async function openVenue(page, venue) {
  await page.goto(`/venues/${venue.id}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText(venue.name)
}

async function approveBooking(page, f) {
  await openVenue(page, f.venue_a)
  await page.getByTestId(`venue-detail-booking-approve-button-${f.booking.id}`).click()
  await page.getByTestId('venue-detail-decide-confirm-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking approved')
  await expect(page.getByTestId(`venue-detail-booking-status-${f.booking.id}`)).toHaveText('Approved')
}

async function rejectBooking(page, f, reason, suggestion) {
  await openVenue(page, f.venue_a)
  await page.getByTestId(`venue-detail-booking-reject-button-${f.booking.id}`).click()
  await page.getByTestId('venue-detail-decide-reason-input').fill(reason)
  if (suggestion) {
    await page.getByTestId('venue-detail-decide-suggested-venue-input').selectOption({ label: suggestion.venue })
    await page.getByTestId('venue-detail-decide-suggested-date-input').fill(suggestion.date)
    await page.getByTestId('venue-detail-decide-suggested-start-time-input').fill(suggestion.start)
    await page.getByTestId('venue-detail-decide-suggested-end-time-input').fill(suggestion.end)
  }
  await page.getByTestId('venue-detail-decide-confirm-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking rejected')
  await expect(page.getByTestId(`venue-detail-booking-status-${f.booking.id}`)).toHaveText('Rejected')
}

async function bookingStatus(api, f) {
  const rows = await (await api.get(`/api/venues/${f.venue_a.id}/bookings`)).json()
  return rows.find((row) => row.id === f.booking.id).status
}

// --- equipment requirements page (tech1) ---
const el = (page, suffix) => page.getByTestId(`equipment-requirements-${suffix}`)

async function openEquipment(page, f) {
  await page.getByTestId('layout-nav-equipment-requirements').click()
  await page.getByTestId(`equipment-requests-event-${f.event.id}`).click()
  await expect(el(page, `row-${f.requirement.id}`)).toBeVisible()
}

async function requirementStatus(api, f) {
  const detail = await (await api.get(`/api/requests/${f.event.id}/equipment`)).json()
  return detail.requirements.find((row) => row.id === f.requirement.id)
}

// @tc: TC-SCRUM-63-01
// @test: Venue Staff approve a venue booking request and the assigned coordinator is notified with the event, venue and period.
// @story: SCRUM-63
// @ac: 1
test('Venue Staff approve a venue booking request and the assigned coordinator is notified with the event, venue and period.', async ({ page }) => {
  const f = setup(1)
  await login(page, 'venue1')
  await approveBooking(page, f)
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event,
    `Venue booking approved for ${f.event.name}: ${f.venue_a.name}, ${PERIOD}.`)
  expect(await bookingStatus(await apiAs('venue1'), f)).toBe('Approved')
})

// @tc: TC-SCRUM-63-02
// @test: Venue Staff reject a booking request with a reason and a suggested venue and period, and the coordinator is notified.
// @story: SCRUM-63
// @ac: 2
test('Venue Staff reject a booking request with a reason and a suggested venue and period, and the coordinator is notified.', async ({ page }) => {
  const f = setup(2)
  await login(page, 'venue1')
  await rejectBooking(page, f, 'Venue A is reserved for maintenance',
    { venue: f.venue_b.name, date: '2026-12-15', start: '13:00', end: '15:00' })
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event,
    `Venue booking rejected for ${f.event.name}: ${f.venue_a.name}, ${PERIOD}. ` +
    `Suggested venue: ${f.venue_b.name}. Suggested period: 15 Dec 2026, 13:00–15:00. ` +
    'Reason: Venue A is reserved for maintenance')
  expect(await bookingStatus(await apiAs('venue1'), f)).toBe('Rejected')
})

// @tc: TC-SCRUM-63-03
// @test: Venue Staff reject a booking request with a reason and no suggestion, and the notification shows the reason only.
// @story: SCRUM-63
// @ac: 2
test('Venue Staff reject a booking request with a reason and no suggestion, and the notification shows the reason only.', async ({ page }) => {
  const f = setup(3)
  await login(page, 'venue1')
  await rejectBooking(page, f, 'Venue A is too small for the expected attendance')
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  const id = await expectOneNotice(page, f.event,
    `Venue booking rejected for ${f.event.name}: ${f.venue_a.name}, ${PERIOD}. ` +
    'Reason: Venue A is too small for the expected attendance')
  await expect(page.getByTestId(`notifications-message-${id}`)).not.toContainText('Suggested')
})

// @tc: TC-SCRUM-63-04
// @test: Technical Support Staff approve an equipment requirement and the coordinator is notified with the equipment, quantity and decision.
// @story: SCRUM-63
// @ac: 3
test('Technical Support Staff approve an equipment requirement and the coordinator is notified with the equipment, quantity and decision.', async ({ page }) => {
  const f = setup(4)
  await login(page, 'tech1')
  await openEquipment(page, f)
  await el(page, `approve-${f.requirement.id}`).click()
  await el(page, 'review-save-button').click()
  await expect(el(page, 'banner')).toHaveText('Equipment requirement approved')
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event, `Equipment decision for ${f.event.name}: ${f.equipment.name} × 2 Approved.`)
  expect((await requirementStatus(await apiAs('tech1'), f)).status).toBe('Approved')
})

// @tc: TC-SCRUM-63-05
// @test: Technical Support Staff decline an equipment requirement with a reason and the coordinator is notified with the reason.
// @story: SCRUM-63
// @ac: 3
test('Technical Support Staff decline an equipment requirement with a reason and the coordinator is notified with the reason.', async ({ page }) => {
  const f = setup(5)
  await login(page, 'tech1')
  await openEquipment(page, f)
  await el(page, `decline-${f.requirement.id}`).click()
  await el(page, 'review-reason-input').fill('Wireless microphones cannot be provided.')
  await el(page, 'review-save-button').click()
  await expect(el(page, 'banner')).toHaveText('Equipment requirement declined')
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event,
    `Equipment decision for ${f.event.name}: ${f.equipment.name} × 4 Declined. ` +
    'Reason: Wireless microphones cannot be provided.')
  expect((await requirementStatus(await apiAs('tech1'), f)).status).toBe('Declined')
})

// @tc: TC-SCRUM-63-06
// @test: Technical Support Staff reserve equipment for the event and the coordinator is notified with the equipment type, quantity and period.
// @story: SCRUM-63
// @ac: 4
test('Technical Support Staff reserve equipment for the event and the coordinator is notified with the equipment type, quantity and period.', async ({ page }) => {
  const f = setup(6)
  await login(page, 'tech1')
  await openEquipment(page, f)
  await el(page, `reserve-${f.requirement.id}`).click()
  await el(page, 'reservation-save-button').click()
  await expect(el(page, 'banner')).toHaveText('Equipment reserved')
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event, `Equipment reserved for ${f.event.name}: ${f.equipment.name} × 2, ${PERIOD}.`)
})

// @tc: TC-SCRUM-63-07
// @test: Technical Support Staff release a reservation and the coordinator is notified with the equipment type, quantity and period.
// @story: SCRUM-63
// @ac: 4
test('Technical Support Staff release a reservation and the coordinator is notified with the equipment type, quantity and period.', async ({ page }) => {
  const f = setup(7)
  await login(page, 'tech1')
  await openEquipment(page, f)
  await el(page, `release-${f.reservation.id}`).click()
  await el(page, 'reservation-save-button').click()
  await expect(el(page, 'banner')).toHaveText('Equipment reservation released')
  await expect(el(page, `reservation-status-${f.reservation.id}`)).toHaveText('Released')
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event, `Equipment released for ${f.event.name}: ${f.equipment.name} × 2, ${PERIOD}.`)
})

// @tc: TC-SCRUM-63-08
// @test: After reassignment, only the newly assigned coordinator is notified and the removed coordinator is not.
// @story: SCRUM-63
// @ac: 5
test('After reassignment, only the newly assigned coordinator is notified and the removed coordinator is not.', async ({ page }) => {
  const f = setup(8)
  await login(page, 'venue1')
  await approveBooking(page, f)
  await logout(page)

  await openNotifications(page, 'coord2', f.event)
  await expectOneNotice(page, f.event,
    `Venue booking approved for ${f.event.name}: ${f.venue_a.name}, ${PERIOD}.`)
  await logout(page)

  expect(await openNotifications(page, 'coord1', f.event)).toEqual([])
  await page.reload()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  expect(await noticesAbout(page, f.event)).toEqual([])
})

// @tc: TC-SCRUM-63-09
// @test: A decision on an event with no assigned coordinator still goes through and creates no notification.
// @story: SCRUM-63
// @ac: 5
test('A decision on an event with no assigned coordinator still goes through and creates no notification.', async ({ page }) => {
  const f = setup(9)
  await login(page, 'tech1')
  await openEquipment(page, f)
  await el(page, `approve-${f.requirement.id}`).click()
  await el(page, 'review-save-button').click()
  await expect(el(page, 'banner')).toHaveText('Equipment requirement approved')

  await page.reload()
  await expect(el(page, `status-${f.requirement.id}`)).toHaveText('Approved')
  await expect(el(page, `decision-${f.requirement.id}`)).toContainText('tech1 — ')
  const stored = await requirementStatus(await apiAs('tech1'), f)
  expect(stored.status).toBe('Approved')
  expect(stored.decided_at).toBeTruthy()
  await logout(page)

  expect(await openNotifications(page, 'coord1', f.event)).toEqual([])
  await logout(page)
  expect(await openNotifications(page, 'coord2', f.event)).toEqual([])
})

// @tc: TC-SCRUM-63-10
// @test: A refused equipment decision creates no notification.
// @story: SCRUM-63
// @ac: 6
test('A refused equipment decision creates no notification.', async ({ page }) => {
  const f = setup(10)
  await login(page, 'tech1')
  await openEquipment(page, f)
  // The page stops an empty reason itself; the API refuses three spaces.
  await el(page, `decline-${f.requirement.id}`).click()
  await el(page, 'review-save-button').click()
  await expect(el(page, 'review-reason-error')).toBeVisible()
  const tech = await apiAs('tech1')
  for (const reason of ['', '   ']) {
    const reply = await tech.patch(`/api/requests/${f.event.id}/equipment/${f.requirement.id}/decision`,
      { data: { decision: 'Declined', reason } })
    expect(reply.status()).toBe(400)
  }
  await page.reload()
  await expect(el(page, `status-${f.requirement.id}`)).toHaveText('Requested')
  await logout(page)

  expect(await openNotifications(page, 'coord1', f.event)).toEqual([])
})

// @tc: TC-SCRUM-63-11
// @test: A decision attempted by an account without permission is refused and creates no notification.
// @story: SCRUM-63
// @ac: 6
test('A decision attempted by an account without permission is refused and creates no notification.', async ({ page }) => {
  const f = setup(11)
  await login(page, 'coord1')
  const reply = await page.request.patch(`/api/requests/${f.event.id}/equipment/${f.requirement.id}/decision`,
    { data: { decision: 'Approved' } })
  expect(reply.status()).toBe(403)

  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  expect(await noticesAbout(page, f.event)).toEqual([])
  await page.goto(`/requests/${f.event.id}/equipment`)
  await expect(el(page, `status-${f.requirement.id}`)).toHaveText('Requested')
})

// @tc: TC-SCRUM-63-12
// @test: Each decision creates exactly one notification and a reload does not add another.
// @story: SCRUM-63
// @ac: 6
test('Each decision creates exactly one notification and a reload does not add another.', async ({ page }) => {
  const f = setup(12)
  await login(page, 'venue1')
  await approveBooking(page, f)
  await page.reload()
  await page.reload()
  await expect(page.getByTestId(`venue-detail-booking-status-${f.booking.id}`)).toHaveText('Approved')
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  await expectOneNotice(page, f.event, `Venue booking approved for ${f.event.name}: ${f.venue_a.name}, ${PERIOD}.`)
  await page.reload()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  expect(await noticesAbout(page, f.event)).toHaveLength(1)
})

// @tc: TC-SCRUM-63-13
// @test: Withdrawing a booking request notifies no one.
// @story: SCRUM-63
// @ac: 7
test('Withdrawing a booking request notifies no one.', async ({ page }) => {
  const f = setup(13)
  await login(page, 'coord1')
  await openVenue(page, f.venue_a)
  await page.getByTestId(`venue-detail-booking-withdraw-button-${f.booking.id}`).click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Booking withdrawn')
  await expect(page.getByTestId(`venue-detail-booking-status-${f.booking.id}`)).toHaveText('Withdrawn')

  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  expect(await noticesAbout(page, f.event)).toEqual([])
  await logout(page)
  expect(await openNotifications(page, 'venue1', f.event)).toEqual([])
})

// @tc: TC-SCRUM-63-14
// @test: A decision notification appears in the coordinator's notifications list with the event name and is private to that coordinator.
// @story: SCRUM-63
// @ac: 8
test("A decision notification appears in the coordinator's notifications list with the event name and is private to that coordinator.", async ({ page }) => {
  const f = setup(14)
  // The unread number is this row's own: coord1's inbox is read first so no
  // other spec's notice is counted.
  const coord1 = await apiAs('coord1')
  expect((await coord1.post('/api/notifications/mark-all-read')).status()).toBe(200)
  await login(page, 'venue1')
  await approveBooking(page, f)
  await logout(page)

  await openNotifications(page, 'coord1', f.event)
  const id = await expectOneNotice(page, f.event,
    `Venue booking approved for ${f.event.name}: ${f.venue_a.name}, ${PERIOD}.`)
  await expect(page.getByTestId(`notifications-created-at-${id}`)).toHaveText(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}$/)
  await expect(page.getByTestId('layout-nav-notifications-count')).toHaveText('1')
  await logout(page)

  expect(await openNotifications(page, 'coord2', f.event)).toEqual([])
  await expect(page.getByTestId(`notifications-row-${id}`)).toHaveCount(0)
})
