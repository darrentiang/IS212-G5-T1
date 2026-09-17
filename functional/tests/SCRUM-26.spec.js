import { test, expect } from '@playwright/test'

// Curated rows: team test sheet, Test cases tab (SCRUM-26).
// One test per row, in row order. Test ids: docs/design/ui-guidelines.md.

async function login(page, username, password) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill(password)
  await page.getByTestId('login-submit-button').click()
}

// @tc: TC-SCRUM-26-01
// @test: an account with one role logs in and reaches the landing view
// @story: SCRUM-26
// @ac: 1, 2
test('an account with one role logs in and reaches the landing view', async ({ page }) => {
  await login(page, 'org1', 'Passw0rd!')

  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByTestId('layout-username')).toHaveText('org1')
  await expect(page.getByTestId('layout-roles')).toHaveText('Event Organiser')
  await expect(page.getByTestId('login-username-input')).not.toBeVisible()
})

// @tc: TC-SCRUM-26-02
// @test: an account with two roles logs in and the landing view shows both roles
// @story: SCRUM-26
// @ac: 1, 2, 7
test('an account with two roles logs in and the landing view shows both roles', async ({ page }) => {
  await login(page, 'multi1', 'Passw0rd!')

  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByTestId('layout-username')).toHaveText('multi1')
  const roles = page.getByTestId('layout-roles')
  await expect(roles).toContainText('Event Coordinator')
  await expect(roles).toContainText('Venue Staff')
})

// @tc: TC-SCRUM-26-03
// @test: a correct username with the wrong password is refused
// @story: SCRUM-26
// @ac: 3
test('a correct username with the wrong password is refused', async ({ page }) => {
  await login(page, 'org1', 'Wr0ngPass!')

  await expect(page).toHaveURL(/\/login$/)
  const banner = page.getByTestId('login-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText('Invalid username or password')

  await page.goto('/requests')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-username-input')).toBeVisible()
})

// @tc: TC-SCRUM-26-04
// @test: a username that belongs to no account is refused with the same message as a wrong password
// @story: SCRUM-26
// @ac: 3, 4
test('a username that belongs to no account is refused with the same message as a wrong password', async ({ page }) => {
  await login(page, 'nosuchuser', 'Passw0rd!')

  await expect(page).toHaveURL(/\/login$/)
  const banner = page.getByTestId('login-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText('Invalid username or password')
})

// @tc: TC-SCRUM-26-05
// @test: submitting the login form with both fields empty sends nothing and marks both fields
// @story: SCRUM-26
// @ac: 1
test('submitting the login form with both fields empty sends nothing and marks both fields', async ({ page }) => {
  const loginCalls = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/login')) {
      loginCalls.push(request.url())
    }
  })

  await page.goto('/login')
  await page.getByTestId('login-submit-button').click()

  await expect(page.getByTestId('login-username-error')).toBeVisible()
  await expect(page.getByTestId('login-password-error')).toBeVisible()
  await expect(page.getByTestId('login-banner')).not.toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
  expect(loginCalls).toHaveLength(0)
})

// @tc: TC-SCRUM-26-06
// @test: opening a protected page while not logged in shows the login page instead
// @story: SCRUM-26
// @ac: 5
test('opening a protected page while not logged in shows the login page instead', async ({ page }) => {
  await page.goto('/requests')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('login-username-input')).toBeVisible()
  await expect(page.getByTestId('requests-title')).not.toBeVisible()
})

// @tc: TC-SCRUM-26-07
// @test: after logging out a protected page is refused until the user logs in again
// @story: SCRUM-26
// @ac: 6
test('after logging out a protected page is refused until the user logs in again', async ({ page }) => {
  await login(page, 'org1', 'Passw0rd!')
  await expect(page).toHaveURL(/\/requests$/)

  await page.getByTestId('layout-logout-button').click()
  await expect(page).toHaveURL(/\/login$/)

  await page.goto('/requests')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByTestId('requests-title')).not.toBeVisible()

  await login(page, 'org1', 'Passw0rd!')
  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByTestId('layout-username')).toHaveText('org1')
})

// @tc: TC-SCRUM-26-08
// @test: a logged-in session survives reloading the browser
// @story: SCRUM-26
// @ac: 5
test('a logged-in session survives reloading the browser', async ({ page }) => {
  await login(page, 'org1', 'Passw0rd!')
  await expect(page).toHaveURL(/\/requests$/)

  await page.reload()

  await expect(page).toHaveURL(/\/requests$/)
  await expect(page.getByTestId('layout-username')).toHaveText('org1')
  await expect(page.getByTestId('layout-roles')).toHaveText('Event Organiser')
})
