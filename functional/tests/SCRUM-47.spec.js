import { test, expect, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// One independently staged test per curated sheet row (fixtures/scrum47.py builds
// each row's records under its own name). The rows' dates are fixed, so every test
// pins the application clock to the rows' application date, 26-10-2026.
const script = fileURLToPath(new URL('../fixtures/scrum47.py', import.meta.url))
const fixture = (n, flag) =>
  JSON.parse(execFileSync('python', [script, String(n), ...(flag ? [flag] : [])], { encoding: 'utf8' }) || 'null')
const snapshot = (n) => fixture(n, '--snapshot')

const NEEDS_CHANGE_REQUEST =
  'A significant change to an event in Safety Check or Confirmed needs an accepted change request.'
const RELEASE_HOLD_FIRST = "Release the held venue before changing the event's date or times."
const NOT_EDITABLE = 'Only a Submitted, Approved, Planning, Safety Check or Confirmed event can be edited.'
const GENERIC = ['Event request not found.', 'You do not have permission to perform this action.']
const CHANGED = 'by coord1 at 26 Oct 2026, 02:00 UTC'

let currentCase
let contexts = []
let apis = []

const el = (page, suffix) => page.getByTestId(`request-detail-event-edit-${suffix}`)
const shown = (page, field) => page.getByTestId(`request-detail-${field}`)
const entries = (page) => page.getByTestId('request-detail-change-record-entry')

async function login(page, user = 'coord1') {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(user)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(user)
}

// The row's records by their label ('Event', 'Safety Check Event', ...) and a snapshot of them.
async function setup(n, page, { user = 'coord1', at = '2026-10-26T10:00' } = {}) {
  clearClock()
  currentCase = n
  const data = fixture(n)
  pinClock(at)
  await login(page, user)
  const prefix = `SCRUM-47 TC${String(n).padStart(2, '0')} `
  const events = Object.fromEntries(data.events.map((e) => [e.name.slice(prefix.length), e]))
  return { events, before: snapshot(n) }
}

async function open(page, event) {
  await page.goto(`/requests/${event.id}`)
  await expect(shown(page, 'status')).toBeVisible()
}

async function openForm(page) {
  await el(page, 'button').click()
  await expect(el(page, 'form')).toBeVisible()
  await expect(el(page, 'name-input')).toBeFocused()
}

async function save(page) {
  await el(page, 'confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Event updated')
  await expect(el(page, 'form')).toBeHidden()
}

async function refused(page, message) {
  await el(page, 'confirm-button').click()
  await expect(el(page, 'error')).toHaveText(message)
  await expect(el(page, 'form')).toBeVisible()
  await el(page, 'cancel-button').click()
}

async function fields(page, expected) {
  await expect(entries(page)).toHaveCount(expected.length)
  for (const [index, field] of expected.entries()) {
    await expect(entries(page).nth(index)).toHaveAttribute('data-field', field)
  }
}

// A signed-in API client for the direct authenticated attempts the rows name.
async function api(user) {
  const client = await request.newContext({ baseURL: 'http://localhost:5173' })
  apis.push(client)
  expect((await client.post('/api/login', { data: { username: user, password: 'Passw0rd!' } })).status()).toBe(200)
  return client
}

async function session(browser, user) {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  await login(page, user)
  return page
}

async function refusedGenerically(client, event, data) {
  const reply = await client.patch(`/api/requests/${event.id}`, { data })
  expect([403, 404]).toContain(reply.status())
  const body = await reply.json()
  expect(GENERIC).toContain(body.message)
  expect(JSON.stringify(body)).not.toContain(event.name)
}

test.afterEach(async () => {
  try {
    for (const context of contexts) await context.close()
    for (const client of apis) await client.dispose()
  } finally {
    contexts = []
    apis = []
    clearClock()
    if (currentCase) fixture(currentCase, '--clear')
    currentCase = undefined
  }
})

// @tc: TC-SCRUM-47-01
// @test: an ordinary change to a Planning event is saved without a change record
// @story: SCRUM-47
// @ac: 1, 2, 3
test('an ordinary change to a Planning event is saved without a change record', async ({ page }) => {
  const { events, before } = await setup(1, page)
  await open(page, events.Event)
  await openForm(page)
  await el(page, 'name-input').fill('SCRUM-47 TC01 Renamed')
  await el(page, 'purpose-input').fill('Updated purpose')
  await el(page, 'description-input').fill('Updated description')
  await el(page, 'registration-needs-input').fill('Updated registration needs')
  await save(page)

  await page.reload()
  await expect(shown(page, 'name')).toHaveText('SCRUM-47 TC01 Renamed')
  await expect(shown(page, 'purpose')).toHaveText('Updated purpose')
  await expect(shown(page, 'description')).toHaveText('Updated description')
  await expect(shown(page, 'registration-needs')).toHaveText('Updated registration needs')
  await expect(shown(page, 'status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-change-record-empty')).toBeVisible()
  const after = snapshot(1)
  expect(after.event_changes).toEqual([])
  expect(after.venue_booking_requests).toEqual(before.venue_booking_requests)
  expect(after.reservations).toEqual(before.reservations)
})

// @tc: TC-SCRUM-47-02
// @test: a save with significant and ordinary changes records one entry per significant change
// @story: SCRUM-47
// @ac: 1, 2, 3, 5
test('a save with significant and ordinary changes records one entry per significant change', async ({ page }) => {
  const { events } = await setup(2, page)
  await open(page, events.Event)
  await openForm(page)
  await el(page, 'name-input').fill('SCRUM-47 TC02 Renamed')
  await el(page, 'purpose-input').fill('Updated purpose')
  await el(page, 'date-input').fill('2026-11-22')
  await el(page, 'start-time-input').fill('13:00')
  await el(page, 'end-time-input').fill('15:00')
  await el(page, 'attendance-input').fill('55')
  await save(page)

  await page.reload()
  await expect(shown(page, 'date')).toHaveText('22 Nov 2026')
  await expect(shown(page, 'start-time')).toHaveText('13:00')
  await expect(shown(page, 'end-time')).toHaveText('15:00')
  await expect(shown(page, 'attendance')).toHaveText('55')
  await expect(shown(page, 'status')).toHaveText('Planning')
  await fields(page, ['date', 'start_time', 'end_time', 'attendance'])
  await expect(entries(page).nth(0)).toHaveText(`Date: 15 Nov 2026 → 22 Nov 2026, ${CHANGED}`)
  await expect(entries(page).nth(1)).toHaveText(`Start time: 10:00 → 13:00, ${CHANGED}`)
  await expect(entries(page).nth(2)).toHaveText(`End time: 12:00 → 15:00, ${CHANGED}`)
  await expect(entries(page).nth(3)).toHaveText(`Expected attendance: 40 → 55, ${CHANGED}`)
})

// @tc: TC-SCRUM-47-03
// @test: changes to layout, facilities, accessibility features and equipment requirements are recorded and the reservation is untouched
// @story: SCRUM-47
// @ac: 1, 2, 3, 5, 6
test('changes to layout, facilities, accessibility features and equipment requirements are recorded and the reservation is untouched', async ({ page }) => {
  const { events, before } = await setup(3, page)
  await open(page, events.Event)
  await openForm(page)
  await el(page, 'layout-input').selectOption('Classroom')
  await el(page, 'facilities-wi-fi-input').check()
  await el(page, 'accessibility-features-hearing-loop-input').check()
  await el(page, 'equipment-requirements-input').fill('4 projectors')
  await save(page)

  await page.reload()
  await expect(shown(page, 'layout')).toHaveText('Classroom')
  await expect(shown(page, 'facilities')).toHaveText('Projector, Wi-Fi')
  await expect(shown(page, 'accessibility-features')).toHaveText('Step-free access, Hearing loop')
  await expect(shown(page, 'equipment-requirements')).toHaveText('4 projectors')
  await expect(shown(page, 'status')).toHaveText('Planning')
  await fields(page, ['equipment_requirements', 'layout', 'facilities', 'accessibility_features'])
  await expect(entries(page).nth(0)).toHaveText(`Equipment requirements: 2 projectors → 4 projectors, ${CHANGED}`)
  await expect(entries(page).nth(1)).toHaveText(`Room layout: Theatre → Classroom, ${CHANGED}`)
  await expect(entries(page).nth(2)).toHaveText(`Facilities: Projector → Projector, Wi-Fi, ${CHANGED}`)
  await expect(entries(page).nth(3)).toHaveText(
    `Accessibility features: Step-free access → Step-free access, Hearing loop, ${CHANGED}`)
  const after = snapshot(3)
  expect(after.reservations).toEqual(before.reservations)
  expect(after.reservations[0]).toMatchObject({ quantity: 2, date: '2026-11-15', status: 'Reserved' })
  expect(after.equipment_types[0].total_units).toBe(10)
})

// @tc: TC-SCRUM-47-04
// @test: ordinary and significant changes are allowed on Submitted and Approved events without changing their status
// @story: SCRUM-47
// @ac: 1, 2, 3, 6
test('ordinary and significant changes are allowed on Submitted and Approved events without changing their status', async ({ page }) => {
  const { events } = await setup(4, page)
  for (const [label, status] of [['Submitted Event', 'Submitted'], ['Approved Event', 'Approved']]) {
    await open(page, events[label])
    await openForm(page)
    await el(page, 'name-input').fill('SCRUM-47 TC04 Renamed')
    await el(page, 'attendance-input').fill('45')
    await save(page)
    await expect(shown(page, 'status')).toHaveText(status)
    await fields(page, ['attendance'])
    await expect(entries(page).first()).toHaveText(`Expected attendance: 30 → 45, ${CHANGED}`)
  }
})

// @tc: TC-SCRUM-47-05
// @test: an ordinary change is allowed on events in Safety Check and Confirmed
// @story: SCRUM-47
// @ac: 1, 2, 3, 6
test('an ordinary change is allowed on events in Safety Check and Confirmed', async ({ page }) => {
  const { events, before } = await setup(5, page)
  await open(page, events['Safety Check Event'])
  await openForm(page)
  await el(page, 'description-input').fill('Updated description')
  await save(page)
  await expect(shown(page, 'description')).toHaveText('Updated description')
  await expect(shown(page, 'status')).toHaveText('Safety Check')

  await open(page, events['Confirmed Event'])
  await openForm(page)
  await el(page, 'name-input').fill('SCRUM-47 TC05 Renamed')
  await save(page)
  await expect(shown(page, 'name')).toHaveText('SCRUM-47 TC05 Renamed')
  await expect(shown(page, 'status')).toHaveText('Confirmed')
  await expect(page.getByTestId('request-detail-change-record-empty')).toBeVisible()

  const after = snapshot(5)
  expect(after.event_changes).toEqual([])
  expect(after.venue_booking_requests).toEqual(before.venue_booking_requests)
  expect(after.reservations).toEqual(before.reservations)
})

// @tc: TC-SCRUM-47-06
// @test: a significant change to a Safety Check or Confirmed event is refused
// @story: SCRUM-47
// @ac: 1, 2, 3, 6
test('a significant change to a Safety Check or Confirmed event is refused', async ({ page }) => {
  const { events, before } = await setup(6, page)
  await open(page, events['Safety Check Event'])
  await openForm(page)
  await el(page, 'date-input').fill('2026-11-22')
  await refused(page, NEEDS_CHANGE_REQUEST)

  await open(page, events['Confirmed Event'])
  await openForm(page)
  await el(page, 'attendance-input').fill('55')
  await refused(page, NEEDS_CHANGE_REQUEST)

  await page.reload()
  await expect(shown(page, 'attendance')).toHaveText('40')
  await expect(shown(page, 'status')).toHaveText('Confirmed')
  expect(snapshot(6)).toEqual(before)
})

// Waits for SCRUM-59 and SCRUM-60: no change request can be raised or accepted yet.
// @tc: TC-SCRUM-47-07
// @test: after the change request on a Confirmed event is accepted the coordinator makes the significant change
// @story: SCRUM-47
// @ac: 1, 2, 3, 5, 6
test.fixme('after the change request on a Confirmed event is accepted the coordinator makes the significant change', async () => {})

// @tc: TC-SCRUM-47-08
// @test: invalid values for required fields, date, times and attendance are each refused
// @story: SCRUM-47
// @ac: 1
test('invalid values for required fields, date, times and attendance are each refused', async ({ page }) => {
  const { events, before } = await setup(8, page)
  await open(page, events.Event)
  const attempts = [
    ['name-input', '', 'Missing required fields: name'],
    ['purpose-input', '   ', 'Missing required fields: purpose'],
    ['description-input', '', 'Missing required fields: description'],
    ['date-input', '2026-10-25', 'Date cannot be earlier than today.'],
    ['start-time-input', '12:00', 'Start time must be before the end time.'],
    ['start-time-input', '13:00', 'Start time must be before the end time.'],
    ['attendance-input', '0', 'Attendance must be a positive whole number.'],
    ['attendance-input', '-5', 'Attendance must be a positive whole number.'],
    ['attendance-input', '20.5', 'Attendance must be a positive whole number.'],
  ]
  for (const [input, value, message] of attempts) {
    await openForm(page)
    await el(page, input).fill(value)
    await refused(page, message)
  }
  // A number field cannot hold 'abc', so that value is sent directly.
  const reply = await page.request.patch(`/api/requests/${events.Event.id}`, { data: { attendance: 'abc' } })
  expect(reply.status()).toBe(400)
  expect((await reply.json()).message).toBe('Attendance must be a positive whole number.')

  await page.reload()
  await expect(shown(page, 'name')).toHaveText('SCRUM-47 TC08 Event')
  await expect(page.getByTestId('request-detail-change-record-empty')).toBeVisible()
  expect(snapshot(8)).toEqual(before)
})

// @tc: TC-SCRUM-47-09
// @test: a refused edit that also contains valid changes saves none of them
// @story: SCRUM-47
// @ac: 1, 5
test('a refused edit that also contains valid changes saves none of them', async ({ page }) => {
  const { events, before } = await setup(9, page)
  await open(page, events.Event)
  await openForm(page)
  await el(page, 'name-input').fill('SCRUM-47 TC09 Renamed')
  await el(page, 'attendance-input').fill('60')
  await el(page, 'date-input').fill('2026-10-25')
  await refused(page, 'Date cannot be earlier than today.')

  await page.reload()
  await expect(shown(page, 'name')).toHaveText('SCRUM-47 TC09 Event')
  await expect(shown(page, 'attendance')).toHaveText('40')
  await expect(shown(page, 'date')).toHaveText('15 Nov 2026')
  expect(snapshot(9)).toEqual(before)
})

// @tc: TC-SCRUM-47-10
// @test: while the event has a held venue its date and times cannot be changed
// @story: SCRUM-47
// @ac: 4
test('while the event has a held venue its date and times cannot be changed', async ({ page }) => {
  const { events, before } = await setup(10, page)
  await open(page, events.Event)
  for (const [input, value] of [['date-input', '2026-11-22'], ['start-time-input', '09:00'], ['end-time-input', '14:00']]) {
    await openForm(page)
    await el(page, input).fill(value)
    await refused(page, RELEASE_HOLD_FIRST)
  }
  await page.reload()
  await expect(shown(page, 'date')).toHaveText('15 Nov 2026')
  await expect(page.getByTestId(`request-detail-hold-status-${before.venue_holds[0].id}`)).toHaveText('Held')
  expect(snapshot(10)).toEqual(before)
})

// @tc: TC-SCRUM-47-11
// @test: with a held venue other changes still work and the date can be changed once the hold is released
// @story: SCRUM-47
// @ac: 1, 2, 4, 5
test('with a held venue other changes still work and the date can be changed once the hold is released', async ({ page }) => {
  const { events, before } = await setup(11, page)
  const hold = before.venue_holds[0]
  await open(page, events.Event)
  await openForm(page)
  await el(page, 'name-input').fill('SCRUM-47 TC11 Renamed')
  await el(page, 'attendance-input').fill('50')
  await save(page)
  await fields(page, ['attendance'])
  await expect(page.getByTestId(`request-detail-hold-status-${hold.id}`)).toHaveText('Held')

  await page.getByTestId(`request-detail-hold-release-button-${hold.id}`).click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold released')
  await openForm(page)
  await el(page, 'date-input').fill('2026-11-22')
  await save(page)

  await page.reload()
  await expect(shown(page, 'name')).toHaveText('SCRUM-47 TC11 Renamed')
  await expect(shown(page, 'date')).toHaveText('22 Nov 2026')
  await fields(page, ['attendance', 'date'])
  await expect(page.getByTestId(`request-detail-hold-status-${hold.id}`)).toHaveText('Released')
})

// @tc: TC-SCRUM-47-12
// @test: released and expired holds and an approved booking do not block a date change
// @story: SCRUM-47
// @ac: 4
test('released and expired holds and an approved booking do not block a date change', async ({ page }) => {
  const { events, before } = await setup(12, page)
  for (const label of ['Released Hold Event', 'Expired Hold Event', 'Booking Event']) {
    await open(page, events[label])
    await openForm(page)
    await el(page, 'date-input').fill('2026-11-22')
    await save(page)
    await expect(shown(page, 'status')).toHaveText('Planning')
    await fields(page, ['date'])
  }
  const after = snapshot(12)
  expect(after.venue_holds).toEqual(before.venue_holds)
  expect(after.venue_booking_requests).toEqual(before.venue_booking_requests)
})

// @tc: TC-SCRUM-47-13
// @test: significant changes never move cancel or release the event's arrangements or change its status
// @story: SCRUM-47
// @ac: 6
test("significant changes never move cancel or release the event's arrangements or change its status", async ({ page }) => {
  const { events, before } = await setup(13, page)
  const held = before.venue_holds.find((row) => row.status === 'Held')
  await open(page, events.Event)
  await page.getByTestId(`request-detail-hold-release-button-${held.id}`).click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Hold released')
  await openForm(page)
  await el(page, 'date-input').fill('2026-11-22')
  await el(page, 'start-time-input').fill('13:00')
  await el(page, 'end-time-input').fill('15:00')
  await el(page, 'attendance-input').fill('70')
  await save(page)

  await page.reload()
  await expect(shown(page, 'date')).toHaveText('22 Nov 2026')
  await expect(shown(page, 'status')).toHaveText('Planning')
  for (const booking of before.venue_booking_requests.filter((b) => b.event_request_id === events.Event.id)) {
    await expect(page.getByTestId(`request-detail-booking-status-${booking.id}`)).toHaveText(booking.status)
  }
  const after = snapshot(13)
  expect(after.venue_booking_requests).toEqual(before.venue_booking_requests)
  expect(after.reservations).toEqual(before.reservations)
  expect(after.equipment_types).toEqual(before.equipment_types)
  for (const row of after.venue_booking_requests.filter((b) => b.event_request_id === events.Event.id)) {
    expect(row).toMatchObject({ date: '2026-11-15', start_time: '10:00', end_time: '12:00', attendance: 40 })
  }
  // The hold is Released only because coord1 released it; nothing else on it changed.
  const strip = ({ status, released_at, ...rest }) => rest
  expect(after.venue_holds.map(strip)).toEqual(before.venue_holds.map(strip))
  expect(after.venue_holds.find((row) => row.id === held.id).status).toBe('Released')
  const other = (s) => s.events.find((e) => e.id === events['Other Event'].id)
  expect(other(after)).toEqual(other(before))
  const { date, start_time, end_time, attendance, ...rest } = after.events.find((e) => e.id === events.Event.id)
  const { date: _d, start_time: _s, end_time: _e, attendance: _a, ...was } = before.events.find((e) => e.id === events.Event.id)
  expect(rest).toEqual(was)
  expect({ date, start_time, end_time, attendance }).toEqual(
    { date: '2026-11-22', start_time: '13:00', end_time: '15:00', attendance: 70 })
})

// @tc: TC-SCRUM-47-14
// @test: a coordinator lead or two-role account not assigned to the event cannot edit it
// @story: SCRUM-47
// @ac: 7
test('a coordinator lead or two-role account not assigned to the event cannot edit it', async ({ page, browser }) => {
  const { events, before } = await setup(14, page)
  const data = { name: 'SCRUM-47 TC14 Hijacked', attendance: 55 }
  await refusedGenerically(await api('coord2'), events.Event, data)
  const lead = await session(browser, 'lead1')
  await open(lead, events.Event)
  await expect(lead.getByTestId('request-detail-event-edit-button')).toHaveCount(0)
  await refusedGenerically(await api('lead1'), events.Event, data)
  await refusedGenerically(await api('leadcoord1'), events.Event, data)

  await open(page, events.Event)
  await expect(shown(page, 'name')).toHaveText('SCRUM-47 TC14 Event')
  await expect(shown(page, 'status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-change-record-empty')).toBeVisible()
  expect(snapshot(14)).toEqual(before)
})

// @tc: TC-SCRUM-47-15
// @test: the organiser cannot edit the event after submitting it
// @story: SCRUM-47
// @ac: 7
test('the organiser cannot edit the event after submitting it', async ({ page }) => {
  const { events, before } = await setup(15, page, { user: 'org1' })
  const client = await api('org1')
  for (const label of ['Submitted Event', 'Planning Event']) {
    await open(page, events[label])
    await expect(el(page, 'button')).toHaveCount(0)
    await expect(page.getByTestId('request-detail-change-record')).toHaveCount(0)
    await refusedGenerically(client, events[label], { name: 'SCRUM-47 TC15 Organiser Edit', attendance: 55 })
  }
  expect(snapshot(15)).toEqual(before)
})

// @tc: TC-SCRUM-47-16
// @test: completed cancelled rejected and draft events cannot be edited by the coordinator
// @story: SCRUM-47
// @ac: 7
test('completed cancelled rejected and draft events cannot be edited by the coordinator', async ({ page }) => {
  const { events, before } = await setup(16, page)
  const data = { name: 'SCRUM-47 TC16 Edit attempt', attendance: 55 }
  for (const label of ['Completed Event', 'Cancelled Event', 'Rejected Event']) {
    await open(page, events[label])
    await expect(el(page, 'button')).toHaveCount(0)
    const reply = await page.request.patch(`/api/requests/${events[label].id}`, { data })
    expect(reply.status()).toBe(409)
    expect((await reply.json()).message).toBe(NOT_EDITABLE)
  }
  await refusedGenerically(page.request, events['Draft Event'], data)
  expect(snapshot(16)).toEqual(before)
})

// @tc: TC-SCRUM-47-17
// @test: the lowest accepted values are saved
// @story: SCRUM-47
// @ac: 1, 5
test('the lowest accepted values are saved', async ({ page }) => {
  const { events } = await setup(17, page, { at: '2026-10-26T09:00' })
  await open(page, events.Event)
  await openForm(page)
  await el(page, 'date-input').fill('2026-10-26')
  await el(page, 'start-time-input').fill('11:59')
  await el(page, 'attendance-input').fill('1')
  await save(page)

  await page.reload()
  await expect(shown(page, 'date')).toHaveText('26 Oct 2026')
  await expect(shown(page, 'start-time')).toHaveText('11:59')
  await expect(shown(page, 'end-time')).toHaveText('12:00')
  await expect(shown(page, 'attendance')).toHaveText('1')
  await expect(shown(page, 'status')).toHaveText('Planning')
  await fields(page, ['date', 'start_time', 'attendance'])
  await expect(entries(page).nth(0)).toHaveText(
    'Date: 15 Nov 2026 → 26 Oct 2026, by coord1 at 26 Oct 2026, 01:00 UTC')
})
