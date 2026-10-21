import { test, expect, request } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// SCRUM-91 Refuse Operating Hours That Close Before They Open.
// TC-SCRUM-91-01 to 12 (test-case sheet), one test per row in the row's order.
//
// Every venue a row uses is its own, named "SCRUM-91 TCnn ...", and is cleared
// after the row through fixtures/scrum91.py, so a retry starts clean and the
// seeded venues are never touched. TC09 to TC12 need a venue already saved
// with hours 01:55 to 01:53, which the forms now refuse, so the fixture stores
// it directly. A refusal is the API's message in the page's banner, with the
// form left open and its entries kept (ui-guidelines.md §7).

const script = fileURLToPath(new URL('../fixtures/scrum91.py', import.meta.url))
const BASE_URL = 'http://localhost:5173'
const CLOSES_BEFORE_OPENING = 'Closing time must be after opening time.'
const ONLY_ONE_TIME = 'Enter both opening and closing time, or leave both blank.'
let currentCase
let contexts = []

const fixture = (n, option) =>
  execFileSync('python', [script, String(n), ...(option ? [option] : [])], { encoding: 'utf8' })

// Clears what an earlier run of the case left; with stored set, also saves its bad-hours venue.
function setup(n, { stored = false } = {}) {
  currentCase = n
  if (!stored) {
    fixture(n, '--clear')
    return null
  }
  return JSON.parse(fixture(n)).venue
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

async function venueWithHours(name, maxCapacity, openingTime, closingTime) {
  const api = await apiAs('venue1')
  const resp = await api.post('/api/venues', {
    data: {
      name,
      location: 'Block B Level 1',
      max_capacity: maxCapacity,
      opening_time: openingTime,
      closing_time: closingTime,
    },
  })
  expect(resp.status()).toBe(201)
  return (await resp.json()).id
}

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function addVenue(page, name, openingTime, closingTime) {
  await page.goto('/venues')
  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-name-input').fill(name)
  await page.getByTestId('venue-new-location-input').fill('Block A Level 3')
  await page.getByTestId('venue-new-max-capacity-input').fill('50')
  await page.getByTestId('venue-new-opening-time-input').fill(openingTime)
  await page.getByTestId('venue-new-closing-time-input').fill(closingTime)
  await page.getByTestId('venue-new-save-button').click()
}

// A refused add: the banner names the rule, the form keeps the times, and Venues has no such venue.
async function expectAddRefused(page, name, message, openingTime, closingTime) {
  const banner = page.getByTestId('venue-new-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(message)
  await expect(page.getByTestId('venue-new-opening-time-input')).toHaveValue(openingTime)
  await expect(page.getByTestId('venue-new-closing-time-input')).toHaveValue(closingTime)

  await page.goto('/venues')
  await expect(page.getByTestId('venues-title')).toBeVisible()
  await expect(page.locator('[data-testid^="venues-row-"]', { hasText: name })).toHaveCount(0)
}

async function openUpdate(page, venue) {
  await page.goto(`/venues/${venue}`)
  await page.getByTestId('venue-detail-update-button').click()
}

async function fillHours(page, openingTime, closingTime) {
  await page.getByTestId('venue-detail-update-opening-time-input').fill(openingTime)
  await page.getByTestId('venue-detail-update-closing-time-input').fill(closingTime)
}

async function expectUpdateRefused(page, message, openingTime, closingTime) {
  const banner = page.getByTestId('venue-detail-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(message)
  await expect(page.getByTestId('venue-detail-update-opening-time-input')).toHaveValue(openingTime)
  await expect(page.getByTestId('venue-detail-update-closing-time-input')).toHaveValue(closingTime)
}

async function expectSaved(page) {
  const banner = page.getByTestId('venue-detail-banner')
  await expect(banner).toHaveAttribute('role', 'status')
  await expect(banner).toHaveText('Venue updated')
}

async function expectHours(page, openingTime, closingTime) {
  await expect(page.getByTestId('venue-detail-opening-time')).toHaveText(openingTime)
  await expect(page.getByTestId('venue-detail-closing-time')).toHaveText(closingTime)
}

// @tc: TC-SCRUM-91-01
// @test: adding a venue that closes one minute before it opens is refused
// @story: SCRUM-91
// @ac: 1
test('adding a venue that closes one minute before it opens is refused', async ({ page }) => {
  setup(1)
  await login(page, 'venue1')

  await addVenue(page, 'SCRUM-91 TC01 Venue', '09:00', '08:59')

  await expectAddRefused(page, 'SCRUM-91 TC01 Venue', CLOSES_BEFORE_OPENING, '09:00', '08:59')
})

// @tc: TC-SCRUM-91-02
// @test: adding a venue that closes at the time it opens is refused
// @story: SCRUM-91
// @ac: 1
test('adding a venue that closes at the time it opens is refused', async ({ page }) => {
  setup(2)
  await login(page, 'venue1')

  await addVenue(page, 'SCRUM-91 TC02 Venue', '09:00', '09:00')

  await expectAddRefused(page, 'SCRUM-91 TC02 Venue', CLOSES_BEFORE_OPENING, '09:00', '09:00')
})

// @tc: TC-SCRUM-91-03
// @test: adding a venue that closes one minute after it opens is accepted
// @story: SCRUM-91
// @ac: 1
test('adding a venue that closes one minute after it opens is accepted', async ({ page }) => {
  setup(3)
  await login(page, 'venue1')

  await addVenue(page, 'SCRUM-91 TC03 Venue', '09:00', '09:01')

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue added')
  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-91 TC03 Venue')
  await expectHours(page, '09:00', '09:01')
})

// @tc: TC-SCRUM-91-04
// @test: updating a venue to close before it opens is refused and none of the update is saved
// @story: SCRUM-91
// @ac: 1
test('updating a venue to close before it opens is refused and none of the update is saved', async ({ page }) => {
  setup(4)
  const venue = await venueWithHours('SCRUM-91 TC04 Venue', 80, '08:00', '20:00')
  await login(page, 'venue1')

  await openUpdate(page, venue)
  await page.getByTestId('venue-detail-update-name-input').fill('SCRUM-91 TC04 Venue Renamed')
  await fillHours(page, '18:00', '09:00')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expectUpdateRefused(page, CLOSES_BEFORE_OPENING, '18:00', '09:00')
  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-91 TC04 Venue')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block B Level 1')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('80')
  await expectHours(page, '08:00', '20:00')
})

// @tc: TC-SCRUM-91-05
// @test: updating a venue to close one minute after it opens is accepted
// @story: SCRUM-91
// @ac: 1
test('updating a venue to close one minute after it opens is accepted', async ({ page }) => {
  setup(5)
  const venue = await venueWithHours('SCRUM-91 TC05 Venue', 60, '08:00', '20:00')
  await login(page, 'venue1')

  await openUpdate(page, venue)
  await fillHours(page, '09:00', '09:01')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expectSaved(page)
  await page.reload()
  await expectHours(page, '09:00', '09:01')
})

// @tc: TC-SCRUM-91-06
// @test: adding a venue with both operating hours blank is accepted
// @story: SCRUM-91
// @ac: 2
test('adding a venue with both operating hours blank is accepted', async ({ page }) => {
  setup(6)
  await login(page, 'venue1')

  await addVenue(page, 'SCRUM-91 TC06 Venue', '', '')

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue added')
  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-91 TC06 Venue')
  await expectHours(page, 'None', 'None')
})

// @tc: TC-SCRUM-91-07
// @test: adding a venue with an opening time but no closing time is refused
// @story: SCRUM-91
// @ac: 2
test('adding a venue with an opening time but no closing time is refused', async ({ page }) => {
  setup(7)
  await login(page, 'venue1')

  await addVenue(page, 'SCRUM-91 TC07 Venue', '08:00', '')

  await expectAddRefused(page, 'SCRUM-91 TC07 Venue', ONLY_ONE_TIME, '08:00', '')
})

// @tc: TC-SCRUM-91-08
// @test: updating a venue to a closing time but no opening time is refused
// @story: SCRUM-91
// @ac: 2
test('updating a venue to a closing time but no opening time is refused', async ({ page }) => {
  setup(8)
  const venue = await venueWithHours('SCRUM-91 TC08 Venue', 60, '08:00', '20:00')
  await login(page, 'venue1')

  await openUpdate(page, venue)
  await fillHours(page, '', '20:00')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expectUpdateRefused(page, ONLY_ONE_TIME, '', '20:00')
  await page.reload()
  await expectHours(page, '08:00', '20:00')
})

// @tc: TC-SCRUM-91-09
// @test: a venue already saved with closing time before opening time can still be viewed
// @story: SCRUM-91
// @ac: 3
test('a venue already saved with closing time before opening time can still be viewed', async ({ page }) => {
  const venue = setup(9, { stored: true })
  await login(page, 'venue1')

  await page.goto('/venues')
  const row = page.getByTestId(`venues-row-${venue}`)
  await expect(row).toContainText('SCRUM-91 TC09 Venue')
  await row.getByRole('link', { name: 'SCRUM-91 TC09 Venue' }).click()

  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-91 TC09 Venue')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block D Level 1')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('40')
  await expectHours(page, '01:55', '01:53')
})

// @tc: TC-SCRUM-91-10
// @test: an update to a venue saved with bad hours is refused while the hours are left as they are
// @story: SCRUM-91
// @ac: 3
test('an update to a venue saved with bad hours is refused while the hours are left as they are', async ({
  page,
}) => {
  const venue = setup(10, { stored: true })
  await login(page, 'venue1')

  await openUpdate(page, venue)
  await expect(page.getByTestId('venue-detail-update-opening-time-input')).toHaveValue('01:55')
  await expect(page.getByTestId('venue-detail-update-closing-time-input')).toHaveValue('01:53')
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('45')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expectUpdateRefused(page, CLOSES_BEFORE_OPENING, '01:55', '01:53')
  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('40')
  await expectHours(page, '01:55', '01:53')
})

// @tc: TC-SCRUM-91-11
// @test: a venue saved with bad hours can be updated once its hours are corrected
// @story: SCRUM-91
// @ac: 3
test('a venue saved with bad hours can be updated once its hours are corrected', async ({ page }) => {
  const venue = setup(11, { stored: true })
  await login(page, 'venue1')

  await openUpdate(page, venue)
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('45')
  await fillHours(page, '01:53', '01:55')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expectSaved(page)
  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('45')
  await expectHours(page, '01:53', '01:55')
})

// @tc: TC-SCRUM-91-12
// @test: a venue saved with bad hours can be updated once both times are cleared
// @story: SCRUM-91
// @ac: 2, 3
test('a venue saved with bad hours can be updated once both times are cleared', async ({ page }) => {
  const venue = setup(12, { stored: true })
  await login(page, 'venue1')

  await openUpdate(page, venue)
  await fillHours(page, '', '')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expectSaved(page)
  await page.reload()
  await expectHours(page, 'None', 'None')
})
