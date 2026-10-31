import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-54 Register for a Confirmed Event. TC-SCRUM-54-01 through 07 (test-case
// sheet), one test per row in the row's order.
//
// The events each row opens are staged by fixtures/scrum54.py, named
// "SCRUM-54 TCnn <row's event>", together with att54a and att54b, the Attendee
// accounts the rows name. Every row pins the app's clock to the minute it names.
// Where a row stages a registration while the page is open (TC-03, TC-04), it is
// made through the API as that Attendee, the same Register the page sends.

const BASE_URL = 'http://localhost:5173'
const fixtureScript = fileURLToPath(new URL('../fixtures/scrum54.py', import.meta.url))
const CONCERT = (n) => `SCRUM-54 TC0${n} Reg Concert`
const TALK = (n) => `SCRUM-54 TC0${n} Close Talk`

let ids

test.beforeAll(() => {
  ids = JSON.parse(execFileSync('python', [fixtureScript], { encoding: 'utf8' }))
})
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

async function openRegistration(page) {
  await page.getByTestId('layout-nav-registration').click()
  await expect(page.getByTestId('registration-title')).toHaveText('Registration')
}

const action = (page, name) => page.getByTestId(`registration-action-${ids[name]}`)
const registerButton = (page, name) => page.getByTestId(`registration-register-button-${ids[name]}`)

// Registers the Attendee through the API, as if from another tab or another person.
async function registerThroughApi(username, name) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const logged = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(logged.ok()).toBeTruthy()
  const reply = await api.post(`/api/registration/events/${ids[name]}/register`)
  expect(reply.status()).toBe(201)
  await api.dispose()
}

// @tc: TC-SCRUM-54-01
// @test: an Attendee sees an event's public details and registers for it
// @story: SCRUM-54
// @ac: 1, 4, 5
test("an Attendee sees an event's public details and registers for it", async ({ page }) => {
  pinClock('2026-12-01T09:00')
  const name = CONCERT(1)
  const id = ids[name]
  await login(page, 'att1')
  await openRegistration(page)

  await expect(page.getByTestId(`registration-event-${id}`)).toHaveText(name)
  await expect(page.getByTestId(`registration-purpose-${id}`)).toHaveText('Evening concert')
  await expect(page.getByTestId(`registration-period-${id}`)).toHaveText('10 Dec 2026, 19:00–21:00')
  await expect(page.getByTestId(`registration-venues-${id}`)).toHaveText('Seminar Room 1')
  await expect(registerButton(page, name)).toHaveText('Register')
  await expect(page.getByText('Internal: VIP list pending')).toHaveCount(0)

  await registerButton(page, name).click()

  await expect(page.getByTestId('registration-banner')).toHaveText(
    `Registered for ${name}: 10 Dec 2026, 19:00–21:00, Seminar Room 1.`,
  )
  await expect(action(page, name)).toHaveText('Registered')
  await expect(registerButton(page, name)).toHaveCount(0)
})

// @tc: TC-SCRUM-54-02
// @test: an Attendee takes the last place, after which the event shows as full
// @story: SCRUM-54
// @ac: 2
test('an Attendee takes the last place, after which the event shows as full', async ({ page }) => {
  pinClock('2026-12-01T09:00')
  const name = CONCERT(2)
  await login(page, 'att1')
  await openRegistration(page)

  await registerButton(page, name).click()

  await expect(page.getByTestId('registration-banner')).toHaveText(
    `Registered for ${name}: 10 Dec 2026, 19:00–21:00, Seminar Room 1.`,
  )
  await expect(action(page, name)).toHaveText('Registered')
  await page.getByTestId('layout-logout-button').click()
  await login(page, 'att54b')
  await openRegistration(page)
  await expect(action(page, name)).toHaveText('Full')
  await expect(registerButton(page, name)).toHaveCount(0)
})

// @tc: TC-SCRUM-54-03
// @test: Register on a page opened while one place was left is refused once it is taken
// @story: SCRUM-54
// @ac: 2, 6
test('Register on a page opened while one place was left is refused once it is taken', async ({ page }) => {
  pinClock('2026-12-01T09:00')
  const name = CONCERT(3)
  await login(page, 'att1')
  await openRegistration(page)
  await expect(registerButton(page, name)).toBeVisible()
  await registerThroughApi('att54b', name)

  await registerButton(page, name).click()

  await expect(page.getByTestId('registration-banner')).toHaveText('This event is full.')
  await expect(action(page, name)).toHaveText('Full')
  await expect(registerButton(page, name)).toHaveCount(0)
})

// @tc: TC-SCRUM-54-04
// @test: an Attendee already registered cannot register again
// @story: SCRUM-54
// @ac: 3, 6
test('an Attendee already registered cannot register again', async ({ page, context }) => {
  pinClock('2026-12-01T09:00')
  const name = CONCERT(4)
  await login(page, 'att1')
  await openRegistration(page)
  await expect(registerButton(page, name)).toBeVisible()
  await registerThroughApi('att1', name)
  const second = await context.newPage()
  await second.goto('/registration')
  await expect(action(second, name)).toHaveText('Registered')
  await expect(registerButton(second, name)).toHaveCount(0)

  await registerButton(page, name).click()

  await expect(page.getByTestId('registration-banner')).toHaveText('You are already registered for this event.')
  await expect(action(page, name)).toHaveText('Registered')
  await page.getByTestId('layout-logout-button').click()
  await login(page, 'att54b')
  await openRegistration(page)
  await expect(registerButton(page, name)).toBeVisible()
  await expect(action(page, name)).not.toHaveText('Full')
})

// @tc: TC-SCRUM-54-05
// @test: an Attendee registers one minute before the closing time
// @story: SCRUM-54
// @ac: 1
test('an Attendee registers one minute before the closing time', async ({ page }) => {
  pinClock('2026-12-01T09:59')
  const name = TALK(5)
  await login(page, 'att1')
  await openRegistration(page)

  await registerButton(page, name).click()

  await expect(page.getByTestId('registration-banner')).toHaveText(
    `Registered for ${name}: 05 Dec 2026, 14:00–15:00, Auditorium.`,
  )
  await expect(action(page, name)).toHaveText('Registered')
})

// @tc: TC-SCRUM-54-06
// @test: at the closing time the event shows Registration closed
// @story: SCRUM-54
// @ac: 1
test('at the closing time the event shows Registration closed', async ({ page }) => {
  pinClock('2026-12-01T10:00')
  const name = TALK(6)
  await login(page, 'att1')
  await openRegistration(page)

  await expect(action(page, name)).toHaveText('Registration closed')
  await expect(registerButton(page, name)).toHaveCount(0)
})

// @tc: TC-SCRUM-54-07
// @test: Register on a page opened before the closing time is refused once it has passed
// @story: SCRUM-54
// @ac: 1, 6
test('Register on a page opened before the closing time is refused once it has passed', async ({ page }) => {
  pinClock('2026-12-01T09:59')
  const name = TALK(7)
  await login(page, 'att1')
  await openRegistration(page)
  await expect(registerButton(page, name)).toBeVisible()
  // The page was opened one minute before the closing time; the minute passes before the click.
  pinClock('2026-12-01T10:00')

  await registerButton(page, name).click()

  await expect(page.getByTestId('registration-banner')).toHaveText('Registration for this event has closed.')
  await expect(action(page, name)).toHaveText('Registration closed')
  await expect(registerButton(page, name)).toHaveCount(0)
})
