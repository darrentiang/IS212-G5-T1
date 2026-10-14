import { test, expect } from '@playwright/test'

// SCRUM-90 Return an Event for Safety Changes. TC-SCRUM-90-01 through 09
// (test-case sheet), one test per row. The rows that read run first and the
// rows that decide run last, because a decision cannot be undone.
//
// The events are standing data (backend/seed/data.json), as for SCRUM-89:
// SCRUM-53 is what will move an event into Safety Check and is not built.
// Each deciding test has an event of its own:
//   01 Chess Open, 02 Spring Recital, 05 Dance Night, 06 Maker Faire,
//   08 Quiz Night. Jazz Brunch (07) was sent again after a request for changes
//   and Night Market (03, 04) and Lantern Fair (09) are never decided here.
// Row 06 and 07's "sent again" part is seeded: SCRUM-53 does not exist yet.

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

async function tickAreas(page, ...areas) {
  for (const area of areas) {
    await page.getByTestId(`request-detail-safety-area-${area}`).check()
  }
}

async function requestChanges(page, { areas, reason, notes = {} }) {
  await tickAreas(page, ...areas)
  await page.getByTestId('request-detail-safety-reason-input').fill(reason)
  for (const [area, text] of Object.entries(notes)) {
    await page.getByTestId(`request-detail-safety-note-${area}`).fill(text)
  }
  await page.getByTestId('request-detail-safety-request-changes-button').click()
}

async function notificationsOf(page, username) {
  await login(page, username)
  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
}

// @tc: TC-SCRUM-90-03
// @test: a request with a blank or spaces-only reason is refused
// @story: SCRUM-90
// @ac: 2
test('a request with a blank or spaces-only reason is refused', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Night Market')

  await tickAreas(page, 'venue-arrangements')
  await page.getByTestId('request-detail-safety-request-changes-button').click()
  await expect(page.getByTestId('request-detail-safety-reason-error')).toBeVisible()

  await page.getByTestId('request-detail-safety-reason-input').fill('   ')
  await page.getByTestId('request-detail-safety-request-changes-button').click()
  await expect(page.getByTestId('request-detail-safety-reason-error')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-decisions')).toHaveCount(0)
})

// @tc: TC-SCRUM-90-04
// @test: a request with a reason but no area is refused
// @story: SCRUM-90
// @ac: 2
test('a request with a reason but no area is refused', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Night Market')

  await page.getByTestId('request-detail-safety-reason-input').fill('Exit route blocked by stage')
  await page.getByTestId('request-detail-safety-request-changes-button').click()
  await expect(page.getByTestId('request-detail-safety-area-error')).toContainText('at least one area')

  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-decisions')).toHaveCount(0)
})

// @tc: TC-SCRUM-90-07
// @test: an earlier request for changes stays visible once the event is sent again, with no changes outstanding
// @story: SCRUM-90
// @ac: 5, 7
test('an earlier request for changes stays visible once the event is sent again, with no changes outstanding', async ({
  page,
}) => {
  await login(page, 'safety1')
  await openEvent(page, 'Jazz Brunch')

  const decisions = page.getByTestId('request-detail-safety-decisions')
  await expect(decisions).toContainText('Changes requested')
  await expect(decisions).toContainText('Sound desk has no power feed')
  await expect(decisions).toContainText('Areas: Technical arrangements')
  await expect(decisions).toContainText('safety1')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-requested-changes')).toHaveCount(0)
})

// @tc: TC-SCRUM-90-09
// @test: an account that is not a Safety Officer cannot request changes
// @story: SCRUM-90
// @ac: 9
test('an account that is not a Safety Officer cannot request changes', async ({ page }) => {
  await login(page, 'coord1')
  await openEvent(page, 'Lantern Fair')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-safety-request-changes-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-safety-area-venue-arrangements')).toHaveCount(0)
})

// @tc: TC-SCRUM-90-02
// @test: one area is enough: the Safety Officer requests changes on exactly one area
// @story: SCRUM-90
// @ac: 1, 3
test('one area is enough: the Safety Officer requests changes on exactly one area', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Spring Recital')
  await requestChanges(page, {
    areas: ['technical-arrangements'],
    reason: 'Sound desk has no power feed',
  })

  await expect(page.getByTestId('requests-banner')).toHaveText(
    'Spring Recital: changes requested, back in Planning',
  )
  await expect(page.getByRole('link', { name: 'Spring Recital', exact: true })).toHaveCount(0)

  await logout(page)
  await login(page, 'coord2')
  await openEvent(page, 'Spring Recital')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-requested-changes-areas')).toHaveText('Technical arrangements')
  await expect(page.getByTestId('request-detail-requested-changes-reason')).toHaveText(
    'Sound desk has no power feed',
  )
})

// @tc: TC-SCRUM-90-05
// @test: the assigned coordinator is notified of the request with the reason and the areas
// @story: SCRUM-90
// @ac: 4
test('the assigned coordinator is notified of the request with the reason and the areas', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Dance Night')
  await requestChanges(page, {
    areas: ['venue-arrangements', 'technical-arrangements'],
    reason: 'Crowd flow crosses the fire exit',
  })
  await expect(page.getByTestId('requests-banner')).toBeVisible()
  await logout(page)

  await notificationsOf(page, 'coord1')
  const row = page.locator('[data-testid^="notifications-row-"]', { hasText: 'Dance Night' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Crowd flow crosses the fire exit')
  await expect(row).toContainText('venue arrangements and technical arrangements')
  await expect(row).toContainText('Unread')
})

// @tc: TC-SCRUM-90-06
// @test: the coordinator sees the requested changes on the event while it is in Planning
// @story: SCRUM-90
// @ac: 5
test('the coordinator sees the requested changes on the event while it is in Planning', async ({ page }) => {
  await login(page, 'safety1')
  await openEvent(page, 'Maker Faire')
  await requestChanges(page, { areas: ['venue-arrangements'], reason: 'Stalls block the fire lane' })
  await expect(page.getByTestId('requests-banner')).toBeVisible()
  await logout(page)

  await login(page, 'coord1')
  await openEvent(page, 'Maker Faire')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-requested-changes-reason')).toHaveText('Stalls block the fire lane')
  await expect(page.getByTestId('request-detail-requested-changes-areas')).toHaveText('Venue arrangements')
})

// @tc: TC-SCRUM-90-08
// @test: a request for changes on an event that is no longer in Safety Check is refused
// @story: SCRUM-90
// @ac: 8
test('a request for changes on an event that is no longer in Safety Check is refused', async ({ browser }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()

  await login(first, 'safety1')
  await openEvent(first, 'Quiz Night')
  const address = first.url()
  await second.goto(address)
  await expect(second.getByTestId('request-detail-safety-form')).toBeVisible()

  await requestChanges(first, { areas: ['venue-arrangements'], reason: 'Exit route blocked by stage' })
  await expect(first.getByTestId('requests-banner')).toContainText('Quiz Night')

  await requestChanges(second, { areas: ['venue-arrangements'], reason: 'Exit route blocked by stage' })
  await expect(second.getByTestId('request-detail-banner')).toContainText('No event in Safety Check was found')

  await logout(first)
  await login(first, 'coord1')
  await openEvent(first, 'Quiz Night')
  await expect(first.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(
    first.locator('[data-testid^="request-detail-safety-decision-"][data-testid$="-decision"]'),
  ).toHaveCount(1)
  await context.close()
})

// @tc: TC-SCRUM-90-01
// @test: the Safety Officer requests changes on both areas with a reason and a note
// @story: SCRUM-90
// @ac: 1, 3, 6, 7
test('the Safety Officer requests changes on both areas with a reason and a note', async ({ page }) => {
  await login(page, 'coord1')
  await openEvent(page, 'Chess Open')
  const before = {
    attendance: await page.getByTestId('request-detail-attendance').textContent(),
    date: await page.getByTestId('request-detail-date').textContent(),
    start: await page.getByTestId('request-detail-start-time').textContent(),
    end: await page.getByTestId('request-detail-end-time').textContent(),
  }
  await logout(page)

  await login(page, 'safety1')
  await openEvent(page, 'Chess Open')
  await requestChanges(page, {
    areas: ['venue-arrangements', 'technical-arrangements'],
    reason: 'Stage blocks the east exit',
    notes: { 'emergency-access': 'Move the stage back' },
  })
  await expect(page.getByTestId('requests-banner')).toHaveText(
    'Chess Open: changes requested, back in Planning',
  )
  await logout(page)

  await login(page, 'coord1')
  await openEvent(page, 'Chess Open')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-attendance')).toHaveText(before.attendance)
  await expect(page.getByTestId('request-detail-date')).toHaveText(before.date)
  await expect(page.getByTestId('request-detail-start-time')).toHaveText(before.start)
  await expect(page.getByTestId('request-detail-end-time')).toHaveText(before.end)
  const decisions = page.getByTestId('request-detail-safety-decisions')
  await expect(decisions).toContainText('Changes requested')
  await expect(decisions).toContainText('Areas: Venue arrangements, Technical arrangements')
  await expect(decisions).toContainText('Stage blocks the east exit')
  await expect(decisions).toContainText('Emergency access: Move the stage back')
  await expect(decisions).toContainText('safety1')

  // Its Approved booking is unchanged: the venue's booking list still says so.
  const venues = await (await page.request.get('/api/venues')).json()
  const auditorium = venues.find((venue) => venue.name === 'Auditorium')
  const bookings = await (await page.request.get(`/api/venues/${auditorium.id}/bookings`)).json()
  const mine = bookings.filter((booking) => booking.event_request_name === 'Chess Open')
  expect(mine).toHaveLength(1)
  expect(mine[0].status).toBe('Approved')
})
