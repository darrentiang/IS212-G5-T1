import { test, expect } from '@playwright/test'

// SCRUM-89 Operational Safety Check. TC-SCRUM-89-01 through 16 (test-case
// sheet), one test per row. The rows that read run first and the rows that
// decide run last, because a decision cannot be undone (see below).
//
// The events the Safety Officer reviews are standing data (backend/seed/data.json):
// SCRUM-53 is what will move an event into Safety Check, and it is not built, so
// a test cannot create one. A decision cannot be undone, so each test that
// decides uses an event of its own; the tests that only read use events no test
// decides.
//
//   read only:  Harbour Gala is read by 02, 04, 14 and 15 and decided by 06, so the
//               deciding test is the last one in this file.
//   decided:    06 Harbour Gala, 07 Tech Summit, 08 Garden Concert, 11 Book Fair,
//               12 Robotics Expo, 13 Film Night.
//   never decided: Night Market (04 reads its bookings, 09 refuses a blank reason),
//               Lantern Fair (10).
//
// TC-SCRUM-89-04 asserts the venue's capacity, layouts, facilities and
// accessibility features; the "Approved equipment requirement" in that row
// arrives with SCRUM-48 and SCRUM-81 (see the pending unit test in
// backend/tests/test_safety_check.py), so the equipment line shows None here.

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function logout(page) {
  await page.getByTestId('layout-logout-button').click()
  await expect(page.getByTestId('login-submit-button')).toBeVisible()
}

async function openEvent(page, name) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByTestId('request-detail-fields')).toContainText(name)
}

async function approveWithNotes(page, notes) {
  for (const [area, text] of Object.entries(notes)) {
    await page.getByTestId(`request-detail-safety-note-${area}`).fill(text)
  }
  await page.getByTestId('request-detail-safety-approve-button').click()
}

async function notificationsOf(page, username) {
  await login(page, username)
  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
}

// @tc: TC-SCRUM-89-01
// @test: the seeded Safety Officer account can log in and is recognised as a Safety Officer
// @story: SCRUM-89
// @ac: 1
test('the seeded Safety Officer account can log in and is recognised as a Safety Officer', async ({ page }) => {
  await login(page, 'safety1')

  await expect(page.getByTestId('requests-title')).toBeVisible()
  await expect(page.getByTestId('layout-roles')).toHaveText('Safety Officer')
  await expect(page.getByTestId('requests-new-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-89-02
// @test: events in Safety Check are listed, the one that has been there longest first
// @story: SCRUM-89
// @ac: 2
test('events in Safety Check are listed, the one that has been there longest first', async ({ page }) => {
  await login(page, 'safety1')
  await expect(page.locator('[data-testid^="requests-row-"]').first()).toBeVisible()

  const names = await page.locator('[data-testid^="requests-row-"] a').allTextContents()
  expect(names.indexOf('Harbour Gala')).toBeGreaterThanOrEqual(0)
  expect(names.indexOf('Harbour Gala')).toBeLessThan(names.indexOf('Tech Summit'))
  expect(names.indexOf('Tech Summit')).toBeLessThan(names.indexOf('Lantern Fair'))
})

// @tc: TC-SCRUM-89-03
// @test: an event in any other status is not listed
// @story: SCRUM-89
// @ac: 2
test('an event in any other status is not listed', async ({ page }) => {
  await login(page, 'safety1')

  const rows = page.locator('[data-testid^="requests-row-"]')
  await expect(rows.first()).toBeVisible()
  await expect(rows.filter({ hasText: 'Annual Dinner' })).toHaveCount(0)
  await expect(rows.filter({ hasText: 'Open House' })).toHaveCount(0)
  const statuses = await page.locator('[data-testid^="requests-status-"]').allTextContents()
  expect(statuses.every((status) => status.trim() === 'Safety Check')).toBe(true)
})

// @tc: TC-SCRUM-89-04
// @test: the Safety Officer opens an event in Safety Check and sees what the check needs
// @story: SCRUM-89
// @ac: 3
test('the Safety Officer opens an event in Safety Check and sees what the check needs', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Harbour Gala')

  await expect(page.getByTestId('request-detail-attendance')).toHaveText('150')
  await expect(page.getByTestId('request-detail-date')).toHaveText('10 Jun 2027')
  await expect(page.getByTestId('request-detail-start-time')).toHaveText('18:00')
  await expect(page.getByTestId('request-detail-accessibility-features')).toHaveText(
    'Step-free access, Hearing loop',
  )

  const booking = page.locator('[data-testid^="request-detail-safety-booking-"][data-testid$="-venue"]')
  await expect(booking).toHaveCount(1)
  await expect(booking).toContainText('Auditorium')
  await expect(page.locator('[data-testid^="request-detail-safety-booking-"][data-testid$="-capacity"]')).toHaveText('400')
  await expect(page.locator('[data-testid^="request-detail-safety-booking-"][data-testid$="-facilities"]')).toHaveText('Projector, Stage lighting, Sound system')
  await expect(page.locator('[data-testid^="request-detail-safety-booking-"][data-testid$="-accessibility"]')).toHaveText(
    'Step-free access, Hearing loop, Accessible toilet, Reserved seating',
  )
  await expect(page.locator('[data-testid^="request-detail-safety-booking-"][data-testid$="-layouts"]')).toBeVisible()
})

// @tc: TC-SCRUM-89-05
// @test: the Safety Officer cannot open an event that is not in Safety Check
// @story: SCRUM-89
// @ac: 3
test('the Safety Officer cannot open an event that is not in Safety Check', async ({ page }) => {
  await login(page, 'coord1')
  await openEvent(page, 'Open House')
  const address = page.url()
  await logout(page)

  await login(page, 'safety1')
  await page.goto(address)

  await expect(page.getByTestId('request-detail-banner')).toContainText('You do not have permission')
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-safety-check')).toHaveCount(0)
})

// @tc: TC-SCRUM-89-09
// @test: a rejection with a blank or spaces-only reason is refused
// @story: SCRUM-89
// @ac: 5
test('a rejection with a blank or spaces-only reason is refused', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Night Market')

  await page.getByTestId('request-detail-safety-reject-button').click()
  await expect(page.getByTestId('request-detail-safety-reason-error')).toBeVisible()

  await page.getByTestId('request-detail-safety-reason-input').fill('   ')
  await page.getByTestId('request-detail-safety-reject-button').click()
  await expect(page.getByTestId('request-detail-safety-reason-error')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-decisions')).toHaveCount(0)
})

// @tc: TC-SCRUM-89-10
// @test: earlier decisions stay visible when the event is in Safety Check again
// @story: SCRUM-89
// @ac: 5
test('earlier decisions stay visible when the event is in Safety Check again', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Lantern Fair')

  const decisions = page.getByTestId('request-detail-safety-decisions')
  await expect(decisions).toContainText('Rejected')
  await expect(decisions).toContainText('Exits not marked')
  await expect(decisions).toContainText('safety1')
  await expect(decisions).toContainText('05 Oct 2026')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
})

// @tc: TC-SCRUM-89-14
// @test: an account that is not a Safety Officer cannot decide
// @story: SCRUM-89
// @ac: 10
test('an account that is not a Safety Officer cannot decide', async ({ page }) => {
  await login(page, 'coord1')
  await openEvent(page, 'Harbour Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-safety-reject-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-89-15
// @test: the Safety Officer cannot edit the event or its arrangements
// @story: SCRUM-89
// @ac: 10
test('the Safety Officer cannot edit the event or its arrangements', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Harbour Gala')

  for (const id of [
    'request-detail-edit-button',
    'request-detail-delete-button',
    'request-detail-submit-button',
    'request-detail-raise-booking-button',
    'request-detail-search-venues-button',
    'request-detail-approve-button',
    'request-detail-reject-button',
  ]) {
    await expect(page.getByTestId(id)).toHaveCount(0)
  }
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
})

// @tc: TC-SCRUM-89-16
// @test: a venue booking that is not Approved is not shown on the opened event
// @story: SCRUM-89
// @ac: 3
test('a venue booking that is not Approved is not shown on the opened event', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Night Market')

  const venues = page.locator('[data-testid^="request-detail-safety-booking-"][data-testid$="-venue"]')
  await expect(venues).toHaveCount(1)
  await expect(venues).toContainText('Seminar Room 1')
  await expect(page.getByTestId('request-detail-safety-check')).not.toContainText('Auditorium')
})

// @tc: TC-SCRUM-89-07
// @test: a note is optional: the Safety Officer approves with every note left blank
// @story: SCRUM-89
// @ac: 4, 5, 6
test('a note is optional: the Safety Officer approves with every note left blank', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Tech Summit')
  await page.getByTestId('request-detail-safety-approve-button').click()

  await expect(page.getByTestId('requests-banner')).toHaveText('Tech Summit: approved, now Confirmed')
  await expect(page.getByRole('link', { name: 'Tech Summit', exact: true })).toHaveCount(0)

  await logout(page)
  await login(page, 'coord1')
  await openEvent(page, 'Tech Summit')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  await expect(page.getByTestId('request-detail-safety-decisions')).toContainText('Approved')
  await expect(page.getByTestId('request-detail-safety-decisions')).toContainText('safety1')
})

// @tc: TC-SCRUM-89-08
// @test: the Safety Officer rejects an event with a reason
// @story: SCRUM-89
// @ac: 5, 7
test('the Safety Officer rejects an event with a reason', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Garden Concert')
  await page.getByTestId('request-detail-safety-reason-input').fill('Exit route blocked by stage')
  await page.getByTestId('request-detail-safety-reject-button').click()

  await expect(page.getByTestId('requests-banner')).toHaveText('Garden Concert: rejected, back in Planning')
  await expect(page.getByRole('link', { name: 'Garden Concert', exact: true })).toHaveCount(0)

  await logout(page)
  await login(page, 'coord1')
  await openEvent(page, 'Garden Concert')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  const decisions = page.getByTestId('request-detail-safety-decisions')
  await expect(decisions).toContainText('Rejected')
  await expect(decisions).toContainText('Exit route blocked by stage')
  await expect(decisions).toContainText('safety1')
})

// @tc: TC-SCRUM-89-11
// @test: the assigned coordinator is notified when the event is approved
// @story: SCRUM-89
// @ac: 8
test('the assigned coordinator is notified when the event is approved', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Book Fair')
  await page.getByTestId('request-detail-safety-approve-button').click()
  await expect(page.getByTestId('requests-banner')).toBeVisible()
  await logout(page)

  await notificationsOf(page, 'coord1')
  const row = page.locator('[data-testid^="notifications-row-"]', { hasText: 'Book Fair' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('passed its safety check and is now Confirmed')
  await expect(row).toContainText('Unread')
})

// @tc: TC-SCRUM-89-12
// @test: the assigned coordinator is notified of a rejection with its reason
// @story: SCRUM-89
// @ac: 8
test('the assigned coordinator is notified of a rejection with its reason', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Robotics Expo')
  await page.getByTestId('request-detail-safety-reason-input').fill('Crowd flow crosses the fire exit')
  await page.getByTestId('request-detail-safety-reject-button').click()
  await expect(page.getByTestId('requests-banner')).toBeVisible()
  await logout(page)

  await notificationsOf(page, 'coord1')
  const row = page.locator('[data-testid^="notifications-row-"]', { hasText: 'Robotics Expo' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('was rejected at its safety check')
  await expect(row).toContainText('Crowd flow crosses the fire exit')
})

// @tc: TC-SCRUM-89-13
// @test: a decision on an event that is no longer in Safety Check is refused
// @story: SCRUM-89
// @ac: 9
test('a decision on an event that is no longer in Safety Check is refused', async ({ browser }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()

  await login(first, 'safety1')
  await openEvent(first, 'Film Night')
  const address = first.url()
  await second.goto(address)
  await expect(second.getByTestId('request-detail-safety-form')).toBeVisible()

  await first.getByTestId('request-detail-safety-approve-button').click()
  await expect(first.getByTestId('requests-banner')).toContainText('Film Night')

  await second.getByTestId('request-detail-safety-reason-input').fill('Exit route blocked by stage')
  await second.getByTestId('request-detail-safety-reject-button').click()
  await expect(second.getByTestId('request-detail-banner')).toContainText('No event in Safety Check was found')

  await logout(first)
  await login(first, 'coord2')
  await openEvent(first, 'Film Night')
  await expect(first.getByTestId('request-detail-status')).toHaveText('Confirmed')
  await expect(first.locator('[data-testid^="request-detail-safety-decision-"][data-testid$="-decision"]')).toHaveCount(1)
  await context.close()
})

// @tc: TC-SCRUM-89-06
// @test: the Safety Officer approves an event with notes on two areas
// @story: SCRUM-89
// @ac: 4, 5, 6
test('the Safety Officer approves an event with notes on two areas', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Harbour Gala')
  await approveWithNotes(page, {
    'emergency-access': 'Two exits clear',
    'crowd-movement': 'One-way flow at the foyer',
  })

  await expect(page.getByTestId('requests-banner')).toHaveText('Harbour Gala: approved, now Confirmed')
  await logout(page)

  await login(page, 'coord1')
  await openEvent(page, 'Harbour Gala')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  const decisions = page.getByTestId('request-detail-safety-decisions')
  await expect(decisions).toContainText('Approved')
  await expect(decisions).toContainText('Emergency access: Two exits clear')
  await expect(decisions).toContainText('Crowd movement: One-way flow at the foyer')
  await expect(decisions).not.toContainText('Attendance:')
  await expect(decisions).toContainText('safety1')
})
