import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-40 Block a Venue for an Operational Reason.
// Seminar Room 1 (/venues/1) is seeded standing data. One SQLite file is shared
// by every spec in a run, and the rows here block the same venue, so "Seminar
// Room 1 has no blocks" cannot be relied on: each test asserts on the block it
// created by its id, and a refusal is proved by the venue's block ids being
// unchanged after a reload (docs/test-cases/AUTOMATION.md).

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

// Venues page → Seminar Room 1, waiting until its blocks have loaded.
async function openSeminarRoom1(page) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${SEMINAR_ROOM_1}`).getByRole('link', { name: 'Seminar Room 1' }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('Seminar Room 1')
}

// The ids of the blocks the venue's page lists, read from their row test ids.
async function listedBlockIds(page) {
  await expect(page.getByTestId('venue-detail-fields')).toBeVisible()
  const ids = await page
    .locator('[data-testid^="venue-detail-block-row-"]')
    .evaluateAll((rows) => rows.map((row) => row.dataset.testid.replace('venue-detail-block-row-', '')))
  return ids.sort()
}

async function fillBlock(page, { startDate, startTime, endDate, endTime, reason }) {
  await page.getByTestId('venue-detail-block-start-date-input').fill(startDate)
  await page.getByTestId('venue-detail-block-start-time-input').fill(startTime)
  await page.getByTestId('venue-detail-block-end-date-input').fill(endDate)
  await page.getByTestId('venue-detail-block-end-time-input').fill(endTime)
  await page.getByTestId('venue-detail-block-reason-input').fill(reason)
}

// Click Block and return the API's reply to the POST it sends.
async function submitBlock(page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/blocks') && r.request().method() === 'POST'),
    page.getByTestId('venue-detail-block-confirm-button').click(),
  ])
  return resp
}

// Rows 04–07: the API refuses the values, the banner shows its message, and
// after a reload the venue lists exactly the blocks it listed before.
async function expectRefused(page, values, message) {
  await login(page, 'venue1')
  await openSeminarRoom1(page)
  const before = await listedBlockIds(page)

  await page.getByTestId('venue-detail-block-button').click()
  await fillBlock(page, values)
  const resp = await submitBlock(page)

  expect(resp.status()).toBe(400)
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(message)

  await page.reload()
  expect(await listedBlockIds(page)).toEqual(before)
}

// @tc: TC-SCRUM-40-01
// @test: Venue Staff block a venue for a period with a reason and see it listed on the venue's page
// @story: SCRUM-40
// @ac: 1, 2
test("Venue Staff block a venue for a period with a reason and see it listed on the venue's page", async ({ page }) => {
  await login(page, 'venue1')
  await openSeminarRoom1(page)

  await page.getByTestId('venue-detail-block-button').click()
  await fillBlock(page, {
    startDate: '2026-10-20',
    startTime: '09:00',
    endDate: '2026-10-21',
    endTime: '18:00',
    reason: 'Projector replacement',
  })
  const resp = await submitBlock(page)
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue blocked')
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(
    '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00',
  )
  await expect(page.getByTestId(`venue-detail-block-reason-${id}`)).toHaveText('Projector replacement')

  await page.reload()
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(
    '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00',
  )
  await expect(page.getByTestId(`venue-detail-block-reason-${id}`)).toHaveText('Projector replacement')
})

// @tc: TC-SCRUM-40-02
// @test: An Event Coordinator sees the venue's blocks but is not offered the block action
// @story: SCRUM-40
// @ac: 2, 3
test("An Event Coordinator sees the venue's blocks but is not offered the block action", async ({ page }) => {
  const api = await apiAs('venue1')
  const created = await api.post(`/api/venues/${SEMINAR_ROOM_1}/blocks`, {
    data: {
      start_date: '2026-10-20',
      start_time: '09:00',
      end_date: '2026-10-21',
      end_time: '18:00',
      reason: 'Projector replacement',
    },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await api.dispose()

  await login(page, 'coord1')
  await openSeminarRoom1(page)

  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(
    '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00',
  )
  await expect(page.getByTestId(`venue-detail-block-reason-${id}`)).toHaveText('Projector replacement')
  await expect(page.getByTestId('venue-detail-block-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-40-03
// @test: Start, end and reason all left empty
// @story: SCRUM-40
// @ac: 1
test('Start, end and reason all left empty', async ({ page }) => {
  await login(page, 'venue1')
  await openSeminarRoom1(page)
  const before = await listedBlockIds(page)
  const sent = []
  page.on('request', (r) => {
    if (r.url().endsWith('/blocks') && r.method() === 'POST') sent.push(r)
  })

  await page.getByTestId('venue-detail-block-button').click()
  await page.getByTestId('venue-detail-block-confirm-button').click()

  await expect(page.getByTestId('venue-detail-block-start-date-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-block-start-time-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-block-end-date-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-block-end-time-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-block-reason-error')).toBeVisible()
  await expect(page.getByTestId('venue-detail-banner')).toHaveCount(0)
  expect(sent).toHaveLength(0)

  await page.reload()
  expect(await listedBlockIds(page)).toEqual(before)
})

// @tc: TC-SCRUM-40-04
// @test: A reason of spaces only is refused
// @story: SCRUM-40
// @ac: 1
test('A reason of spaces only is refused', async ({ page }) => {
  await expectRefused(
    page,
    { startDate: '2026-10-20', startTime: '09:00', endDate: '2026-10-20', endTime: '18:00', reason: '   ' },
    'Reason is required.',
  )
})

// @tc: TC-SCRUM-40-05
// @test: An end on an earlier date than the start is refused even when its time is later
// @story: SCRUM-40
// @ac: 1
test('An end on an earlier date than the start is refused even when its time is later', async ({ page }) => {
  await expectRefused(
    page,
    { startDate: '2026-10-21', startTime: '09:00', endDate: '2026-10-20', endTime: '18:00', reason: 'Renovation' },
    'End must be after the start.',
  )
})

// @tc: TC-SCRUM-40-06
// @test: End one minute before the start is refused
// @story: SCRUM-40
// @ac: 1
test('End one minute before the start is refused', async ({ page }) => {
  await expectRefused(
    page,
    { startDate: '2026-10-20', startTime: '10:00', endDate: '2026-10-20', endTime: '09:59', reason: 'Deep clean' },
    'End must be after the start.',
  )
})

// @tc: TC-SCRUM-40-07
// @test: End equal to the start is refused
// @story: SCRUM-40
// @ac: 1
test('End equal to the start is refused', async ({ page }) => {
  await expectRefused(
    page,
    { startDate: '2026-10-20', startTime: '10:00', endDate: '2026-10-20', endTime: '10:00', reason: 'Deep clean' },
    'End must be after the start.',
  )
})

// @tc: TC-SCRUM-40-08
// @test: End one minute after the start is accepted
// @story: SCRUM-40
// @ac: 1, 2
test('End one minute after the start is accepted', async ({ page }) => {
  await login(page, 'venue1')
  await openSeminarRoom1(page)

  await page.getByTestId('venue-detail-block-button').click()
  await fillBlock(page, {
    startDate: '2026-10-20',
    startTime: '10:00',
    endDate: '2026-10-20',
    endTime: '10:01',
    reason: 'Deep clean',
  })
  const resp = await submitBlock(page)
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue blocked')
  // ui-guidelines.md §9: both ends in full, so the row's "20 Oct 2026, 10:00
  // to 10:01" shows with the date repeated.
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(
    '20 Oct 2026, 10:00 to 20 Oct 2026, 10:01',
  )
  await expect(page.getByTestId(`venue-detail-block-reason-${id}`)).toHaveText('Deep clean')
})
