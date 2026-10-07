import { test, expect, request as playwrightRequest } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const response = await api.post('/api/login', {
    data: { username, password: 'Passw0rd!' },
  })
  expect(response.ok()).toBeTruthy()
  return api
}

async function createVenue(name, layouts = []) {
  const api = await apiAs('venue1')
  const venueResponse = await api.post('/api/venues', {
    data: { name, location: 'Block D Level 1', max_capacity: 80 },
  })
  expect(venueResponse.status()).toBe(201)
  const venue = await venueResponse.json()
  if (layouts.length > 0) {
    const layoutResponse = await api.patch(`/api/venues/${venue.id}/layouts`, {
      data: { layouts },
    })
    expect(layoutResponse.status()).toBe(200)
  }
  await api.dispose()
  return venue
}

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function logout(page) {
  await page.getByTestId('layout-logout-button').click()
  await expect(page.getByTestId('login-username-input')).toBeVisible()
}

async function openVenue(page, venue) {
  await page.goto(`/venues/${venue.id}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText(venue.name)
}

async function saveLayouts(page, layouts) {
  for (const layout of ['classroom', 'theatre', 'boardroom', 'banquet', 'exhibition']) {
    const input = page.getByTestId(`venue-detail-layouts-${layout}-input`)
    if ((await input.isChecked()) !== layouts.includes(layout[0].toUpperCase() + layout.slice(1))) {
      await input.click()
    }
  }
  await page.getByTestId('venue-detail-layouts-save-button').click()
}

async function shownLayouts(page) {
  return page.getByTestId('venue-detail-layouts-value').innerText()
}

// @tc: TC-SCRUM-32-01
// @test: Venue Staff record multiple supported layouts against a venue
// @story: SCRUM-32
// @ac: 1, 3, 4
test('Venue Staff record multiple supported layouts against a venue', async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC01 Venue')
  await login(page, 'venue1')
  await openVenue(page, venue)

  await page.getByTestId('venue-detail-layouts-button').click()
  await saveLayouts(page, ['Classroom', 'Theatre'])
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Layouts updated')
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom, Theatre')

  await page.reload()
  await page.getByTestId('venue-detail-back-link').click()
  await page.getByTestId(`venues-row-${venue.id}`).getByRole('link', { name: venue.name }).click()
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom, Theatre')
})

// @tc: TC-SCRUM-32-02
// @test: Venue Staff add a supported layout while retaining an existing assignment
// @story: SCRUM-32
// @ac: 1, 4
test('Venue Staff add a supported layout while retaining an existing assignment', async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC02 Venue', ['Classroom'])
  await login(page, 'venue1')
  await openVenue(page, venue)

  await page.getByTestId('venue-detail-layouts-button').click()
  await saveLayouts(page, ['Classroom', 'Theatre'])
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom, Theatre')
  await page.reload()
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom, Theatre')
})

// @tc: TC-SCRUM-32-03
// @test: Removing a layout affects only the selected venue's assignment
// @story: SCRUM-32
// @ac: 2, 4
test("Removing a layout affects only the selected venue's assignment", async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC03 Venue', ['Classroom', 'Theatre'])
  const other = await createVenue('SCRUM-32 TC03 Other Venue', ['Theatre'])
  await login(page, 'venue1')
  await openVenue(page, venue)

  await page.getByTestId('venue-detail-layouts-button').click()
  await saveLayouts(page, ['Classroom'])
  await page.reload()
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom')
  await page.getByTestId('venue-detail-layouts-button').click()
  await expect(page.getByTestId('venue-detail-layouts-theatre-input')).not.toBeChecked()
  await openVenue(page, other)
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Theatre')
})

// @tc: TC-SCRUM-32-04
// @test: Venue Staff remove a venue's last supported layout
// @story: SCRUM-32
// @ac: 2, 4, 5
test("Venue Staff remove a venue's last supported layout", async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC04 Venue', ['Banquet'])
  await login(page, 'venue1')
  await openVenue(page, venue)

  await page.getByTestId('venue-detail-layouts-button').click()
  await saveLayouts(page, [])
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('None')
  await page.reload()
  await page.getByTestId('venue-detail-layouts-button').click()
  await expect(page.getByTestId('venue-detail-layouts-banquet-input')).not.toBeChecked()
})

// @tc: TC-SCRUM-32-05
// @test: An Event Coordinator sees saved supported layouts but is not offered an action to change them
// @story: SCRUM-32
// @ac: 4, 6
test('An Event Coordinator sees saved supported layouts but is not offered an action to change them', async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC05 Venue', ['Classroom', 'Theatre'])
  await login(page, 'coord1')
  await openVenue(page, venue)

  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom, Theatre')
  await expect(page.getByTestId('venue-detail-layouts-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-32-06
// @test: An account without Venue Staff permission is refused when attempting to save layout changes
// @story: SCRUM-32
// @ac: 6
test('An account without Venue Staff permission is refused when attempting to save layout changes', async ({ page, context }) => {
  const venue = await createVenue('SCRUM-32 TC06 Venue', ['Classroom'])
  await login(page, 'venue1')
  await openVenue(page, venue)
  await page.getByTestId('venue-detail-layouts-button').click()
  await page.getByTestId('venue-detail-layouts-theatre-input').check()

  const secondTab = await context.newPage()
  await secondTab.goto(`/venues/${venue.id}`)
  await expect(secondTab.getByTestId('layout-username')).toHaveText('venue1')
  await logout(secondTab)
  await login(secondTab, 'coord1')
  await secondTab.close()
  await page.getByTestId('venue-detail-layouts-save-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await page.reload()
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom')
})

// @tc: TC-SCRUM-32-07
// @test: An unrecognised layout is refused without changing existing assignments
// @story: SCRUM-32
// @ac: 3
test('An unrecognised layout is refused without changing existing assignments', async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC07 Venue', ['Classroom'])
  await login(page, 'venue1')
  await openVenue(page, venue)
  await page.getByTestId('venue-detail-layouts-button').click()
  await page.getByTestId('venue-detail-layouts-theatre-input').check()
  await page.route(`**/api/venues/${venue.id}/layouts`, async (route) => {
    const body = JSON.parse(route.request().postData())
    await route.continue({ postData: JSON.stringify({ ...body, layouts: [...body.layouts, 'Unsupported Test Layout'] }) })
  })
  await page.getByTestId('venue-detail-layouts-save-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await page.unroute(`**/api/venues/${venue.id}/layouts`)
  await page.reload()
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom')
})

// @tc: TC-SCRUM-32-08
// @test: A duplicate layout is refused without changing existing assignments
// @story: SCRUM-32
// @ac: 3
test('A duplicate layout is refused without changing existing assignments', async ({ page }) => {
  const venue = await createVenue('SCRUM-32 TC08 Venue', ['Classroom'])
  await login(page, 'venue1')
  await openVenue(page, venue)
  await page.getByTestId('venue-detail-layouts-button').click()
  await page.getByTestId('venue-detail-layouts-theatre-input').check()
  await page.route(`**/api/venues/${venue.id}/layouts`, async (route) => {
    const body = JSON.parse(route.request().postData())
    await route.continue({ postData: JSON.stringify({ ...body, layouts: [...body.layouts, 'Theatre'] }) })
  })
  await page.getByTestId('venue-detail-layouts-save-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await page.unroute(`**/api/venues/${venue.id}/layouts`)
  await page.reload()
  await expect(page.getByTestId('venue-detail-layouts-value')).toHaveText('Classroom')
})
