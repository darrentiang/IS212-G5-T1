import { test, expect } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-28 Submit Event Request.
// TC-SCRUM-28-02 reuses the seeded Draft "Design Workshop" (/requests/2) and
// submits it, so it must run after SCRUM-27.spec.js, which still needs that
// fixture as a Draft. Playwright runs spec files in discovery order
// (SCRUM-27 before SCRUM-28) with workers: 1, so this holds today.

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

const VALID_REQUEST = {
  name: 'Tech Fair 2026',
  purpose: 'Career networking',
  description: 'Annual tech career fair',
  date: '2026-11-20',
  'start-time': '09:00',
  'end-time': '17:00',
  attendance: '200',
  'venue-requirements': 'Large hall with stage',
  'accessibility-needs': 'Wheelchair access',
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
  await login(page, 'org1')
  await page.goto('/requests/2')

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

  await page.getByTestId('layout-logout-button').click()
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()

  await expect(page.getByText('Coordinator Review Event')).toBeVisible()
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
