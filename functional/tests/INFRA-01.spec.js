// @tc: TC-INFRA-05
// @story: INFRA
// @ac: 1
// @type: Happy
// @scenario: Ping button calls backend and displays pong through full stack
// @preconditions: Flask backend and Vite frontend are running
// @steps: 1. Visit app 2. Click "Ping Backend" 3. Assert result shown
// @test_data: none
// @expected: "Backend says: pong" is displayed on the page
import { test, expect } from '@playwright/test'

test('ping button calls backend and shows pong', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('ConnectSphere Event Planning')).toBeVisible()

  await page.getByRole('button', { name: 'Ping Backend' }).click()

  await expect(page.getByText(/Backend says: pong/)).toBeVisible()
})
