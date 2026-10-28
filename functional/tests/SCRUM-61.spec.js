import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// One independently staged test per curated sheet row (fixtures/scrum61.py builds
// each row's event, venues, bookings, holds and reservations under its own name).
// The rows' dates are fixed, so every test pins the application clock.
const script = fileURLToPath(new URL('../fixtures/scrum61.py', import.meta.url))
const fixture = (n, flag) =>
  JSON.parse(execFileSync('python', [script, String(n), ...(flag ? [flag] : [])], { encoding: 'utf8' }) || 'null')
const snapshot = (n) => fixture(n, '--snapshot')

let currentCase
let contexts = []

const shown = (page, id) => page.getByTestId(id)
const edit = (page, suffix) => page.getByTestId(`request-detail-event-edit-${suffix}`)

async function login(page, user = 'coord1') {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(user)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(user)
}

// The row's event, and its arrangements' ids by venue label ('Venue A', ...).
async function setup(n, page, { user = 'coord1', at = '2026-10-26T10:00' } = {}) {
  clearClock()
  currentCase = n
  const data = fixture(n)
  pinClock(at)
  await login(page, user)
  const before = snapshot(n)
  const prefix = `SCRUM-61 TC${String(n).padStart(2, '0')} `
  const venueId = (label) => before.venues.find((v) => v.name === prefix + label).id
  return {
    event: data.events[0],
    before,
    venueId,
    booking: (label) => before.venue_booking_requests.find((b) => b.venue_id === venueId(label)).id,
    hold: (label) => before.venue_holds.find((h) => h.venue_id === venueId(label)).id,
    reservation: () => before.reservations[0].id,
  }
}

async function open(page, event) {
  await page.goto(`/requests/${event.id}`)
  await expect(shown(page, 'request-detail-status')).toBeVisible()
}

// SCRUM-47's Edit event form: change the fields named, then save.
async function change(page, values) {
  await edit(page, 'button').click()
  await expect(edit(page, 'form')).toBeVisible()
  for (const [input, value] of Object.entries(values)) await edit(page, `${input}-input`).fill(value)
  await edit(page, 'confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Event updated')
}

const tooSmall = (page, id) => shown(page, `request-detail-booking-too-small-${id}`)
const holdTooSmall = (page, id) => shown(page, `request-detail-hold-too-small-${id}`)
const timing = (page, id) => shown(page, `request-detail-booking-timing-mismatch-${id}`)
const reservationTiming = (page, id) => shown(page, `equipment-requirements-reservation-timing-mismatch-${id}`)
const statuses = (s) => ({
  bookings: s.venue_booking_requests.map(({ id, status, date, start_time, end_time }) => ({ id, status, date, start_time, end_time })),
  holds: s.venue_holds.map(({ id, status, expires_at }) => ({ id, status, expires_at })),
  reservations: s.reservations.map(({ id, status, date, start_time, end_time }) => ({ id, status, date, start_time, end_time })),
})

async function session(browser, user) {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  await login(page, user)
  return page
}

test.afterEach(async () => {
  try {
    for (const context of contexts) await context.close()
  } finally {
    contexts = []
    clearClock()
    if (currentCase) fixture(currentCase, '--clear')
    currentCase = undefined
  }
})

// @tc: TC-SCRUM-61-01
// @test: raising attendance above an approved booking's venue capacity flags it too small
// @story: SCRUM-61
// @ac: 1, 3, 4
test("raising attendance above an approved booking's venue capacity flags it too small", async ({ page }) => {
  const { event, before, booking } = await setup(1, page)
  await open(page, event)
  await change(page, { attendance: '60' })
  await page.reload()
  await expect(tooSmall(page, booking('Venue A'))).toHaveText('Too small')
  await expect(shown(page, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
  await expect(shown(page, 'request-detail-status')).toHaveText('Planning')
  expect(statuses(snapshot(1))).toEqual(statuses(before))
})

// @tc: TC-SCRUM-61-02
// @test: attendance just below and equal to the venue capacity is not flagged
// @story: SCRUM-61
// @ac: 1, 2
test('attendance just below and equal to the venue capacity is not flagged', async ({ page }) => {
  const { event, booking } = await setup(2, page)
  await open(page, event)
  for (const attendance of ['49', '50']) {
    await change(page, { attendance })
    await expect(shown(page, 'request-detail-attendance')).toHaveText(attendance)
    await expect(shown(page, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
    await expect(tooSmall(page, booking('Venue A'))).toHaveCount(0)
  }
})

// @tc: TC-SCRUM-61-03
// @test: attendance one above the venue capacity is flagged
// @story: SCRUM-61
// @ac: 1, 2
test('attendance one above the venue capacity is flagged', async ({ page }) => {
  const { event, booking } = await setup(3, page)
  await open(page, event)
  await expect(tooSmall(page, booking('Venue A'))).toHaveCount(0)
  await change(page, { attendance: '51' })
  await expect(tooSmall(page, booking('Venue A'))).toHaveText('Too small')
  await expect(shown(page, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
})

// @tc: TC-SCRUM-61-04
// @test: each venue is compared on its own
// @story: SCRUM-61
// @ac: 1
test('each venue is compared on its own', async ({ page }) => {
  const { event, booking } = await setup(4, page)
  await open(page, event)
  await change(page, { attendance: '80' })
  await expect(tooSmall(page, booking('Venue A'))).toHaveText('Too small')
  await expect(shown(page, `request-detail-booking-status-${booking('Venue B')}`)).toHaveText('Approved')
  await expect(tooSmall(page, booking('Venue B'))).toHaveCount(0)
})

// @tc: TC-SCRUM-61-05
// @test: a pending request and a held venue are flagged too and neither is withdrawn or released
// @story: SCRUM-61
// @ac: 1, 3, 4
test('a pending request and a held venue are flagged too and neither is withdrawn or released', async ({ page }) => {
  const { event, before, booking, hold } = await setup(5, page)
  await open(page, event)
  await change(page, { attendance: '40' })
  await page.reload()
  await expect(tooSmall(page, booking('Venue C'))).toHaveText('Too small')
  await expect(shown(page, `request-detail-booking-status-${booking('Venue C')}`)).toHaveText('Requested')
  await expect(holdTooSmall(page, hold('Venue D'))).toHaveText('Too small')
  await expect(shown(page, `request-detail-hold-status-${hold('Venue D')}`)).toHaveText('Held')
  expect(statuses(snapshot(5))).toEqual(statuses(before))
})

// @tc: TC-SCRUM-61-06
// @test: lowering a venue's capacity below the attendance flags the event's booking
// @story: SCRUM-61
// @ac: 1, 3
test("lowering a venue's capacity below the attendance flags the event's booking", async ({ page, browser }) => {
  const { event, booking, venueId } = await setup(6, page, { user: 'venue1' })
  await page.goto(`/venues/${venueId('Venue A')}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('30')
  await page.getByTestId('venue-detail-update-save-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toBeVisible()
  await expect(page.getByTestId('venue-detail-booking-too-small-' + booking('Venue A'))).toHaveText('Too small')

  const coordinator = await session(browser, 'coord1')
  await open(coordinator, event)
  await expect(tooSmall(coordinator, booking('Venue A'))).toHaveText('Too small')
  await expect(shown(coordinator, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
  await expect(shown(coordinator, 'request-detail-attendance')).toHaveText('40')
})

// @tc: TC-SCRUM-61-07
// @test: venue staff see the flag on the venue's booking requests
// @story: SCRUM-61
// @ac: 3
test("venue staff see the flag on the venue's booking requests", async ({ page }) => {
  const { booking, venueId } = await setup(7, page, { user: 'venue1' })
  for (const [label, status] of [['Venue A', 'Requested'], ['Venue B', 'Approved']]) {
    await page.goto(`/venues/${venueId(label)}`)
    await expect(page.getByTestId(`venue-detail-booking-status-${booking(label)}`)).toHaveText(status)
    await expect(page.getByTestId(`venue-detail-booking-too-small-${booking(label)}`)).toHaveText('Too small')
  }
})

// @tc: TC-SCRUM-61-08
// @test: the safety officer sees the flag on the safety check card
// @story: SCRUM-61
// @ac: 3
test('the safety officer sees the flag on the safety check card', async ({ page }) => {
  const { event, booking } = await setup(8, page, { user: 'safety1' })
  await open(page, event)
  await expect(page.getByTestId(`request-detail-safety-booking-${booking('Venue A')}-capacity`)).toHaveText('50')
  await expect(page.getByTestId(`request-detail-safety-booking-${booking('Venue A')}-too-small`)).toHaveText('Too small')
  await expect(shown(page, 'request-detail-status')).toHaveText('Safety Check')
})

// @tc: TC-SCRUM-61-09
// @test: the flag clears when attendance is back within capacity
// @story: SCRUM-61
// @ac: 5
test('the flag clears when attendance is back within capacity', async ({ page }) => {
  const { event, before, booking } = await setup(9, page)
  await open(page, event)
  await expect(tooSmall(page, booking('Venue A'))).toHaveText('Too small')
  await change(page, { attendance: '50' })
  await page.reload()
  await expect(tooSmall(page, booking('Venue A'))).toHaveCount(0)
  await expect(shown(page, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
  expect(statuses(snapshot(9))).toEqual(statuses(before))
})

// @tc: TC-SCRUM-61-10
// @test: cancelling the booking withdrawing the request and releasing the hold each clear its flag
// @story: SCRUM-61
// @ac: 5
test('cancelling the booking withdrawing the request and releasing the hold each clear its flag', async ({ page }) => {
  const { event, booking, hold } = await setup(10, page)
  const [a, b, c] = [booking('Venue A'), booking('Venue B'), hold('Venue C')]
  await open(page, event)
  await expect(tooSmall(page, a)).toBeVisible()
  await expect(tooSmall(page, b)).toBeVisible()
  await expect(holdTooSmall(page, c)).toBeVisible()

  await page.getByTestId(`request-detail-booking-cancel-button-${a}`).click()
  await page.getByTestId('request-detail-booking-cancel-reason-input').fill('Venue too small')
  await page.getByTestId('request-detail-booking-cancel-confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Booking cancelled')
  await page.getByTestId(`request-detail-booking-withdraw-button-${b}`).click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Booking withdrawn')
  await page.getByTestId(`request-detail-hold-release-button-${c}`).click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold released')

  await page.reload()
  await expect(shown(page, `request-detail-booking-status-${a}`)).toHaveText('Cancelled')
  await expect(shown(page, `request-detail-booking-status-${b}`)).toHaveText('Withdrawn')
  await expect(shown(page, `request-detail-hold-status-${c}`)).toHaveText('Released')
  await expect(tooSmall(page, a)).toHaveCount(0)
  await expect(tooSmall(page, b)).toHaveCount(0)
  await expect(holdTooSmall(page, c)).toHaveCount(0)
  await expect(shown(page, 'request-detail-attendance')).toHaveText('60')
})

// @tc: TC-SCRUM-61-11
// @test: a rejected request and an expired hold no longer show the flag
// @story: SCRUM-61
// @ac: 5
test('a rejected request and an expired hold no longer show the flag', async ({ page, browser }) => {
  const { event, booking, hold, venueId } = await setup(11, page, { user: 'venue1', at: '2026-11-14T08:59' })
  await page.goto(`/venues/${venueId('Venue A')}`)
  await page.getByTestId(`venue-detail-booking-reject-button-${booking('Venue A')}`).click()
  await page.getByTestId('venue-detail-decide-reason-input').fill('Capacity too small')
  await page.getByTestId('venue-detail-decide-confirm-button').click()
  await expect(page.getByTestId(`venue-detail-booking-status-${booking('Venue A')}`)).toHaveText('Rejected')
  await expect(page.getByTestId(`venue-detail-booking-too-small-${booking('Venue A')}`)).toHaveCount(0)

  pinClock('2026-11-14T09:00')
  const coordinator = await session(browser, 'coord1')
  await open(coordinator, event)
  await expect(shown(coordinator, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Rejected')
  await expect(tooSmall(coordinator, booking('Venue A'))).toHaveCount(0)
  await expect(shown(coordinator, `request-detail-hold-status-${hold('Venue B')}`)).toHaveText('Expired')
  await expect(holdTooSmall(coordinator, hold('Venue B'))).toHaveCount(0)
  await expect(shown(coordinator, 'request-detail-attendance')).toHaveText('60')
})

// @tc: TC-SCRUM-61-12
// @test: changing the event's date flags its booking request and reservation and moves none of them
// @story: SCRUM-61
// @ac: 3, 4, 6
test("changing the event's date flags its booking request and reservation and moves none of them", async ({ page, browser }) => {
  const { event, before, booking, reservation } = await setup(12, page)
  await open(page, event)
  await change(page, { date: '2026-11-22' })
  await page.reload()
  for (const label of ['Venue A', 'Venue B']) {
    await expect(timing(page, booking(label))).toHaveText('Timing mismatch')
    await expect(tooSmall(page, booking(label))).toHaveCount(0)
  }
  await expect(shown(page, `request-detail-booking-status-${booking('Venue B')}`)).toHaveText('Requested')
  await page.goto(`/requests/${event.id}/equipment`)
  await expect(reservationTiming(page, reservation())).toHaveText('Timing mismatch')
  await expect(shown(page, `equipment-requirements-reservation-status-${reservation()}`)).toHaveText('Reserved')

  const tech = await session(browser, 'tech1')
  await tech.goto(`/requests/${event.id}/equipment`)
  await expect(reservationTiming(tech, reservation())).toHaveText('Timing mismatch')
  expect(statuses(snapshot(12))).toEqual(statuses(before))
})

// @tc: TC-SCRUM-61-13
// @test: a one-minute difference in the end time is a mismatch
// @story: SCRUM-61
// @ac: 6
test('a one-minute difference in the end time is a mismatch', async ({ page }) => {
  const { event, before, booking } = await setup(13, page)
  await open(page, event)
  await expect(shown(page, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
  await expect(timing(page, booking('Venue A'))).toHaveCount(0)
  await change(page, { 'end-time': '12:01' })
  await expect(timing(page, booking('Venue A'))).toHaveText('Timing mismatch')
  expect(statuses(snapshot(13))).toEqual(statuses(before))
})

// @tc: TC-SCRUM-61-14
// @test: arrangements that no longer hold anything are never flagged for timing
// @story: SCRUM-61
// @ac: 6
test('arrangements that no longer hold anything are never flagged for timing', async ({ page }) => {
  const { event, before, booking, hold, reservation } = await setup(14, page)
  await open(page, event)
  await change(page, { date: '2026-11-22' })
  await page.reload()
  for (const [label, status] of [['Venue A', 'Rejected'], ['Venue B', 'Withdrawn'], ['Venue C', 'Cancelled']]) {
    await expect(shown(page, `request-detail-booking-status-${booking(label)}`)).toHaveText(status)
    await expect(timing(page, booking(label))).toHaveCount(0)
  }
  for (const [label, status] of [['Venue D', 'Released'], ['Venue E', 'Expired']]) {
    await expect(shown(page, `request-detail-hold-status-${hold(label)}`)).toHaveText(status)
  }
  await page.goto(`/requests/${event.id}/equipment`)
  await expect(shown(page, `equipment-requirements-reservation-status-${reservation()}`)).toHaveText('Released')
  await expect(reservationTiming(page, reservation())).toHaveCount(0)
  expect(statuses(snapshot(14))).toEqual(statuses(before))
})

// @tc: TC-SCRUM-61-15
// @test: putting the event's date back clears the timing flags
// @story: SCRUM-61
// @ac: 5, 6
test("putting the event's date back clears the timing flags", async ({ page }) => {
  const { event, before, booking, reservation } = await setup(15, page)
  await open(page, event)
  await expect(timing(page, booking('Venue A'))).toHaveText('Timing mismatch')
  await change(page, { date: '2026-11-15' })
  await page.reload()
  await expect(shown(page, `request-detail-booking-status-${booking('Venue A')}`)).toHaveText('Approved')
  await expect(timing(page, booking('Venue A'))).toHaveCount(0)
  await page.goto(`/requests/${event.id}/equipment`)
  await expect(shown(page, `equipment-requirements-reservation-status-${reservation()}`)).toHaveText('Reserved')
  await expect(reservationTiming(page, reservation())).toHaveCount(0)
  expect(statuses(snapshot(15))).toEqual(statuses(before))
})
