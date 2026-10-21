import { test, expect } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-27 Role-Based Access.

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

// @tc: TC-SCRUM-27-01
// @test: an Event Organiser sees only event requests they created
// @story: SCRUM-27
// @ac: 1
test('an Event Organiser sees only event requests they created', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()

  await expect(page.getByTestId('requests-title')).toBeVisible()
  await expect(page.getByText('Annual Dinner')).toBeVisible()
  await expect(page.getByText('Design Workshop')).toBeVisible()
  await expect(page.getByText('Client B Conference')).not.toBeVisible()
  await expect(page.getByTestId('layout-username')).toHaveText('org1')
  await expect(page.getByTestId('layout-roles')).toHaveText('Event Organiser')
})

// @tc: TC-SCRUM-27-02
// @test: an Event Coordinator sees event requests that are not Draft
// @story: SCRUM-27
// @ac: 3
test('an Event Coordinator sees event requests that are not Draft', async ({ page }) => {
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()

  // SCRUM-87: only the requests assigned to coord1 (Annual Dinner), never coord2's or a Draft.
  await expect(page.getByText('Annual Dinner')).toBeVisible()
  await expect(page.getByText('Client B Conference')).not.toBeVisible()
  await expect(page.getByText('Design Workshop')).not.toBeVisible()
  await expect(page.getByTestId('layout-roles')).toHaveText('Event Coordinator')
})

// @tc: TC-SCRUM-27-03
// @test: an account with two roles may use what either role allows
// @story: SCRUM-27
// @ac: 7
test('an account with two roles may use what either role allows', async ({ page }) => {
  await login(page, 'multi1')
  await page.getByTestId('layout-nav-requests').click()

  // SCRUM-87: the Coordinator role lists multi1's assigned events (Past Gala), not coord1's.
  await expect(page.getByText('Past Gala')).toBeVisible()
  await expect(page.getByText('Annual Dinner')).not.toBeVisible()
  await expect(page.getByText('Design Workshop')).not.toBeVisible()
  const roles = page.getByTestId('layout-roles')
  await expect(roles).toContainText('Event Coordinator')
  await expect(roles).toContainText('Venue Staff')
})

// @tc: TC-SCRUM-27-04
// @test: an Event Organiser cannot open another Organiser's event request
// @story: SCRUM-27
// @ac: 1, 2, 8
test("an Event Organiser cannot open another Organiser's event request", async ({ page }) => {
  await login(page, 'org2')
  await page.goto('/requests/1')

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-banner')).toHaveText(/permission|not found/i)
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-name')).toHaveCount(0)
})

// @tc: TC-SCRUM-27-05
// @test: an Event Coordinator cannot open a Draft event request
// @story: SCRUM-27
// @ac: 3, 8
test('an Event Coordinator cannot open a Draft event request', async ({ page }) => {
  await login(page, 'coord1')
  await page.goto('/requests/2')

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-name')).toHaveCount(0)
})

// @tc: TC-SCRUM-27-06
// @test: Venue Staff and Technical Support Staff are not offered edit of an event request
// @story: SCRUM-27
// @ac: 4, 5, 8
test('Venue Staff and Technical Support Staff are not offered edit of an event request', async ({ page }) => {
  for (const username of ['venue1', 'tech1']) {
    await login(page, username)
    await page.goto('/requests')
    await expect(page.getByTestId('not-permitted-message')).toBeVisible()
    await expect(page.getByTestId('requests-title')).toHaveCount(0)
    await page.getByTestId('layout-logout-button').click()
    await expect(page).toHaveURL(/\/login$/)
  }
})

// @tc: TC-SCRUM-27-07
// @test: an Attendee does not see internal planning information
// @story: SCRUM-27
// @ac: 6, 8
test('an Attendee does not see internal planning information', async ({ page }) => {
  await login(page, 'att1')
  await page.getByTestId('layout-nav-registration').click()

  await expect(page.getByText('Open House')).toBeVisible()
  await expect(page.getByText(/roster|internal|coordinator notes/i)).not.toBeVisible()
})

// @tc: TC-SCRUM-27-08
// @test: an Attendee can view a confirmed event that has registration enabled
// @story: SCRUM-27
// @ac: 6
test('an Attendee can view a confirmed event that has registration enabled', async ({ page }) => {
  await login(page, 'att1')
  await page.getByTestId('layout-nav-registration').click()

  await expect(page.getByTestId('registration-title')).toBeVisible()
  await expect(page.getByText('Open House')).toBeVisible()
  await expect(page.getByTestId('layout-roles')).toHaveText('Attendee')
})
