import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-75 Update Venue Details.
// Seeded standing data (Seminar Room 1, Auditorium) is not modified; every
// venue a test uses is created by that test via the API and opened by its id
// (docs/test-cases/AUTOMATION.md).

const BASE_URL = 'http://localhost:5173'

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

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

async function createTestVenue(api, data) {
  const resp = await api.post('/api/venues', { data })
  expect(resp.ok()).toBeTruthy()
  return await resp.json()
}

// @tc: TC-SCRUM-75-01
// @test: Venue Staff update every recorded venue field and see the saved values
// @story: SCRUM-75
// @ac: 1, 3, 5
test('Venue Staff update every recorded venue field and see the saved values', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC01 Venue',
    location: 'Block A Level 1',
    max_capacity: 50,
    opening_time: '08:00',
    closing_time: '18:00',
    facilities: ['Projector'],
    accessibility_features: ['Lift access'],
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC01 Venue')

  await page.getByTestId('venue-detail-update-button').click()

  await page.getByTestId('venue-detail-update-name-input').fill('SCRUM-75 TC01 Updated Venue')
  await page.getByTestId('venue-detail-update-location-input').fill('Block B Level 2')
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('120')
  await page.getByTestId('venue-detail-update-opening-time-input').fill('00:00')
  await page.getByTestId('venue-detail-update-closing-time-input').fill('23:59')

  // Uncheck previous options and check new ones
  await page.getByTestId('venue-detail-update-facilities-projector-input').uncheck()
  await page.getByTestId('venue-detail-update-facilities-stage-lighting-input').check()
  await page.getByTestId('venue-detail-update-facilities-sound-system-input').check()

  await page.getByTestId('venue-detail-update-accessibility-features-lift-access-input').uncheck()
  await page.getByTestId('venue-detail-update-accessibility-features-step-free-access-input').check()
  await page.getByTestId('venue-detail-update-accessibility-features-hearing-loop-input').check()

  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue updated')

  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC01 Updated Venue')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block B Level 2')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('120')
  await expect(page.getByTestId('venue-detail-opening-time')).toHaveText('00:00')
  await expect(page.getByTestId('venue-detail-closing-time')).toHaveText('23:59')
  await expect(page.getByTestId('venue-detail-facilities')).toHaveText('Stage lighting, Sound system')
  await expect(page.getByTestId('venue-detail-accessibility-features')).toHaveText('Step-free access, Hearing loop')

  // Navigate to catalogue and re-open
  await page.getByTestId('venue-detail-back-link').click()
  const row = page.getByTestId(`venues-row-${initial.id}`)
  await expect(row).toContainText('SCRUM-75 TC01 Updated Venue')
  await row.getByRole('link', { name: 'SCRUM-75 TC01 Updated Venue' }).click()

  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC01 Updated Venue')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block B Level 2')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('120')
})

// @tc: TC-SCRUM-75-02
// @test: Venue Staff remove all optional venue information
// @story: SCRUM-75
// @ac: 1, 2, 5
test('Venue Staff remove all optional venue information', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC02 Venue',
    location: 'Block A Level 2',
    max_capacity: 75,
    opening_time: '09:00',
    closing_time: '17:00',
    facilities: ['Projector'],
    accessibility_features: ['Step-free access'],
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC02 Venue')

  await page.getByTestId('venue-detail-update-button').click()

  await page.getByTestId('venue-detail-update-opening-time-input').fill('')
  await page.getByTestId('venue-detail-update-closing-time-input').fill('')
  await page.getByTestId('venue-detail-update-facilities-projector-input').uncheck()
  await page.getByTestId('venue-detail-update-accessibility-features-step-free-access-input').uncheck()

  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue updated')

  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC02 Venue')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block A Level 2')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('75')
  await expect(page.getByTestId('venue-detail-opening-time')).toHaveText('None')
  await expect(page.getByTestId('venue-detail-closing-time')).toHaveText('None')
  await expect(page.getByTestId('venue-detail-facilities')).toHaveText('None')
  await expect(page.getByTestId('venue-detail-accessibility-features')).toHaveText('None')
})

// @tc: TC-SCRUM-75-03
// @test: Updating one venue field preserves every other recorded field
// @story: SCRUM-75
// @ac: 1, 5
test('Updating one venue field preserves every other recorded field', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC03 Venue',
    location: 'Block C Level 1',
    max_capacity: 80,
    opening_time: '09:00',
    closing_time: '21:00',
    facilities: ['Whiteboard'],
    accessibility_features: ['Lift access'],
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC03 Venue')

  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-name-input').fill('SCRUM-75 TC03 Renamed Venue')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue updated')

  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC03 Renamed Venue')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block C Level 1')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('80')
  await expect(page.getByTestId('venue-detail-opening-time')).toHaveText('09:00')
  await expect(page.getByTestId('venue-detail-closing-time')).toHaveText('21:00')
  await expect(page.getByTestId('venue-detail-facilities')).toHaveText('Whiteboard')
  await expect(page.getByTestId('venue-detail-accessibility-features')).toHaveText('Lift access')
})

// @tc: TC-SCRUM-75-04
// @test: An Event Coordinator sees updated venue information but is not offered the update action
// @story: SCRUM-75
// @ac: 5, 6
test('An Event Coordinator sees updated venue information but is not offered the update action', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC04 Venue',
    location: 'Block C Level 1',
    max_capacity: 60,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-location-input').fill('Block D Level 3')
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('90')
  await page.getByTestId('venue-detail-update-save-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue updated')

  await logout(page)

  await login(page, 'coord1')
  await page.goto(`/venues/${initial.id}`)
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block D Level 3')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('90')
  await expect(page.getByTestId('venue-detail-update-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-75-05
// @test: A blank venue name is refused and the stored venue is unchanged
// @story: SCRUM-75
// @ac: 2, 3, 4
test('A blank venue name is refused and the stored venue is unchanged', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC05 Venue',
    location: 'Block E Level 1',
    max_capacity: 50,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-name-input').fill('')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-update-name-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-update-name-error')).toHaveText('Name is required')

  await page.reload()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('SCRUM-75 TC05 Venue')
})

// @tc: TC-SCRUM-75-06
// @test: A whitespace-only venue location is refused and the stored venue is unchanged
// @story: SCRUM-75
// @ac: 2, 3, 4
test('A whitespace-only venue location is refused and the stored venue is unchanged', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC06 Venue',
    location: 'Block E Level 2',
    max_capacity: 50,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-location-input').fill('   ')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-update-location-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-update-location-error')).toHaveText('Location is required')

  await page.reload()
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block E Level 2')
})

// @tc: TC-SCRUM-75-07
// @test: A blank maximum capacity is refused and the stored venue is unchanged
// @story: SCRUM-75
// @ac: 2, 3, 4
test('A blank maximum capacity is refused and the stored venue is unchanged', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC07 Venue',
    location: 'Block E Level 3',
    max_capacity: 85,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-update-max-capacity-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-update-max-capacity-error')).toHaveText('Maximum capacity is required')

  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('85')
})

// @tc: TC-SCRUM-75-08
// @test: A fractional maximum capacity is refused and the stored venue is unchanged
// @story: SCRUM-75
// @ac: 3, 4
test('A fractional maximum capacity is refused and the stored venue is unchanged', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC08 Venue',
    location: 'Block E Level 4',
    max_capacity: 50,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('50.5')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Maximum capacity must be a positive whole number.')

  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('50')
})

// @tc: TC-SCRUM-75-09
// @test: A maximum capacity of zero is refused
// @story: SCRUM-75
// @ac: 3, 4
test('A maximum capacity of zero is refused', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC09 Venue',
    location: 'Block F Level 1',
    max_capacity: 50,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('0')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Maximum capacity must be a positive whole number.')

  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('50')
})

// @tc: TC-SCRUM-75-10
// @test: A maximum capacity of one is accepted
// @story: SCRUM-75
// @ac: 3, 5
test('A maximum capacity of one is accepted', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC10 Venue',
    location: 'Block F Level 2',
    max_capacity: 50,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('1')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue updated')

  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('1')
})

// @tc: TC-SCRUM-75-11
// @test: A maximum capacity of two is accepted
// @story: SCRUM-75
// @ac: 3, 5
test('A maximum capacity of two is accepted', async ({ page }) => {
  const api = await apiAs('venue1')
  const initial = await createTestVenue(api, {
    name: 'SCRUM-75 TC11 Venue',
    location: 'Block F Level 3',
    max_capacity: 50,
  })

  await login(page, 'venue1')
  await page.goto(`/venues/${initial.id}`)
  await page.getByTestId('venue-detail-update-button').click()
  await page.getByTestId('venue-detail-update-max-capacity-input').fill('2')
  await page.getByTestId('venue-detail-update-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue updated')

  await page.reload()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('2')
})
