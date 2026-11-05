import { test, expect } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-28 Submit Event Request.
// Seeded records are only read here (AUTOMATION.md): TC-SCRUM-28-02 saves a
// Draft of its own through the API and submits that, so the seeded Draft
// "Design Workshop" stays a Draft for every other spec, whatever the run order.

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

// The server compares against its local date, not UTC, so building "today"
// with toISOString() can be off by a day near local midnight.
function isoDate(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Always in the future, so the happy-path rows never age into a past date.
function daysFromToday(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

const VALID_REQUEST = {
  name: 'Tech Fair 2026',
  purpose: 'Career networking',
  description: 'Annual tech career fair',
  date: daysFromToday(30),
  'start-time': '09:00',
  'end-time': '17:00',
  attendance: '200',
  'equipment-requirements': 'Projector, microphones',
  'registration-needs': 'Online registration with capacity cap',
}

async function fillNewRequestForm(page, overrides = {}) {
  const values = { ...VALID_REQUEST, ...overrides }
  for (const [field, value] of Object.entries(values)) {
    await page.getByTestId(`request-new-${field}-input`).fill(value)
  }
}

// @tc: TC-SCRUM-28-01
// @test: organiser submits a new event request directly with all required fields completed
// @story: SCRUM-28
// @ac: 1, 4, 6
test('organiser submits a new event request directly with all required fields completed', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillNewRequestForm(page)
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Request submitted')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')

  await page.getByTestId('request-detail-back-link').click()
  await expect(page.getByText('Tech Fair 2026')).toBeVisible()
})

// @tc: TC-SCRUM-28-02
// @test: organiser submits a previously saved Draft request
// @story: SCRUM-28
// @ac: 2, 4
test('organiser submits a previously saved Draft request', async ({ page }) => {
  // org2's Draft, not org1's: an Organiser has one open Draft at a time, and
  // org1 holds the seeded Design Workshop. Submitting it leaves org2 none open.
  await login(page, 'org2')
  const saved = await page.request.post('/api/requests/draft', {
    data: {
      name: 'TC28-02 Saved Draft',
      purpose: 'Internal design workshop',
      description: 'A Draft saved for TC-SCRUM-28-02',
      date: daysFromToday(30),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 20,
      equipment_requirements: 'Projector',
      registration_needs: 'Internal sign-up sheet',
    },
  })
  expect(saved.status()).toBe(201)
  const { id } = await saved.json()

  await page.goto(`/requests/${id}`)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')
  await page.getByTestId('request-detail-submit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Request submitted')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
})

// @tc: TC-SCRUM-28-03
// @test: a submitted request becomes visible to Event Coordinators for review
// @story: SCRUM-28
// @ac: 5
test('a submitted request becomes visible to Event Coordinators for review', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()
  await fillNewRequestForm(page, { name: 'Coordinator Review Event' })
  await page.getByTestId('request-new-submit-button').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')

  // SCRUM-87: a coordinator sees it only once assigned, so it waits in the Lead's unassigned queue.
  await page.getByTestId('layout-logout-button').click()
  await login(page, 'lead1')
  await page.getByTestId('layout-nav-queue').click()

  await expect(page.getByRole('link', { name: 'Coordinator Review Event' })).toBeVisible()
})

// @tc: TC-SCRUM-28-04
// @test: submission is refused when a required field is missing
// @story: SCRUM-28
// @ac: 1, 3
test('submission is refused when a required field is missing', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillNewRequestForm(page, { name: '' })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-new-name-error')).toBeVisible()
  await expect(page).toHaveURL(/\/requests\/new$/)
})

// @tc: TC-SCRUM-28-05
// @test: a request that is already Submitted cannot be submitted again
// @story: SCRUM-28
// @ac: 2
test('a request that is already Submitted cannot be submitted again', async ({ page }) => {
  await login(page, 'org1')
  await page.goto('/requests/1')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-submit-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-28-06
// @test: submission is refused when the date is earlier than today
// @story: SCRUM-28
// @ac: 7
test('submission is refused when the date is earlier than today', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  const yesterday = isoDate(new Date(Date.now() - 24 * 60 * 60 * 1000))
  await fillNewRequestForm(page, { date: yesterday })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-new-banner')).toHaveText('Date cannot be earlier than today.')
  await expect(page).toHaveURL(/\/requests\/new$/)
})

// @tc: TC-SCRUM-28-07
// @test: a date of exactly today is accepted
// @story: SCRUM-28
// @ac: 7
test('a date of exactly today is accepted', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  const today = isoDate(new Date())
  await fillNewRequestForm(page, { name: 'Today Event', date: today })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Request submitted')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
})

// @tc: TC-SCRUM-28-08
// @test: submission is refused when the start time is later than the end time
// @story: SCRUM-28
// @ac: 8
test('submission is refused when the start time is later than the end time', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillNewRequestForm(page, { 'start-time': '17:00', 'end-time': '09:00' })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-new-banner')).toHaveText('Start time must be before the end time.')
  await expect(page).toHaveURL(/\/requests\/new$/)
})

// @tc: TC-SCRUM-28-09
// @test: a start time equal to the end time is refused
// @story: SCRUM-28
// @ac: 8
test('a start time equal to the end time is refused', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillNewRequestForm(page, { 'start-time': '09:00', 'end-time': '09:00' })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-new-banner')).toHaveText('Start time must be before the end time.')
  await expect(page).toHaveURL(/\/requests\/new$/)
})

// @tc: TC-SCRUM-28-10
// @test: submission is refused when attendance is negative, non-numeric, or a decimal
// @story: SCRUM-28
// @ac: 9
test('submission is refused when attendance is negative, non-numeric, or a decimal', async ({ page }) => {
  await login(page, 'org1')

  // A fresh form per value, so one value's banner cannot pass for the next's.
  for (const attendance of ['-5', '20.5']) {
    await page.getByTestId('layout-nav-requests').click()
    await page.getByTestId('requests-new-button').click()
    await expect(page.getByTestId('request-new-banner')).toHaveCount(0)

    await fillNewRequestForm(page, { attendance })
    await page.getByTestId('request-new-submit-button').click()

    await expect(page.getByTestId('request-new-banner')).toHaveText('Attendance must be a positive whole number.')
    await expect(page).toHaveURL(/\/requests\/new$/)
  }
})

// @tc: TC-SCRUM-28-11
// @test: an attendance of 0 is refused
// @story: SCRUM-28
// @ac: 9
test('an attendance of 0 is refused', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillNewRequestForm(page, { attendance: '0' })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-new-banner')).toHaveText('Attendance must be a positive whole number.')
  await expect(page).toHaveURL(/\/requests\/new$/)
})

// @tc: TC-SCRUM-28-12
// @test: submission is refused when a required field contains only whitespace
// @story: SCRUM-28
// @ac: 10
test('submission is refused when a required field contains only whitespace', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillNewRequestForm(page, { name: '   ' })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-new-name-error')).toBeVisible()
  await expect(page).toHaveURL(/\/requests\/new$/)
})
