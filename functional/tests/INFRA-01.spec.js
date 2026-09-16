// @tc: TC-INFRA-01
// @test: app opens on the login page
// @story: INFRA
// @ac: 1
import { test, expect } from '@playwright/test'

test('app opens on the login page', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)

  await expect(page.getByTestId('login-username-input')).toBeVisible()
  await expect(page.getByTestId('login-password-input')).toBeVisible()
  await expect(page.getByTestId('login-submit-button')).toBeVisible()
})
