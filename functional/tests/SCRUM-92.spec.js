import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-92 Set Registration for an Event. TC-SCRUM-92-01 through 11 (test-case
// sheet), one test per row in the row's order.
//
// fixtures/scrum92.py stages each row's event under its own name, "SCRUM-92
// TCnn <event>", assigned to coord1, with the registrations rows 04, 08 and 09
// name inserted directly (att1, att92a, att92b, att92c), as scrum55.py does.
// Every row pins the app's clock to 01 Dec 2026, 09:00.

const fixtureScript = fileURLToPath(new URL('../fixtures/scrum92.py', import.meta.url))
let ids

test.beforeAll(() => {
  ids = JSON.parse(execFileSync('python', [fixtureScript], { encoding: 'utf8' }))
})
test.afterAll(() => execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' }))
test.beforeEach(() => {
  clearClock()
  pinClock('2026-12-01T09:00')
})
test.afterEach(() => clearClock())

const el = (page, suffix) => page.getByTestId(`request-detail-registration-${suffix}`)
const banner = (page) => page.getByTestId('request-detail-banner')

async function open(page, name) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill('coord1')
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText('coord1')
  await page.goto(`/requests/${ids[name]}`)
  await expect(page.getByTestId('request-detail-name')).toHaveText(name)
}

async function edit(page) {
  await el(page, 'edit-button').click()
  await expect(el(page, 'form')).toBeVisible()
}

async function shows(page, { enabled, capacity, closes }) {
  await expect(el(page, 'enabled')).toHaveText(enabled)
  if (capacity !== undefined) await expect(el(page, 'capacity')).toHaveText(capacity)
  if (closes !== undefined) await expect(el(page, 'closes')).toHaveText(closes)
}

// @tc: TC-SCRUM-92-01
// @test: turning registration on with blanks uses the expected attendance and the start
// @story: SCRUM-92
// @ac: 1, 2, 3
test('turning registration on with blanks uses the expected attendance and the start', async ({ page }) => {
  await open(page, 'SCRUM-92 TC01 Reg Gala')
  await edit(page)
  await el(page, 'enabled-input').selectOption('on')
  await expect(el(page, 'capacity-input')).toHaveValue('')
  await expect(el(page, 'closing-date-input')).toHaveValue('')
  await expect(el(page, 'closing-time-input')).toHaveValue('')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Registration updated')
  await shows(page, { enabled: 'On', capacity: '120', closes: '05 Dec 2026, 18:00' })
})

// @tc: TC-SCRUM-92-02
// @test: a chosen capacity and closing time are saved and persist
// @story: SCRUM-92
// @ac: 1
test('a chosen capacity and closing time are saved and persist', async ({ page }) => {
  await open(page, 'SCRUM-92 TC02 Reg Gala')
  await edit(page)
  await el(page, 'enabled-input').selectOption('on')
  await el(page, 'capacity-input').fill('80')
  await el(page, 'closing-date-input').fill('2026-12-04')
  await el(page, 'closing-time-input').fill('23:59')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Registration updated')
  const saved = { enabled: 'On', capacity: '80', closes: '04 Dec 2026, 23:59' }
  await shows(page, saved)
  await page.reload()
  await shows(page, saved)
})

// @tc: TC-SCRUM-92-03
// @test: a capacity of 0 is refused
// @story: SCRUM-92
// @ac: 2
test('a capacity of 0 is refused', async ({ page }) => {
  await open(page, 'SCRUM-92 TC03 Reg Gala')
  await edit(page)
  await el(page, 'enabled-input').selectOption('on')
  await el(page, 'capacity-input').fill('0')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Capacity must be a whole number of at least 1.')
  await page.reload()
  await shows(page, { enabled: 'Off' })
})

// @tc: TC-SCRUM-92-04
// @test: capacity cannot be set below the people registered and withdrawn ones do not count
// @story: SCRUM-92
// @ac: 2
test('capacity cannot be set below the people registered and withdrawn ones do not count', async ({ page }) => {
  await open(page, 'SCRUM-92 TC04 Reg Fair')
  await edit(page)
  await el(page, 'capacity-input').fill('2')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Capacity cannot be less than the 3 people registered.')
  await shows(page, { enabled: 'On', capacity: '50' })
  await el(page, 'capacity-input').fill('3')
  await el(page, 'save-button').click()
  await expect(banner(page)).toHaveText('Registration updated')
  await page.reload()
  await shows(page, { enabled: 'On', capacity: '3' })
})

// @tc: TC-SCRUM-92-05
// @test: closing one minute after the start is refused and closing at the start is saved
// @story: SCRUM-92
// @ac: 3
test('closing one minute after the start is refused and closing at the start is saved', async ({ page }) => {
  await open(page, 'SCRUM-92 TC05 Reg Gala')
  await edit(page)
  await el(page, 'enabled-input').selectOption('on')
  await el(page, 'capacity-input').fill('120')
  await el(page, 'closing-date-input').fill('2026-12-05')
  await el(page, 'closing-time-input').fill('18:01')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Registration cannot close after the event starts.')
  await shows(page, { enabled: 'Off', capacity: 'None', closes: 'None' })
  await el(page, 'closing-time-input').fill('18:00')
  await el(page, 'save-button').click()
  await expect(banner(page)).toHaveText('Registration updated')
  await page.reload()
  await shows(page, { enabled: 'On', closes: '05 Dec 2026, 18:00' })
})

// @tc: TC-SCRUM-92-06
// @test: a closing date with no time is refused
// @story: SCRUM-92
// @ac: 3
test('a closing date with no time is refused', async ({ page }) => {
  await open(page, 'SCRUM-92 TC06 Reg Gala')
  await edit(page)
  await el(page, 'enabled-input').selectOption('on')
  await el(page, 'capacity-input').fill('100')
  await el(page, 'closing-date-input').fill('2026-12-04')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('The closing time needs both a date and a time.')
  await page.reload()
  await shows(page, { enabled: 'Off' })
})

// @tc: TC-SCRUM-92-07
// @test: moving the event's start before the closing time moves the closing time to the new start
// @story: SCRUM-92
// @ac: 3
test("moving the event's start before the closing time moves the closing time to the new start", async ({ page }) => {
  await open(page, 'SCRUM-92 TC07 Reg Gala')
  await page.getByTestId('request-detail-event-edit-button').click()
  await expect(page.getByTestId('request-detail-event-edit-form')).toBeVisible()
  await page.getByTestId('request-detail-event-edit-date-input').fill('2026-12-04')
  await expect(page.getByTestId('request-detail-event-edit-start-time-input')).toHaveValue('18:00')
  await expect(page.getByTestId('request-detail-event-edit-end-time-input')).toHaveValue('21:00')

  await page.getByTestId('request-detail-event-edit-confirm-button').click()

  await expect(banner(page)).toHaveText('Event updated')
  await shows(page, { enabled: 'On', capacity: '120', closes: '04 Dec 2026, 18:00' })
  const entries = page.getByTestId('request-detail-change-record-entry')
  await expect(entries).toHaveCount(1)
  await expect(entries.first()).toHaveAttribute('data-field', 'date')
})

// @tc: TC-SCRUM-92-08
// @test: registration cannot be turned off while people are registered
// @story: SCRUM-92
// @ac: 4
test('registration cannot be turned off while people are registered', async ({ page }) => {
  await open(page, 'SCRUM-92 TC08 Reg Fair')
  await edit(page)
  await el(page, 'enabled-input').selectOption('off')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Registration cannot be turned off while 3 people are registered.')
  await page.reload()
  await shows(page, { enabled: 'On', capacity: '50', closes: '06 Dec 2026, 10:00' })
})

// @tc: TC-SCRUM-92-09
// @test: registration turns off when the only registration is withdrawn and keeps its values
// @story: SCRUM-92
// @ac: 4
test('registration turns off when the only registration is withdrawn and keeps its values', async ({ page }) => {
  await open(page, 'SCRUM-92 TC09 Quiet Talk')
  await edit(page)
  await el(page, 'enabled-input').selectOption('off')

  await el(page, 'save-button').click()

  await expect(banner(page)).toHaveText('Registration updated')
  await page.reload()
  await shows(page, { enabled: 'Off', capacity: '30', closes: '07 Dec 2026, 14:00' })
})

// @tc: TC-SCRUM-92-10
// @test: registration cannot be set before the event is Approved
// @story: SCRUM-92
// @ac: 1, 5
test('registration cannot be set before the event is Approved', async ({ page }) => {
  await open(page, 'SCRUM-92 TC10 Early Talk')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await shows(page, { enabled: 'Off' })
  await expect(el(page, 'edit-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-92-11
// @test: registration cannot be set on a Cancelled event
// @story: SCRUM-92
// @ac: 5
test('registration cannot be set on a Cancelled event', async ({ page }) => {
  await open(page, 'SCRUM-92 TC11 Off Night')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Cancelled')
  await shows(page, { enabled: 'Off' })
  await expect(el(page, 'edit-button')).toHaveCount(0)
})
