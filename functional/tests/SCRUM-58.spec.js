import { test, expect } from '@playwright/test'

// SCRUM-58 View My Notifications. TC-SCRUM-58-01 through 09 (test-case
// sheet), one test per row in the row's order. AC8 ("cannot see, open or
// mark another's notification") has no reachable UI path to attempt it —
// the list only ever shows this account's own rows — so it is proven at the
// API in backend/tests/test_notifications.py instead.
//
// Unlike every other spec, these rows read and mutate the seeded
// notifications (backend/seed/data.json) rather than creating their own:
// there is no API that creates a notification (SCRUM-62/63/64 own that,
// neither built yet), and marking one read cannot be undone. Running this
// file depends on a freshly reseeded database (`python seed.py --reset`),
// the same requirement already true of any functional run against a
// polluted dev server.

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function openNotifications(page) {
  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
}

// @tc: TC-SCRUM-58-01
// @test: a logged-in user sees only their own notifications, newest first, with event name, message, date and read state
// @story: SCRUM-58
// @ac: 2
test('a logged-in user sees only their own notifications, newest first, with event name, message, date and read state', async ({
  page,
}) => {
  await login(page, 'org1')
  await openNotifications(page)

  const rows = page.locator('[data-testid^="notifications-row-"]')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Your request "Annual Dinner" was submitted.')
  await expect(rows.first()).toContainText('Unread')
  await expect(rows.nth(1)).toContainText('Your request "Open House" was approved.')
  await expect(rows.nth(1)).toContainText('Read')
})

// @tc: TC-SCRUM-58-02
// @test: the unread count is shown in the navigation on every page
// @story: SCRUM-58
// @ac: 3
test('the unread count is shown in the navigation on every page', async ({ page }) => {
  await login(page, 'org1')

  await expect(page.getByTestId('layout-nav-notifications')).toHaveText('Notifications (1)')

  await page.getByTestId('layout-nav-requests').click()
  await expect(page.getByTestId('layout-nav-notifications')).toHaveText('Notifications (1)')
})

// @tc: TC-SCRUM-58-03
// @test: opening an unread notification marks it read and the unread count falls by one
// @story: SCRUM-58
// @ac: 4
test('opening an unread notification marks it read and the unread count falls by one', async ({ page }) => {
  await login(page, 'org1')
  await openNotifications(page)

  const row = page.locator('[data-testid^="notifications-row-"]', { hasText: 'Annual Dinner' })
  const id = await row.getAttribute('data-testid')
  const notificationId = id.replace('notifications-row-', '')
  await row.getByTestId(`notifications-event-${notificationId}`).click()

  await expect(page).toHaveURL(new RegExp(`/requests/`))
  await page.goBack()
  await expect(page.getByTestId(`notifications-status-${notificationId}`)).toHaveText('Read')
  await expect(page.getByTestId('layout-nav-notifications')).toHaveText('Notifications')
})

// @tc: TC-SCRUM-58-04
// @test: opening an already-read notification changes nothing
// @story: SCRUM-58
// @ac: 4
test('opening an already-read notification changes nothing', async ({ page }) => {
  await login(page, 'org1')
  await openNotifications(page)

  const row = page.locator('[data-testid^="notifications-row-"]', { hasText: 'Open House' })
  const id = (await row.getAttribute('data-testid')).replace('notifications-row-', '')
  await expect(page.getByTestId(`notifications-status-${id}`)).toHaveText('Read')

  await row.getByTestId(`notifications-event-${id}`).click()
  await page.goBack()

  await expect(page.getByTestId(`notifications-status-${id}`)).toHaveText('Read')
})

// @tc: TC-SCRUM-58-05
// @test: marking all notifications as read clears the unread count to zero
// @story: SCRUM-58
// @ac: 5
test('marking all notifications as read clears the unread count to zero', async ({ page }) => {
  await login(page, 'coord1')
  await openNotifications(page)
  // coord1 may also hold notifications other specs created by deciding its
  // events (SCRUM-53 runs first), so the count is "some", not a fixed number.
  await expect(page.getByTestId('layout-nav-notifications')).toHaveText(/^Notifications \(\d+\)$/)

  await page.getByTestId('notifications-mark-all-button').click()

  await expect(page.getByTestId('layout-nav-notifications')).toHaveText('Notifications')
  const rows = page.locator('[data-testid^="notifications-status-"]')
  await expect(rows.first()).toBeVisible()
  for (const status of await rows.all()) {
    await expect(status).toHaveText('Read')
  }
})

// @tc: TC-SCRUM-58-06
// @test: a notification links to its event when the user may view that event
// @story: SCRUM-58
// @ac: 6
test('a notification links to its event when the user may view that event', async ({ page }) => {
  await login(page, 'coord1')
  await openNotifications(page)

  const row = page.locator('[data-testid^="notifications-row-"]', {
    hasText: 'This request now needs your attention.',
  })
  const id = (await row.getAttribute('data-testid')).replace('notifications-row-', '')
  const link = row.getByTestId(`notifications-event-${id}`)
  await expect(link).toHaveText('Annual Dinner')

  await link.click()
  await expect(page.getByTestId('request-detail-title')).toBeVisible()
})

// @tc: TC-SCRUM-58-07
// @test: a notification shows no link and reveals nothing about the event when the user may not view it
// @story: SCRUM-58
// @ac: 6
test('a notification shows no link and reveals nothing about the event when the user may not view it', async ({
  page,
}) => {
  // org2 cannot view "Annual Dinner" (another Organiser's event), whatever
  // its current status — robust against any other spec changing it.
  await login(page, 'org2')
  await openNotifications(page)

  const row = page.locator('[data-testid^="notifications-row-"]', {
    hasText: 'A note was recorded for this event.',
  })
  const id = (await row.getAttribute('data-testid')).replace('notifications-row-', '')
  await expect(row.getByTestId(`notifications-open-button-${id}`)).toBeVisible()
  await expect(row.getByTestId(`notifications-event-${id}`)).toHaveCount(0)
  await expect(row).not.toContainText('Annual Dinner')
})

// @tc: TC-SCRUM-58-08
// @test: a user with no notifications sees a message saying so
// @story: SCRUM-58
// @ac: 7
test('a user with no notifications sees a message saying so', async ({ page }) => {
  await login(page, 'tech1')
  await openNotifications(page)

  await expect(page.getByTestId('notifications-empty')).toBeVisible()
  await expect(page.getByTestId('layout-nav-notifications')).toHaveText('Notifications')
})

// @tc: TC-SCRUM-58-09
// @test: an account holding several roles sees the notifications for all of its roles in one list
// @story: SCRUM-58
// @ac: 9
test('an account holding several roles sees the notifications for all of its roles in one list', async ({
  page,
}) => {
  await login(page, 'multi1')
  await openNotifications(page)

  // Both roles' notifications are in the one list. The count is not fixed:
  // an earlier spec may have notified multi1 as an assigned coordinator.
  await expect(page.getByText('This event was marked completed.')).toBeVisible()
  await expect(page.getByText('A venue booking you manage was approved.')).toBeVisible()
})
