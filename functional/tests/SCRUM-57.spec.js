import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-57 View Registrations for My Event. TC-SCRUM-57-01 through 06
// (test-case sheet), one test per row in the row's order.
//
// fixtures/scrum57.py stages each row's event under its own name, "SCRUM-57
// <event>", created by org1 and assigned to coord1, with the registrations the
// rows name inserted directly (att1, att57a, att57b), as scrum55.py does. Rows
// 01, 02, 05 and 06 only read Count Gala. Every row pins the app's clock to
// 01 Dec 2026, 09:00.

const fixtureScript = fileURLToPath(new URL('../fixtures/scrum57.py', import.meta.url))
const COUNT_GALA = 'SCRUM-57 Count Gala'
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
const attendeeRows = (page) => el(page, 'attendees').locator('tbody tr')

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function openFromRequests(page, username, name) {
  await login(page, username)
  await page.getByTestId('layout-nav-requests').click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByTestId('request-detail-name')).toHaveText(name)
}

async function showsCountGala(page) {
  await expect(el(page, 'registered')).toHaveText('2')
  await expect(el(page, 'capacity')).toHaveText('3')
  await expect(el(page, 'places-remaining')).toHaveText('1')
  await expect(attendeeRows(page)).toHaveCount(2)
  await expect(attendeeRows(page).nth(0)).toHaveAttribute('data-testid', 'request-detail-registration-attendee-att1')
  await expect(attendeeRows(page).nth(1)).toHaveAttribute('data-testid', 'request-detail-registration-attendee-att57a')
  await expect(el(page, 'attendee-att57b')).toHaveCount(0)
}

async function noRegistration(page) {
  await expect(page.getByTestId('request-detail-registration')).toHaveCount(0)
  await expect(el(page, 'registered')).toHaveCount(0)
  await expect(el(page, 'attendees')).toHaveCount(0)
}

// @tc: TC-SCRUM-57-01
// @test: the assigned coordinator sees the counts and the registered attendees
// @story: SCRUM-57
// @ac: 1, 2
test('the assigned coordinator sees the counts and the registered attendees', async ({ page }) => {
  await openFromRequests(page, 'coord1', COUNT_GALA)

  await showsCountGala(page)
  await expect(el(page, 'attendee-registered-at-att1')).toHaveText('20 Nov 2026, 10:00')
  await expect(el(page, 'attendee-registered-at-att57a')).toHaveText('21 Nov 2026, 11:30')
})

// @tc: TC-SCRUM-57-02
// @test: the creating organiser sees the same counts and attendees read-only
// @story: SCRUM-57
// @ac: 1, 2
test('the creating organiser sees the same counts and attendees read-only', async ({ page }) => {
  await openFromRequests(page, 'org1', COUNT_GALA)

  await showsCountGala(page)
  await expect(el(page, 'edit-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-57-03
// @test: places remaining is 0 when the registered count equals the capacity
// @story: SCRUM-57
// @ac: 1
test('places remaining is 0 when the registered count equals the capacity', async ({ page }) => {
  await openFromRequests(page, 'coord1', 'SCRUM-57 Full Gala')

  await expect(el(page, 'registered')).toHaveText('2')
  await expect(el(page, 'capacity')).toHaveText('2')
  await expect(el(page, 'places-remaining')).toHaveText('0')
  await expect(el(page, 'attendee-name-att1')).toHaveText('att1')
  await expect(el(page, 'attendee-name-att57a')).toHaveText('att57a')
})

// @tc: TC-SCRUM-57-04
// @test: registration off says registration is not on with no counts or list
// @story: SCRUM-57
// @ac: 3
test('registration off says registration is not on with no counts or list', async ({ page }) => {
  await openFromRequests(page, 'org1', 'SCRUM-57 Quiet Fair')

  await expect(el(page, 'enabled')).toHaveText('Off')
  await expect(el(page, 'not-on')).toHaveText('Registration is not on for this event.')
  await expect(el(page, 'registered')).toHaveCount(0)
  await expect(el(page, 'places-remaining')).toHaveCount(0)
  await expect(el(page, 'attendees')).toHaveCount(0)
})

// @tc: TC-SCRUM-57-05
// @test: the lead's read-only view shows no registration counts or list
// @story: SCRUM-57
// @ac: 4
test("the lead's read-only view shows no registration counts or list", async ({ page }) => {
  await login(page, 'lead1')
  await page.getByTestId('layout-nav-assignments').click()
  await expect(page.getByTestId('assignments-title')).toBeVisible()

  await page.getByTestId(`assignments-name-${ids[COUNT_GALA]}`).getByRole('link').click()

  await expect(page.getByTestId('request-detail-name')).toHaveText(COUNT_GALA)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  await noRegistration(page)
})

// @tc: TC-SCRUM-57-06
// @test: another organiser cannot see the registrations of an event they did not create
// @story: SCRUM-57
// @ac: 4
test('another organiser cannot see the registrations of an event they did not create', async ({ page }) => {
  await login(page, 'org2')
  await page.goto(`/requests/${ids[COUNT_GALA]}`)

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-banner')).toHaveText(/permission|not found/i)
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-name')).toHaveCount(0)
  await noRegistration(page)
})
