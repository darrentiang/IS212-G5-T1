import { test, expect } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-31 Add a Venue.
// Seminar Room 1 and Auditorium are seeded standing data; every venue a test
// adds is created by that test and asserted by its own name or id
// (docs/test-cases/AUTOMATION.md).

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

// The id of the venue just saved, read from the address of the page it opened.
function savedVenueId(page) {
  return page.url().split('/').at(-1)
}

// @tc: TC-SCRUM-31-01
// @test: Venue Staff add a venue with every field recorded and open it from the venue list
// @story: SCRUM-31
// @ac: 1, 4
test('Venue Staff add a venue with every field recorded and open it from the venue list', async ({ page }) => {
  await login(page, 'venue1')
  await expect(page.getByTestId('venues-title')).toBeVisible()

  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-name-input').fill('Hall A')
  await page.getByTestId('venue-new-location-input').fill('Block B Level 3')
  await page.getByTestId('venue-new-max-capacity-input').fill('250')
  await page.getByTestId('venue-new-opening-time-input').fill('08:00')
  await page.getByTestId('venue-new-closing-time-input').fill('22:00')
  await page.getByTestId('venue-new-facilities-projector-input').check()
  await page.getByTestId('venue-new-facilities-stage-lighting-input').check()
  await page.getByTestId('venue-new-accessibility-features-step-free-access-input').check()
  await page.getByTestId('venue-new-accessibility-features-hearing-loop-input').check()
  await page.getByTestId('venue-new-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue added')
  const id = savedVenueId(page)

  await page.getByTestId('venue-detail-back-link').click()
  const row = page.getByTestId(`venues-row-${id}`)
  await expect(row).toContainText('Hall A')
  await row.getByRole('link', { name: 'Hall A' }).click()

  await expect(page.getByTestId('venue-detail-name')).toHaveText('Hall A')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block B Level 3')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('250')
  await expect(page.getByTestId('venue-detail-opening-time')).toHaveText('08:00')
  await expect(page.getByTestId('venue-detail-closing-time')).toHaveText('22:00')
  await expect(page.getByTestId('venue-detail-facilities')).toHaveText('Projector, Stage lighting')
  await expect(page.getByTestId('venue-detail-accessibility-features')).toHaveText('Step-free access, Hearing loop')
  // The facilities left unticked are not recorded.
  await expect(page.getByTestId('venue-detail-facilities')).not.toContainText('Whiteboard')
  await expect(page.getByTestId('venue-detail-accessibility-features')).not.toContainText('Lift access')
})

// @tc: TC-SCRUM-31-02
// @test: Venue Staff add a venue with only the three required fields filled
// @story: SCRUM-31
// @ac: 1, 2, 4
test('Venue Staff add a venue with only the three required fields filled', async ({ page }) => {
  await login(page, 'venue1')

  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-name-input').fill('Studio B')
  await page.getByTestId('venue-new-location-input').fill('Block C Level 1')
  await page.getByTestId('venue-new-max-capacity-input').fill('40')
  await page.getByTestId('venue-new-save-button').click()

  // The form was sent rather than answered with a message under a field.
  await expect(page).toHaveURL(/\/venues\/\d+$/)
  await expect(page.getByTestId('venue-new-name-error')).toHaveCount(0)
  await expect(page.getByTestId('venue-new-location-error')).toHaveCount(0)
  await expect(page.getByTestId('venue-new-max-capacity-error')).toHaveCount(0)
  const id = savedVenueId(page)

  await page.getByTestId('venue-detail-back-link').click()
  await expect(page.getByTestId(`venues-row-${id}`)).toContainText('Studio B')

  await page.getByTestId(`venues-row-${id}`).getByRole('link', { name: 'Studio B' }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('Studio B')
  await expect(page.getByTestId('venue-detail-location')).toHaveText('Block C Level 1')
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('40')
  await expect(page.getByTestId('venue-detail-facilities')).toHaveText('None')
  await expect(page.getByTestId('venue-detail-accessibility-features')).toHaveText('None')
})

// @tc: TC-SCRUM-31-03
// @test: an Event Coordinator may see venues but is offered no way to add one
// @story: SCRUM-31
// @ac: 5
test('an Event Coordinator may see venues but is offered no way to add one', async ({ page }) => {
  await login(page, 'coord1')

  await page.getByTestId('layout-nav-venues').click()

  await expect(page.getByTestId('venues-title')).toBeVisible()
  await expect(page.getByTestId('venues-row-1')).toContainText('Seminar Room 1')
  await expect(page.getByTestId('venues-row-2')).toContainText('Auditorium')
  await expect(page.getByTestId('venues-add-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-31-04
// @test: an account without Venue Staff permission is refused the add-venue page opened by address
// @story: SCRUM-31
// @ac: 5
test('an account without Venue Staff permission is refused the add-venue page opened by address', async ({ page }) => {
  await login(page, 'coord1')

  await page.goto('/venues/new')

  await expect(page.getByTestId('not-permitted-message')).toBeVisible()
  await expect(page.getByTestId('not-permitted-home-link')).toBeVisible()
  await expect(page).toHaveURL(/\/venues\/new$/)
  await expect(page.getByTestId('venue-new-name-input')).toHaveCount(0)

  await page.getByTestId('layout-nav-venues').click()
  await expect(page.getByTestId('venues-row-1')).toContainText('Seminar Room 1')
})

// @tc: TC-SCRUM-31-05
// @test: a venue cannot be saved with name, location and maximum capacity blank
// @story: SCRUM-31
// @ac: 2
test('a venue cannot be saved with name, location and maximum capacity blank', async ({ page }) => {
  await login(page, 'venue1')

  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-opening-time-input').fill('09:00')
  await page.getByTestId('venue-new-closing-time-input').fill('17:00')
  await page.getByTestId('venue-new-save-button').click()

  await expect(page.getByTestId('venue-new-name-error')).toBeVisible()
  await expect(page.getByTestId('venue-new-location-error')).toBeVisible()
  await expect(page.getByTestId('venue-new-max-capacity-error')).toBeVisible()
  await expect(page.getByTestId('venue-new-banner')).toHaveCount(0)
  // Still on the form, so nothing was sent and nothing was saved.
  await expect(page).toHaveURL(/\/venues\/new$/)

  await page.getByTestId('venue-new-back-link').click()
  await expect(page.getByTestId('venues-row-1')).toContainText('Seminar Room 1')
  await expect(page.getByTestId('venues-row-2')).toContainText('Auditorium')
})

// @tc: TC-SCRUM-31-06
// @test: a maximum capacity that is not a whole number is refused
// @story: SCRUM-31
// @ac: 3
test('a maximum capacity that is not a whole number is refused', async ({ page }) => {
  await login(page, 'venue1')

  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-name-input').fill('Room C')
  await page.getByTestId('venue-new-location-input').fill('Block D Level 2')
  await page.getByTestId('venue-new-max-capacity-input').fill('50.5')
  await page.getByTestId('venue-new-save-button').click()

  await expect(page.getByTestId('venue-new-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-new-banner')).toHaveText('Maximum capacity must be a positive whole number.')
  await expect(page.getByTestId('venue-new-max-capacity-error')).toHaveCount(0)
  await expect(page).toHaveURL(/\/venues\/new$/)

  await page.getByTestId('venue-new-back-link').click()
  await expect(page.getByText('Room C')).toHaveCount(0)
})

// @tc: TC-SCRUM-31-07
// @test: a maximum capacity of 0 is refused
// @story: SCRUM-31
// @ac: 3
test('a maximum capacity of 0 is refused', async ({ page }) => {
  await login(page, 'venue1')

  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-name-input').fill('Room D')
  await page.getByTestId('venue-new-location-input').fill('Block D Level 3')
  await page.getByTestId('venue-new-max-capacity-input').fill('0')
  await page.getByTestId('venue-new-save-button').click()

  await expect(page.getByTestId('venue-new-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-new-banner')).toHaveText('Maximum capacity must be a positive whole number.')

  await page.getByTestId('venue-new-back-link').click()
  await expect(page.getByText('Room D')).toHaveCount(0)
})

// @tc: TC-SCRUM-31-08
// @test: a maximum capacity of 1 is accepted
// @story: SCRUM-31
// @ac: 1, 3, 4
test('a maximum capacity of 1 is accepted', async ({ page }) => {
  await login(page, 'venue1')

  await page.getByTestId('venues-add-button').click()
  await page.getByTestId('venue-new-name-input').fill('Room E')
  await page.getByTestId('venue-new-location-input').fill('Block D Level 4')
  await page.getByTestId('venue-new-max-capacity-input').fill('1')
  await page.getByTestId('venue-new-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue added')
  const id = savedVenueId(page)

  await page.getByTestId('venue-detail-back-link').click()
  await expect(page.getByTestId(`venues-row-${id}`)).toContainText('Room E')

  await page.getByTestId(`venues-row-${id}`).getByRole('link', { name: 'Room E' }).click()
  await expect(page.getByTestId('venue-detail-max-capacity')).toHaveText('1')
})
