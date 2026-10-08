import { test, expect, request as playwrightRequest } from '@playwright/test'

// SCRUM-36 Request Venue Booking. No curated test-case sheet rows exist for
// this story (built directly from the Jira ACs); @tc is omitted rather than
// invented. Seeded Seminar Room 1 (/venues/1) and Auditorium (/venues/2) are
// read and booked against, never retired or renamed. Every event a test
// books against it creates itself through the API, under its own name, and
// approves before the UI step under test (AUTOMATION.md).
//
// AC10 (a retired venue cannot be booked) is not covered here: no story has
// built a way to retire a venue yet (SCRUM-76), so the precondition cannot be
// reached through the running app. It is proven at the API in
// backend/tests/test_bookings.py (test_a_retired_venue_cannot_be_booked).

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function logout(page) {
  await page.getByTestId('layout-logout-button').click()
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Mirrors app/format.js's formatPeriod, so the test can assert on the exact
// text the page shows for the event's own (dynamic, 30-days-ahead) date.
function expectedPeriod(iso, start, end) {
  const [year, month, day] = iso.split('-')
  return `${day} ${MONTHS[Number(month) - 1]} ${year}, ${start}–${end}`
}

// Submits as org1 and approves as coord1, so the event is ready to be booked
// against (AC2: Approved or Planning).
async function approvedEvent(name, overrides = {}) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-36',
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 80,
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
      ...overrides,
    },
  })
  expect(submitted.status()).toBe(201)
  const { id } = await submitted.json()
  await organiser.dispose()

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await coordinator.dispose()

  return id
}

async function submittedEvent(name) {
  const organiser = await apiAs('org1')
  const resp = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-36',
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 80,
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
    },
  })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await organiser.dispose()
  return id
}

async function openRequest(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

async function openVenue(page, venueId, name) {
  await page.getByTestId('layout-nav-venues').click()
  await page.getByTestId(`venues-row-${venueId}`).getByRole('link', { name }).click()
  await expect(page.getByTestId('venue-detail-name')).toHaveText(name)
}

// @test: coordinator raises a booking request for an Approved event, carrying its own fields
// @story: SCRUM-36
// @ac: 1, 3, 11
test('coordinator raises a booking request for an Approved event, carrying its own fields', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-36 Happy Path Event')
  await login(page, 'coord1')
  await openRequest(page, eventId)

  await page.getByTestId('request-detail-raise-booking-button').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}/bookings/new$`))

  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()

  await expect(page).toHaveURL('/venues/1')
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue booking requested')

  const row = page.locator('[data-testid^="venue-detail-booking-row-"]', {
    has: page.getByText('SCRUM-36 Happy Path Event'),
  })
  await expect(row).toBeVisible()
  await expect(row.getByText('Requested')).toBeVisible()
  // AC3: the booking carries the event's own date and times, not re-entered.
  await expect(row).toContainText(expectedPeriod(futureDate(), '10:00', '12:00'))
})

// @test: the Request venue booking action is not offered for a Submitted event
// @story: SCRUM-36
// @ac: 2
test('the Request venue booking action is not offered for a Submitted event', async ({ page }) => {
  const eventId = await submittedEvent('SCRUM-36 Submitted Event')
  await login(page, 'coord1')
  await openRequest(page, eventId)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-raise-booking-button')).toHaveCount(0)
})

// @test: raising directly against a Submitted event is refused
// @story: SCRUM-36
// @ac: 2
test('raising directly against a Submitted event is refused', async ({ page }) => {
  // The button is hidden (previous test), but the API still refuses a direct
  // attempt (ui-guidelines.md: "the page still shows a refusal if the API says no").
  const eventId = await submittedEvent('SCRUM-36 Direct Attempt Event')
  await login(page, 'coord1')
  await page.goto(`/requests/${eventId}/bookings/new`)

  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()

  await expect(page.getByTestId('booking-new-banner')).toHaveText(
    'A venue booking can be requested only for an Approved or Planning event.',
  )
})

// @test: venue staff and the coordinator both see the request awaiting a decision
// @story: SCRUM-36
// @ac: 4, 5
test('venue staff and the coordinator both see the request awaiting a decision', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-36 Visibility Event')
  const coordinator = await apiAs('coord1')
  const raised = await coordinator.post(`/api/requests/${eventId}/bookings`, {
    data: { venue_id: AUDITORIUM },
  })
  expect(raised.status()).toBe(201)
  await coordinator.dispose()

  await login(page, 'venue1')
  await openVenue(page, AUDITORIUM, 'Auditorium')
  const venueStaffRow = page.locator('[data-testid^="venue-detail-booking-row-"]', {
    has: page.getByText('SCRUM-36 Visibility Event'),
  })
  await expect(venueStaffRow.getByText('Requested')).toBeVisible()

  await logout(page)
  await login(page, 'coord1')
  await openVenue(page, AUDITORIUM, 'Auditorium')
  const coordinatorRow = page.locator('[data-testid^="venue-detail-booking-row-"]', {
    has: page.getByText('SCRUM-36 Visibility Event'),
  })
  await expect(coordinatorRow.getByText('Requested')).toBeVisible()
})

// @test: raising a request for one event does not block another event booking the same venue
// @story: SCRUM-36
// @ac: 6
test('raising a request for one event does not block another event booking the same venue', async ({ page }) => {
  const firstEventId = await approvedEvent('SCRUM-36 First Event')
  const secondEventId = await approvedEvent('SCRUM-36 Second Event')
  await login(page, 'coord1')

  await openRequest(page, firstEventId)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue booking requested')

  await openRequest(page, secondEventId)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()

  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue booking requested')
  await expect(
    page.locator('[data-testid^="venue-detail-booking-row-"]', {
      has: page.getByText('SCRUM-36 First Event'),
    }),
  ).toBeVisible()
  await expect(
    page.locator('[data-testid^="venue-detail-booking-row-"]', {
      has: page.getByText('SCRUM-36 Second Event'),
    }),
  ).toBeVisible()
})

// @test: one event can have booking requests for several venues at the same time
// @story: SCRUM-36
// @ac: 7
test('one event can have booking requests for several venues at the same time', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-36 Multi Venue Event')
  await login(page, 'coord1')

  await openRequest(page, eventId)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()
  await expect(page).toHaveURL('/venues/1')

  await openRequest(page, eventId)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Auditorium' })
  await page.getByTestId('booking-new-raise-button').click()
  await expect(page).toHaveURL('/venues/2')

  await expect(
    page.locator('[data-testid^="venue-detail-booking-row-"]', {
      has: page.getByText('SCRUM-36 Multi Venue Event'),
    }),
  ).toBeVisible()
})

// @test: a second request for the same venue and event already awaiting a decision is refused
// @story: SCRUM-36
// @ac: 9
test('a second request for the same venue and event already awaiting a decision is refused', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-36 Duplicate Event')
  await login(page, 'coord1')

  await openRequest(page, eventId)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue booking requested')

  await openRequest(page, eventId)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await page.getByTestId('booking-new-venue-input').selectOption({ label: 'Seminar Room 1' })
  await page.getByTestId('booking-new-raise-button').click()

  await expect(page.getByTestId('booking-new-banner')).toHaveText(
    'A booking request for this venue and event is already awaiting a decision.',
  )
})
