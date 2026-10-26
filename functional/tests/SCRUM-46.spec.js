import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// SCRUM-46 View Event Information During Planning. TC-SCRUM-46-01 through 13
// (test-case sheet), one test per row in the row's order.
//
// The events each row opens are staged by fixtures/scrum46.py, named
// "SCRUM-46 TCnn ..." and owned by org1: a Completed event cannot be reached
// through the app (its end time must have passed) and no screen sets a
// coordinator's notes, so the rows start from staged events, as SCRUM-50 and
// SCRUM-66 do. The Organiser's
// Requests page lists a staged event by its name.

const BASE_URL = 'http://localhost:5173'
const fixtureScript = fileURLToPath(new URL('../fixtures/scrum46.py', import.meta.url))

test.beforeAll(() => execFileSync('python', [fixtureScript], { encoding: 'utf8' }))
test.afterAll(() => execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' }))

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function openEvent(page, name) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByRole('link', { name, exact: true }).click()
  await expect(page.getByTestId('request-detail-fields')).toContainText(name)
}

async function organiserOpens(page, name) {
  await login(page, 'org1')
  await openEvent(page, name)
}

// The id of an event org1 owns, read through the API, for the row that opens it by address.
async function idOf(name) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const logged = await api.post('/api/login', { data: { username: 'org1', password: 'Passw0rd!' } })
  expect(logged.ok()).toBeTruthy()
  const rows = await (await api.get('/api/requests')).json()
  await api.dispose()
  const found = rows.find((row) => row.name === name)
  expect(found, `staged event ${name}`).toBeTruthy()
  return found.id
}

const bookingVenues = (page) => page.getByTestId(/^request-detail-arrangement-booking-venue-/)
const equipmentRows = (page) => page.getByTestId(/^request-detail-arrangement-equipment-type-/)

// @tc: TC-SCRUM-46-01
// @test: the Organiser sees the status, details and assigned coordinator of their own event
// @story: SCRUM-46
// @ac: 1, 3
test('the Organiser sees the status, details and assigned coordinator of their own event', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC01 Assigned Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-attendance')).toHaveText('40')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toBeVisible()
  await expect(bookingVenues(page)).toHaveCount(0)
})

// @tc: TC-SCRUM-46-02
// @test: an event with no assigned coordinator says so
// @story: SCRUM-46
// @ac: 1
test('an event with no assigned coordinator says so', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC02 Unassigned Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-no-coordinator')).toHaveText('No coordinator assigned yet.')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-03
// @test: a Confirmed event lists its Approved venue booking and Approved equipment requirement
// @story: SCRUM-46
// @ac: 2
test('a Confirmed event lists its Approved venue booking and Approved equipment requirement', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC03 Confirmed Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  await expect(bookingVenues(page)).toHaveText(['Seminar Room 1'])
  await expect(page.getByTestId(/^request-detail-arrangement-booking-location-/)).toHaveText(['Block A Level 2'])
  await expect(page.getByTestId(/^request-detail-arrangement-booking-period-/)).toHaveText(['12 Mar 2027, 10:00–12:00'])
  await expect(equipmentRows(page)).toHaveText(['Projector'])
  await expect(page.getByTestId(/^request-detail-arrangement-equipment-quantity-/)).toHaveText(['2'])
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-04
// @test: a Completed event still lists its Approved arrangements
// @story: SCRUM-46
// @ac: 2
test('a Completed event still lists its Approved arrangements', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC04 Completed Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Completed')
  await expect(bookingVenues(page)).toHaveText(['Seminar Room 1'])
  await expect(equipmentRows(page)).toHaveText(['Projector'])
  await expect(page.getByTestId(/^request-detail-arrangement-equipment-quantity-/)).toHaveText(['2'])
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-05
// @test: every Approved venue booking is listed when an event has more than one
// @story: SCRUM-46
// @ac: 2
test('every Approved venue booking is listed when an event has more than one', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC05 Two Venue Gala')

  await expect(bookingVenues(page)).toHaveText(['Seminar Room 1', 'Auditorium'])
  await expect(page.getByTestId(/^request-detail-arrangement-booking-location-/)).toHaveText([
    'Block A Level 2',
    'Block C Level 1',
  ])
  await expect(page.getByTestId(/^request-detail-arrangement-booking-period-/)).toHaveText([
    '12 Mar 2027, 10:00–12:00',
    '12 Mar 2027, 10:00–12:00',
  ])
})

// @tc: TC-SCRUM-46-06
// @test: a Planning event shows arrangements in progress and lists none, though some are Approved
// @story: SCRUM-46
// @ac: 3
test('a Planning event shows arrangements in progress and lists none, though some are Approved', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC06 Planning Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveText('Arrangements are in progress.')
  await expect(bookingVenues(page)).toHaveCount(0)
  await expect(equipmentRows(page)).toHaveCount(0)
})

// @tc: TC-SCRUM-46-07
// @test: a Safety Check event, the last status before Confirmed, still lists no arrangements
// @story: SCRUM-46
// @ac: 3
test('a Safety Check event, the last status before Confirmed, still lists no arrangements', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC07 Safety Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Safety Check')
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveText('Arrangements are in progress.')
  await expect(bookingVenues(page)).toHaveCount(0)
  await expect(equipmentRows(page)).toHaveCount(0)
})

// @tc: TC-SCRUM-46-08
// @test: an event that goes back from Confirmed to Planning stops showing its arrangements
// @story: SCRUM-46
// @ac: 3
test('an event that goes back from Confirmed to Planning stops showing its arrangements', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC08 Returned Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveText('Arrangements are in progress.')
  await expect(bookingVenues(page)).toHaveCount(0)
})

// @tc: TC-SCRUM-46-09
// @test: a Draft event lists no arrangements
// @story: SCRUM-46
// @ac: 4
test('a Draft event lists no arrangements', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC09 Draft Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')
  await expect(page.getByTestId('request-detail-arrangements')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-10
// @test: a Cancelled event lists no arrangements, though it once had an Approved booking
// @story: SCRUM-46
// @ac: 4
test('a Cancelled event lists no arrangements, though it once had an Approved booking', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC10 Cancelled Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Cancelled')
  await expect(page.getByTestId('request-detail-arrangements')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveCount(0)
  await expect(page.getByText('Seminar Room 1')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-11
// @test: booking requests that are not Approved, and venue holds, are not shown to the Organiser
// @story: SCRUM-46
// @ac: 5
test('booking requests that are not Approved, and venue holds, are not shown to the Organiser', async ({ page }) => {
  await organiserOpens(page, 'SCRUM-46 TC11 Internal Gala')

  await expect(bookingVenues(page)).toHaveText(['Seminar Room 1'])
  await expect(page.getByText('The Auditorium is closed that day')).toHaveCount(0)
  await expect(page.getByText('Auditorium', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('request-detail-bookings')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-holds')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-12
// @test: the Safety Officer's decision and notes and the coordinator's notes are not shown to the Organiser
// @story: SCRUM-46
// @ac: 5
test("the Safety Officer's decision and notes and the coordinator's notes are not shown to the Organiser", async ({
  page,
}) => {
  await organiserOpens(page, 'SCRUM-46 TC12 Notes Gala')

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-arrangements-in-progress')).toHaveText('Arrangements are in progress.')
  await expect(page.getByTestId('request-detail-safety-decisions')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-requested-changes')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-coordinator-notes')).toHaveCount(0)
  await expect(page.getByText('Add a second exit')).toHaveCount(0)
  await expect(page.getByText('Call the venue manager')).toHaveCount(0)
})

// @tc: TC-SCRUM-46-13
// @test: another Organiser cannot open the event or see its arrangements
// @story: SCRUM-46
// @ac: 6
test('another Organiser cannot open the event or see its arrangements', async ({ page }) => {
  const id = await idOf('SCRUM-46 TC13 Confirmed Gala')
  await login(page, 'org2')

  await page.goto(`/requests/${id}`)

  await expect(page.getByTestId('request-detail-banner')).toHaveText(/permission/i)
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-arrangements')).toHaveCount(0)
  await expect(page.getByText('Seminar Room 1')).toHaveCount(0)
})
