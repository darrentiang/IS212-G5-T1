import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-56 View My Registration Status. TC-SCRUM-56-01 through 05 (test-case
// sheet), one test per row in the row's order.
//
// The events, bookings and registrations every row opens are staged by
// fixtures/scrum56.py, named "SCRUM-56 ...", together with att56a and att56b,
// the Attendee accounts rows 04 and 05 need. Every row pins the app's clock to
// 1 Dec 2026, 09:00.

const fixtureScript = fileURLToPath(new URL('../fixtures/scrum56.py', import.meta.url))
const NOW = '2026-12-01T09:00'

test.beforeAll(() => execFileSync('python', [fixtureScript], { encoding: 'utf8' }))
test.afterAll(() => execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' }))
test.beforeEach(() => {
  clearClock()
  pinClock(NOW)
})
test.afterEach(() => clearClock())

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function openMyRegistrations(page) {
  await page.getByTestId('layout-nav-registrations').click()
  await expect(page.getByTestId('registrations-title')).toHaveText('My registrations')
}

// The row of a staged event on the page; its test id carries the registration's id.
const rowOf = (page, eventName) => page.getByTestId(/^registrations-row-/).filter({ hasText: eventName })
const cell = (row, field) => row.getByTestId(new RegExp(`^registrations-${field}-\\d+$`))

// @tc: TC-SCRUM-56-01
// @test: an Attendee sees a Confirmed event's date and time, statuses and venue
// @story: SCRUM-56
// @ac: 1, 2
test("an Attendee sees a Confirmed event's date and time, statuses and venue", async ({ page }) => {
  await login(page, 'att1')
  await openMyRegistrations(page)

  const row = rowOf(page, 'SCRUM-56 Venue Gala')
  await expect(cell(row, 'period')).toHaveText('10 Dec 2026, 19:00–21:00')
  await expect(cell(row, 'event-status')).toHaveText('Confirmed')
  await expect(cell(row, 'status')).toHaveText('Registered')
  await expect(cell(row, 'venue')).toHaveText('Auditorium')
})

// @tc: TC-SCRUM-56-02
// @test: an event back in Planning shows its current date and time and that the venue is not yet confirmed
// @story: SCRUM-56
// @ac: 2
test('an event back in Planning shows its current date and time and that the venue is not yet confirmed', async ({
  page,
}) => {
  await login(page, 'att1')
  await openMyRegistrations(page)

  const row = rowOf(page, 'SCRUM-56 Moved Fair')
  await expect(cell(row, 'period')).toHaveText('14 Dec 2026, 10:00–12:00')
  await expect(cell(row, 'event-status')).toHaveText('Planning')
  await expect(cell(row, 'venue')).toHaveText('Venue not yet confirmed')
  await expect(row).not.toContainText('13 Dec')
  await expect(row).not.toContainText('Seminar Room 1')
})

// @tc: TC-SCRUM-56-03
// @test: Completed and Cancelled events show their status, the registration status and their venue rule
// @story: SCRUM-56
// @ac: 1, 3
test('Completed and Cancelled events show their status, the registration status and their venue rule', async ({
  page,
}) => {
  await login(page, 'att1')
  await openMyRegistrations(page)

  const done = rowOf(page, 'SCRUM-56 Done Show')
  await expect(cell(done, 'event-status')).toHaveText('Completed')
  await expect(cell(done, 'status')).toHaveText('Withdrawn')
  await expect(cell(done, 'venue')).toHaveText('Seminar Room 1')
  const off = rowOf(page, 'SCRUM-56 Off Night')
  await expect(cell(off, 'event-status')).toHaveText('Cancelled')
  await expect(cell(off, 'status')).toHaveText('Registered')
  await expect(cell(off, 'venue')).toHaveText('—')
  await expect(done).not.toContainText('Venue not yet confirmed')
  await expect(off).not.toContainText('Venue not yet confirmed')
})

// @tc: TC-SCRUM-56-04
// @test: an Attendee sees only their own registrations
// @story: SCRUM-56
// @ac: 4
test('an Attendee sees only their own registrations', async ({ page }) => {
  await login(page, 'att56a')
  await openMyRegistrations(page)

  const rows = page.getByTestId(/^registrations-row-/)
  await expect(rows).toHaveCount(1)
  const row = rowOf(page, 'SCRUM-56 Venue Gala')
  await expect(cell(row, 'status')).toHaveText('Registered')
  await expect(cell(row, 'venue')).toHaveText('Auditorium')
  for (const other of ['Moved Fair', 'Done Show', 'Off Night']) {
    await expect(rowOf(page, `SCRUM-56 ${other}`)).toHaveCount(0)
  }
})

// @tc: TC-SCRUM-56-05
// @test: an Attendee with no registrations sees that they have none
// @story: SCRUM-56
// @ac: 4
test('an Attendee with no registrations sees that they have none', async ({ page }) => {
  await login(page, 'att56b')
  await openMyRegistrations(page)

  await expect(page.getByTestId('registrations-empty')).toHaveText('You have no registrations.')
  await expect(page.getByRole('table')).toHaveCount(0)
  await expect(page.getByTestId(/^registrations-row-/)).toHaveCount(0)
})
