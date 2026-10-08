import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-80 Record Setup and Turnaround Time
// for a Venue. Seeded Seminar Room 1 and Auditorium are standing data and are
// never mutated; every case creates its own 'SCRUM-80 TCxx Venue' through the
// API and any pre-existing times are recorded through the authorised time
// endpoint during setup (docs/test-cases/AUTOMATION.md).
//
// Setup time and turnaround time are durations in whole minutes, not clock
// times. One SQLite file is shared by every spec in a run, so each case
// asserts only on the venue it created.

const BASE_URL = 'http://localhost:5173'

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

// Ordinary venue through the API; `times` records setup/turnaround beforehand.
async function makeVenue(name, times = null) {
  const api = await apiAs('venue1')
  const created = await api.post('/api/venues', {
    data: { name, location: 'Block C Level 1', max_capacity: 70 },
  })
  expect(created.status()).toBe(201)
  const venue = await created.json()
  if (times) {
    const recorded = await api.patch(`/api/venues/${venue.id}/times`, { data: times })
    expect(recorded.status()).toBe(200)
  }
  await api.dispose()
  return venue
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
  await expect(page.getByTestId('login-username-input')).toBeVisible()
}

async function openVenue(page, venue) {
  await page.goto(`/venues/${venue.id}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText(venue.name)
  await expect(page.getByTestId('venue-detail-fields')).toBeVisible()
}

// Reopen the venue from the venue catalogue rather than by its URL.
async function reopenFromCatalogue(page, venue) {
  await page.getByTestId('layout-nav-venues').click()
  await page
    .getByTestId(`venues-row-${venue.id}`)
    .getByRole('link', { name: venue.name })
    .click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText(venue.name)
}

async function openTimes(page) {
  await page.getByTestId('venue-detail-times-button').click()
  await expect(page.getByTestId('venue-detail-times-setup-time-input')).toBeVisible()
}

// An empty string clears the field, which the page sends as blank.
async function fillTimes(page, setup, turnaround) {
  await page.getByTestId('venue-detail-times-setup-time-input').fill(setup)
  await page.getByTestId('venue-detail-times-turnaround-time-input').fill(turnaround)
}

async function saveTimes(page) {
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/times') && r.request().method() === 'PATCH',
    ),
    page.getByTestId('venue-detail-times-save-button').click(),
  ])
  return resp
}

async function expectTimes(page, setup, turnaround) {
  await expect(page.getByTestId('venue-detail-setup-time')).toHaveText(setup)
  await expect(page.getByTestId('venue-detail-turnaround-time')).toHaveText(turnaround)
}

// Rows 06–09: the save is refused, the banner names the field, and after a
// reload both stored times are exactly as they were.
async function expectRefused(page, venue, entry, message, stored) {
  await login(page, 'venue1')
  await openVenue(page, venue)
  await openTimes(page)
  await fillTimes(page, entry.setup, entry.turnaround)

  const resp = await saveTimes(page)
  expect(resp.status()).toBe(400)
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(message)

  await page.reload()
  await expectTimes(page, stored.setup, stored.turnaround)
}

const RECORDED = { setup: '30 minutes', turnaround: '15 minutes' }

// @tc: TC-SCRUM-80-01
// @test: Venue Staff record setup and turnaround times and see the saved values
// @story: SCRUM-80
// @ac: 1, 2, 5
test('Venue Staff record setup and turnaround times and see the saved values', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC01 Venue')
  await login(page, 'venue1')
  await openVenue(page, venue)
  await expectTimes(page, '0 minutes', '0 minutes')

  await openTimes(page)
  await fillTimes(page, '30', '15')
  const resp = await saveTimes(page)
  expect(resp.status()).toBe(200)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Times updated')
  await expectTimes(page, '30 minutes', '15 minutes')

  await page.reload()
  await expectTimes(page, '30 minutes', '15 minutes')

  await reopenFromCatalogue(page, venue)
  await expectTimes(page, '30 minutes', '15 minutes')
})

// @tc: TC-SCRUM-80-02
// @test: Venue Staff change a recorded setup time while retaining the turnaround time
// @story: SCRUM-80
// @ac: 1, 5
test('Venue Staff change a recorded setup time while retaining the turnaround time', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC02 Venue', { setup_time: 30, turnaround_time: 15 })
  await login(page, 'venue1')
  await openVenue(page, venue)
  await expectTimes(page, '30 minutes', '15 minutes')

  await openTimes(page)
  await page.getByTestId('venue-detail-times-setup-time-input').fill('45')
  const resp = await saveTimes(page)
  expect(resp.status()).toBe(200)

  await expectTimes(page, '45 minutes', '15 minutes')

  await page.reload()
  await expectTimes(page, '45 minutes', '15 minutes')
})

// @tc: TC-SCRUM-80-03
// @test: A venue with no recorded times shows zero for both values
// @story: SCRUM-80
// @ac: 4
test('A venue with no recorded times shows zero for both values', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC03 Venue')
  await login(page, 'venue1')
  await openVenue(page, venue)

  await expectTimes(page, '0 minutes', '0 minutes')

  await page.reload()
  await expectTimes(page, '0 minutes', '0 minutes')
})

// @tc: TC-SCRUM-80-04
// @test: An Event Coordinator sees saved times but is not offered an action to change them
// @story: SCRUM-80
// @ac: 5, 6
test('An Event Coordinator sees saved times but is not offered an action to change them', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC04 Venue', { setup_time: 30, turnaround_time: 15 })
  await login(page, 'venue1')
  await openVenue(page, venue)
  await openTimes(page)
  await fillTimes(page, '45', '20')
  const saved = await saveTimes(page)
  expect(saved.status()).toBe(200)
  await expectTimes(page, '45 minutes', '20 minutes')

  await logout(page)
  await login(page, 'coord1')
  await openVenue(page, venue)

  await expectTimes(page, '45 minutes', '20 minutes')
  await expect(page.getByTestId('venue-detail-times-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-80-05
// @test: An account without Venue Staff permission is refused when attempting to save time changes
// @story: SCRUM-80
// @ac: 6
test('An account without Venue Staff permission is refused when attempting to save time changes', async ({
  page,
  context,
}) => {
  const venue = await makeVenue('SCRUM-80 TC05 Venue', { setup_time: 30, turnaround_time: 15 })
  await login(page, 'venue1')
  await openVenue(page, venue)
  await openTimes(page)
  await fillTimes(page, '45', '20')

  // The original tab keeps its stale page; a second tab of the same
  // BrowserContext shares the session cookies, so signing in there as coord1
  // changes who the API sees when the first tab saves.
  const secondTab = await context.newPage()
  await secondTab.goto(`/venues/${venue.id}`)
  await expect(secondTab.getByTestId('layout-username')).toHaveText('venue1')
  await logout(secondTab)
  await login(secondTab, 'coord1')
  await secondTab.close()

  const resp = await saveTimes(page)
  expect(resp.status()).toBe(403)
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(
    'You do not have permission to perform this action.',
  )

  await page.reload()
  await expectTimes(page, '30 minutes', '15 minutes')
})

// @tc: TC-SCRUM-80-06
// @test: A fractional setup time is refused without saving either time
// @story: SCRUM-80
// @ac: 2, 3
test('A fractional setup time is refused without saving either time', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC06 Venue', { setup_time: 30, turnaround_time: 15 })
  await expectRefused(
    page,
    venue,
    { setup: '0.5', turnaround: '20' },
    'Setup time must be a non-negative whole number.',
    RECORDED,
  )
})

// @tc: TC-SCRUM-80-07
// @test: A fractional turnaround time is refused without saving either time
// @story: SCRUM-80
// @ac: 2, 3
test('A fractional turnaround time is refused without saving either time', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC07 Venue', { setup_time: 30, turnaround_time: 15 })
  await expectRefused(
    page,
    venue,
    { setup: '45', turnaround: '0.5' },
    'Turnaround time must be a non-negative whole number.',
    RECORDED,
  )
})

// @tc: TC-SCRUM-80-08
// @test: A setup time of minus one minute is refused
// @story: SCRUM-80
// @ac: 2, 3
test('A setup time of minus one minute is refused', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC08 Venue', { setup_time: 30, turnaround_time: 15 })
  await expectRefused(
    page,
    venue,
    { setup: '-1', turnaround: '20' },
    'Setup time must be a non-negative whole number.',
    RECORDED,
  )
})

// @tc: TC-SCRUM-80-09
// @test: A turnaround time of minus one minute is refused
// @story: SCRUM-80
// @ac: 2, 3
test('A turnaround time of minus one minute is refused', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC09 Venue', { setup_time: 30, turnaround_time: 15 })
  await expectRefused(
    page,
    venue,
    { setup: '45', turnaround: '-1' },
    'Turnaround time must be a non-negative whole number.',
    RECORDED,
  )
})

// @tc: TC-SCRUM-80-10
// @test: Venue Staff change both recorded times to zero
// @story: SCRUM-80
// @ac: 1, 2, 5
test('Venue Staff change both recorded times to zero', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC10 Venue', { setup_time: 30, turnaround_time: 15 })
  await login(page, 'venue1')
  await openVenue(page, venue)
  await expectTimes(page, '30 minutes', '15 minutes')

  await openTimes(page)
  await fillTimes(page, '0', '0')
  const resp = await saveTimes(page)
  expect(resp.status()).toBe(200)

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Times updated')
  await expectTimes(page, '0 minutes', '0 minutes')

  await page.reload()
  await expectTimes(page, '0 minutes', '0 minutes')
})

// @tc: TC-SCRUM-80-11
// @test: A setup and turnaround time of one minute are accepted
// @story: SCRUM-80
// @ac: 1, 2, 5
test('A setup and turnaround time of one minute are accepted', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC11 Venue')
  await login(page, 'venue1')
  await openVenue(page, venue)
  await expectTimes(page, '0 minutes', '0 minutes')

  await openTimes(page)
  await fillTimes(page, '1', '1')
  const resp = await saveTimes(page)
  expect(resp.status()).toBe(200)

  await expectTimes(page, '1 minute', '1 minute')

  await page.reload()
  await expectTimes(page, '1 minute', '1 minute')
})

// @tc: TC-SCRUM-80-12
// @test: A blank setup time is saved as zero while retaining the turnaround time
// @story: SCRUM-80
// @ac: 1, 2, 5
test('A blank setup time is saved as zero while retaining the turnaround time', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC12 Venue', { setup_time: 30, turnaround_time: 15 })
  await login(page, 'venue1')
  await openVenue(page, venue)
  await openTimes(page)

  // Clearing the field, not typing zero.
  await page.getByTestId('venue-detail-times-setup-time-input').fill('')
  const resp = await saveTimes(page)
  expect(resp.status()).toBe(200)

  await expectTimes(page, '0 minutes', '15 minutes')

  await page.reload()
  await expectTimes(page, '0 minutes', '15 minutes')
})

// @tc: TC-SCRUM-80-13
// @test: A blank turnaround time is saved as zero while retaining the setup time
// @story: SCRUM-80
// @ac: 1, 2, 5
test('A blank turnaround time is saved as zero while retaining the setup time', async ({ page }) => {
  const venue = await makeVenue('SCRUM-80 TC13 Venue', { setup_time: 30, turnaround_time: 15 })
  await login(page, 'venue1')
  await openVenue(page, venue)
  await openTimes(page)

  // Clearing the field, not typing zero.
  await page.getByTestId('venue-detail-times-turnaround-time-input').fill('')
  const resp = await saveTimes(page)
  expect(resp.status()).toBe(200)

  await expectTimes(page, '30 minutes', '0 minutes')

  await page.reload()
  await expectTimes(page, '30 minutes', '0 minutes')
})
