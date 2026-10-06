import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-79 End or Remove a Venue Block.
// Seminar Room 1 (/venues/1) is seeded standing data. One SQLite file is shared
// by every spec in a run, so each test creates its own blocks through the API
// as venue1 (SCRUM-40 allows a period in the past) and asserts on them by id
// (docs/test-cases/AUTOMATION.md).
//
// A block's phase is the API's, from the current Singapore time (UTC+8), so
// every time here is relative to when the test runs and computed in UTC+8
// explicitly, never in the machine's own zone: the moment is shifted by eight
// hours and read through its UTC fields. Each date is taken from the computed
// moment, so a run near midnight still gets the right day.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const HOUR = 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n) => String(n).padStart(2, '0')

// A moment in Singapore time, as { date: 'YYYY-MM-DD', time: 'HH:MM' }.
function at(moment) {
  return {
    date: `${moment.getUTCFullYear()}-${pad(moment.getUTCMonth() + 1)}-${pad(moment.getUTCDate())}`,
    time: `${pad(moment.getUTCHours())}:${pad(moment.getUTCMinutes())}`,
  }
}

// Now in Singapore, shifted by `offset` milliseconds.
const fromNow = (offset) => at(new Date(Date.now() + 8 * HOUR + offset))

// `days` from today in Singapore, at `time`.
function day(days, time) {
  const moment = new Date(Date.now() + 8 * HOUR)
  moment.setUTCDate(moment.getUTCDate() + days)
  return { date: at(moment).date, time }
}

// ui-guidelines.md §9: '20 Oct 2026, 09:00'.
function shown({ date, time }) {
  const [year, month, dayOfMonth] = date.split('-')
  return `${dayOfMonth} ${MONTHS[Number(month) - 1]} ${year}, ${time}`
}

const period = (start, end) => `${shown(start)} to ${shown(end)}`

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

// Block Seminar Room 1 through the API as venue1 and return the block's id.
async function createBlock(start, end, reason) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const loggedIn = await api.post('/api/login', { data: { username: 'venue1', password: 'Passw0rd!' } })
  expect(loggedIn.ok()).toBeTruthy()
  const created = await api.post(`/api/venues/${SEMINAR_ROOM_1}/blocks`, {
    data: { start_date: start.date, start_time: start.time, end_date: end.date, end_time: end.time, reason },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await api.dispose()
  return id
}

// Venues page → Seminar Room 1, waiting until its blocks have loaded.
async function openSeminarRoom1(page) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${SEMINAR_ROOM_1}`).getByRole('link', { name: 'Seminar Room 1' }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText('Seminar Room 1')
  await expect(page.getByTestId('venue-detail-fields')).toBeVisible()
}

// End early on the block, enter the new end, click End; returns the API's reply.
async function endEarly(page, id, newEnd) {
  await page.getByTestId(`venue-detail-block-end-button-${id}`).click()
  await page.getByTestId('venue-detail-end-block-end-date-input').fill(newEnd.date)
  await page.getByTestId('venue-detail-end-block-end-time-input').fill(newEnd.time)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/blocks/${id}`) && r.request().method() === 'PATCH'),
    page.getByTestId('venue-detail-end-block-confirm-button').click(),
  ])
  return resp
}

// The block in progress of rows 02 and 05–08: from 2 hours ago to tomorrow 18:00.
async function blockInProgress(reason = 'Lift repair') {
  const start = fromNow(-2 * HOUR)
  const end = day(1, '18:00')
  return { id: await createBlock(start, end, reason), start, end }
}

// Rows 05, 07 and 08: the new end is refused, the banner shows the API's
// message, and after a reload the block still ends tomorrow at 18:00.
async function expectEndRefused(page, newEnd, message) {
  const { id, start, end } = await blockInProgress()
  await login(page, 'venue1')
  await openSeminarRoom1(page)

  const resp = await endEarly(page, id, newEnd)

  expect(resp.status()).toBe(400)
  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText(message)

  await page.reload()
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(period(start, end))
}

// @tc: TC-SCRUM-79-01
// @test: Venue Staff remove a block that has not started and it is no longer listed
// @story: SCRUM-79
// @ac: 1, 4
test('Venue Staff remove a block that has not started and it is no longer listed', async ({ page }) => {
  const id = await createBlock(day(1, '09:00'), day(1, '18:00'), 'Deep clean')
  await login(page, 'venue1')
  await openSeminarRoom1(page)
  await expect(page.getByTestId(`venue-detail-block-row-${id}`)).toBeVisible()

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/blocks/${id}`) && r.request().method() === 'DELETE'),
    page.getByTestId(`venue-detail-block-remove-button-${id}`).click(),
  ])
  expect(resp.status()).toBe(204)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Block removed')
  await expect(page.getByTestId(`venue-detail-block-row-${id}`)).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('venue-detail-fields')).toBeVisible()
  await expect(page.getByTestId(`venue-detail-block-row-${id}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-79-02
// @test: Venue Staff end a block in progress early and the page shows its new end
// @story: SCRUM-79
// @ac: 2, 4
test('Venue Staff end a block in progress early and the page shows its new end', async ({ page }) => {
  const { id, start } = await blockInProgress()
  const newEnd = fromNow(HOUR)
  await login(page, 'venue1')
  await openSeminarRoom1(page)

  const resp = await endEarly(page, id, newEnd)
  expect(resp.status()).toBe(200)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Block ended')
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(period(start, newEnd))

  await page.reload()
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(period(start, newEnd))
  await expect(page.getByTestId(`venue-detail-block-reason-${id}`)).toHaveText('Lift repair')
})

// @tc: TC-SCRUM-79-03
// @test: Each block offers only the action its timing allows
// @story: SCRUM-79
// @ac: 1, 2
test('Each block offers only the action its timing allows', async ({ page }) => {
  const upcoming = await createBlock(day(1, '09:00'), day(1, '18:00'), 'Deep clean')
  const { id: inProgress } = await blockInProgress()
  await login(page, 'venue1')

  await openSeminarRoom1(page)

  await expect(page.getByTestId(`venue-detail-block-remove-button-${upcoming}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-block-end-button-${upcoming}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-block-end-button-${inProgress}`)).toBeVisible()
  await expect(page.getByTestId(`venue-detail-block-remove-button-${inProgress}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-79-04
// @test: A block that has already ended offers neither action
// @story: SCRUM-79
// @ac: 3
test('A block that has already ended offers neither action', async ({ page }) => {
  const start = day(-1, '09:00')
  const end = day(-1, '18:00')
  const id = await createBlock(start, end, 'Inspection')
  await login(page, 'venue1')

  await openSeminarRoom1(page)

  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(period(start, end))
  await expect(page.getByTestId(`venue-detail-block-remove-button-${id}`)).toHaveCount(0)
  await expect(page.getByTestId(`venue-detail-block-end-button-${id}`)).toHaveCount(0)
})

// @tc: TC-SCRUM-79-05
// @test: A new end earlier than the current time is refused
// @story: SCRUM-79
// @ac: 3
test('A new end earlier than the current time is refused', async ({ page }) => {
  await expectEndRefused(page, fromNow(-HOUR), 'New end cannot be earlier than the current time.')
})

// @tc: TC-SCRUM-79-06
// @test: A new end one minute before the original end is accepted
// @story: SCRUM-79
// @ac: 3
test('A new end one minute before the original end is accepted', async ({ page }) => {
  const { id, start } = await blockInProgress()
  const newEnd = day(1, '17:59')
  await login(page, 'venue1')
  await openSeminarRoom1(page)

  const resp = await endEarly(page, id, newEnd)
  expect(resp.status()).toBe(200)

  await expect(page.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Block ended')
  await expect(page.getByTestId(`venue-detail-block-period-${id}`)).toHaveText(period(start, newEnd))
})

// @tc: TC-SCRUM-79-07
// @test: A new end equal to the original end is refused
// @story: SCRUM-79
// @ac: 3
test('A new end equal to the original end is refused', async ({ page }) => {
  await expectEndRefused(page, day(1, '18:00'), "New end must be before the block's current end.")
})

// @tc: TC-SCRUM-79-08
// @test: A new end one minute after the original end is refused
// @story: SCRUM-79
// @ac: 3
test('A new end one minute after the original end is refused', async ({ page }) => {
  await expectEndRefused(page, day(1, '18:01'), "New end must be before the block's current end.")
})

// @tc: TC-SCRUM-79-09
// @test: An Event Coordinator sees blocks but is offered neither action
// @story: SCRUM-79
// @ac: 5
test('An Event Coordinator sees blocks but is offered neither action', async ({ page }) => {
  const upcoming = await createBlock(day(1, '09:00'), day(1, '18:00'), 'Deep clean')
  const { id: inProgress } = await blockInProgress()
  await login(page, 'coord1')

  await openSeminarRoom1(page)

  for (const id of [upcoming, inProgress]) {
    await expect(page.getByTestId(`venue-detail-block-row-${id}`)).toBeVisible()
    await expect(page.getByTestId(`venue-detail-block-remove-button-${id}`)).toHaveCount(0)
    await expect(page.getByTestId(`venue-detail-block-end-button-${id}`)).toHaveCount(0)
  }
})
