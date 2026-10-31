import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-55 Withdraw My Event Registration. TC-SCRUM-55-01 through 10 (test-case
// sheet), one test per row in the row's order.
//
// The events and registrations each row opens are staged by
// fixtures/scrum55.py, named "SCRUM-55 TCnn ...", together with att2, the second
// Attendee account rows 07 and 09 need. The registrations each row starts with are
// inserted directly. Rows 02 to 04, 07 and 08 pin the app's clock to a minute
// before the events start (and close).
//
// Rows 07 and 08 register through the Registration page, SCRUM-54's Register,
// on events with SCRUM-92's capacity and closing time.

const BASE_URL = 'http://localhost:5173'
const fixtureScript = fileURLToPath(new URL('../fixtures/scrum55.py', import.meta.url))

test.beforeAll(() => execFileSync('python', [fixtureScript], { encoding: 'utf8' }))
test.afterAll(() => execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' }))
test.beforeEach(() => clearClock())
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

async function openRegistration(page) {
  await page.getByTestId('layout-nav-registration').click()
  await expect(page.getByTestId('registration-title')).toHaveText('Registration')
}

// A staged event's row on the Registration page (SCRUM-54); its test id carries the event's id.
const eventRowOf = (page, eventName) => page.getByTestId(/^registration-row-/).filter({ hasText: eventName })

// The row of a staged event on the page; its test id carries the registration's id.
const rowOf = (page, eventName) => page.getByTestId(/^registrations-row-/).filter({ hasText: eventName })

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const logged = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(logged.ok()).toBeTruthy()
  return api
}

// att1's registration for a staged event, read through the API.
async function registrationOf(eventName) {
  const api = await apiAs('att1')
  const rows = await (await api.get('/api/registrations/mine')).json()
  await api.dispose()
  const found = rows.find((row) => row.event_name === eventName)
  expect(found, `staged registration for ${eventName}`).toBeTruthy()
  return found
}

// @tc: TC-SCRUM-55-01
// @test: an Attendee withdraws their own registration before the event starts
// @story: SCRUM-55
// @ac: 1
test('an Attendee withdraws their own registration before the event starts', async ({ page }) => {
  pinClock('2027-12-20T09:00')
  const name = 'SCRUM-55 TC01 Withdraw Gala'
  await login(page, 'att1')
  await openMyRegistrations(page)

  await rowOf(page, name).getByRole('button', { name: 'Withdraw' }).click()

  await expect(page.getByTestId('registrations-banner')).toHaveText(`Withdrawn from ${name}.`)
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
  await expect(rowOf(page, name).getByTestId(/^registrations-event-status-/)).toHaveText('Confirmed')
  await page.reload()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
  await expect(rowOf(page, name).getByTestId(/^registrations-event-status-/)).toHaveText('Confirmed')
})

// @tc: TC-SCRUM-55-02
// @test: a registration can still be withdrawn one minute before the event starts
// @story: SCRUM-55
// @ac: 1
test('a registration can still be withdrawn one minute before the event starts', async ({ page }) => {
  pinClock('2027-12-20T09:59')
  const name = 'SCRUM-55 TC02 Withdraw Gala'
  await login(page, 'att1')
  await openMyRegistrations(page)

  await rowOf(page, name).getByRole('button', { name: 'Withdraw' }).click()

  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
  await page.reload()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
  await expect(rowOf(page, name).getByTestId(/^registrations-event-status-/)).toHaveText('Confirmed')
})

// @tc: TC-SCRUM-55-03
// @test: a registration cannot be withdrawn at the moment the event starts
// @story: SCRUM-55
// @ac: 3
test('a registration cannot be withdrawn at the moment the event starts', async ({ page }) => {
  pinClock('2027-12-20T09:59')
  const name = 'SCRUM-55 TC03 Start Gala'
  await login(page, 'att1')
  await openMyRegistrations(page)
  await expect(rowOf(page, name).getByRole('button', { name: 'Withdraw' })).toBeVisible()
  // The page was opened one minute before the start; the minute passes before the click.
  pinClock('2027-12-20T10:00')

  await rowOf(page, name).getByRole('button', { name: 'Withdraw' }).click()

  await expect(page.getByTestId('registrations-banner')).toHaveText(
    'The event has started, so the registration can no longer be withdrawn.',
  )
  await page.reload()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Registered')
  await expect(rowOf(page, name).getByRole('button', { name: 'Withdraw' })).toHaveCount(0)
})

// @tc: TC-SCRUM-55-04
// @test: a registration cannot be withdrawn one minute after the event starts
// @story: SCRUM-55
// @ac: 3
test('a registration cannot be withdrawn one minute after the event starts', async ({ page }) => {
  pinClock('2027-12-20T09:00')
  const name = 'SCRUM-55 TC04 Started Gala'
  await login(page, 'att1')
  await openMyRegistrations(page)
  await expect(rowOf(page, name).getByRole('button', { name: 'Withdraw' })).toBeVisible()
  pinClock('2027-12-20T10:01')

  await rowOf(page, name).getByRole('button', { name: 'Withdraw' }).click()

  await expect(page.getByTestId('registrations-banner')).toHaveText(
    'The event has started, so the registration can no longer be withdrawn.',
  )
  await page.reload()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Registered')
})

// @tc: TC-SCRUM-55-05
// @test: a registration that is already Withdrawn cannot be withdrawn again
// @story: SCRUM-55
// @ac: 3
test('a registration that is already Withdrawn cannot be withdrawn again', async ({ page, context }) => {
  const name = 'SCRUM-55 TC05 Twice Gala'
  await login(page, 'att1')
  await openMyRegistrations(page)
  const second = await context.newPage()
  await second.goto('/registrations')
  await expect(rowOf(second, name).getByRole('button', { name: 'Withdraw' })).toBeVisible()

  await rowOf(page, name).getByRole('button', { name: 'Withdraw' }).click()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
  await rowOf(second, name).getByRole('button', { name: 'Withdraw' }).click()

  await expect(second.getByTestId('registrations-banner')).toHaveText('This registration is already withdrawn.')
  await second.reload()
  await expect(rowOf(second, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
})

// @tc: TC-SCRUM-55-06
// @test: a registration for a Cancelled event cannot be withdrawn
// @story: SCRUM-55
// @ac: 3
test('a registration for a Cancelled event cannot be withdrawn', async ({ page }) => {
  const name = 'SCRUM-55 TC06 Cancelled Gala'
  await login(page, 'att1')
  await openMyRegistrations(page)

  await expect(rowOf(page, name).getByTestId(/^registrations-event-status-/)).toHaveText('Cancelled')
  await expect(rowOf(page, name).getByRole('button', { name: 'Withdraw' })).toHaveCount(0)
  await page.reload()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Registered')
})

// @tc: TC-SCRUM-55-07
// @test: a withdrawn place goes back to the event, so the next Attendee can take it
// @story: SCRUM-55
// @ac: 2
test('a withdrawn place goes back to the event, so the next Attendee can take it', async ({ page }) => {
  pinClock('2027-12-20T09:00')
  const name = 'SCRUM-55 TC07 Full Gala'
  await login(page, 'att2')
  await openRegistration(page)
  await expect(eventRowOf(page, name).getByTestId(/^registration-action-/)).toHaveText('Full')
  await page.getByTestId('layout-logout-button').click()
  await login(page, 'att1')
  await openMyRegistrations(page)

  await rowOf(page, name).getByRole('button', { name: 'Withdraw' }).click()
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
  await page.getByTestId('layout-logout-button').click()
  await login(page, 'att2')
  await openRegistration(page)
  await eventRowOf(page, name).getByRole('button', { name: 'Register' }).click()

  await expect(page.getByTestId('registration-banner')).toHaveText(
    // No venue is booked for the staged events, so the confirmation names none.
    `Registered for ${name}: 20 Dec 2027, 10:00–12:00.`,
  )
  await expect(eventRowOf(page, name).getByTestId(/^registration-action-/)).toHaveText('Registered')
  await page.getByTestId('layout-logout-button').click()
  await login(page, 'att1')
  await openMyRegistrations(page)
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText('Withdrawn')
})

// @tc: TC-SCRUM-55-08
// @test: registering again after withdrawing makes a new registration, and the Withdrawn one stays
// @story: SCRUM-55
// @ac: 4
test('registering again after withdrawing makes a new registration, and the Withdrawn one stays', async ({ page }) => {
  pinClock('2027-12-20T09:00')
  const name = 'SCRUM-55 TC08 Again Gala'
  await login(page, 'att1')
  await openRegistration(page)

  await eventRowOf(page, name).getByRole('button', { name: 'Register' }).click()
  await expect(eventRowOf(page, name).getByTestId(/^registration-action-/)).toHaveText('Registered')

  await openMyRegistrations(page)
  await expect(rowOf(page, name)).toHaveCount(2)
  await expect(rowOf(page, name).getByTestId(/^registrations-status-/)).toHaveText(['Withdrawn', 'Registered'])
})

// @tc: TC-SCRUM-55-09
// @test: another Attendee cannot withdraw a registration that is not theirs
// @story: SCRUM-55
// @ac: 5
test('another Attendee cannot withdraw a registration that is not theirs', async () => {
  const mine = await registrationOf('SCRUM-55 TC09 Open Gala')
  const other = await apiAs('att2')

  const reply = await other.post(`/api/registrations/${mine.id}/withdraw`)

  expect(reply.status()).toBe(404)
  expect(await reply.json()).toEqual({ message: 'Registration not found.' })
  await other.dispose()
  expect((await registrationOf('SCRUM-55 TC09 Open Gala')).status).toBe('Registered')
})

// @tc: TC-SCRUM-55-10
// @test: an account that is not an Attendee cannot withdraw a registration
// @story: SCRUM-55
// @ac: 5
test('an account that is not an Attendee cannot withdraw a registration', async () => {
  const mine = await registrationOf('SCRUM-55 TC10 Open Gala')
  const coordinator = await apiAs('coord1')

  const reply = await coordinator.post(`/api/registrations/${mine.id}/withdraw`)

  expect(reply.status()).toBe(403)
  expect(await reply.json()).toEqual({ message: 'You do not have permission to perform this action.' })
  await coordinator.dispose()
  expect((await registrationOf('SCRUM-55 TC10 Open Gala')).status).toBe('Registered')
})
