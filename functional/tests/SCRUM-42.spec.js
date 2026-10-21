import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-42 Warn When a Requested Venue Appears Unsuitable. Curated rows:
// team test sheet, TC-SCRUM-42-01 to 13. Seeded Seminar Room 1 (/venues/1:
// capacity 60, 08:00 to 20:00; Projector, Whiteboard, Wi-Fi; Step-free
// access, Lift access) and Auditorium (/venues/2) are read and booked
// against; TC-05 gives Auditorium a layout and puts it back afterwards.
// Every event a row needs it creates itself through the API, under its own
// name, submitted by org1 and approved by coord1 before the steps
// (AUTOMATION.md).
//
// A row that expects no warning waits for the check's reply before asserting
// that nothing is shown; otherwise the assertion could pass before the check
// has answered.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2
const DATE = '2026-12-10'

const TEXT_FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-42',
  equipment_requirements: 'As chosen',
  registration_needs: 'Guest list supplied',
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

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

// org1 submits the event and coord1 approves it, so a venue booking can be
// requested for it (SCRUM-36: Approved or Planning).
async function approvedEvent(name, fields) {
  const organiser = await apiAs('org1')
  const submitted = await organiser.post('/api/requests', {
    data: { name, date: DATE, ...TEXT_FIELDS, ...fields },
  })
  expect(submitted.status()).toBe(201)
  const { id } = await submitted.json()
  await organiser.dispose()

  await assignAsLead(id) // SCRUM-87: only the assigned coordinator decides

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await coordinator.dispose()
  return id
}

async function setAuditoriumLayouts(layouts) {
  const staff = await apiAs('venue1')
  const resp = await staff.patch(`/api/venues/${AUDITORIUM}/layouts`, { data: { layouts } })
  expect(resp.status()).toBe(200)
  await staff.dispose()
}

// As coord1: open the event's page and Request venue booking.
async function startBooking(page, eventId) {
  await login(page, 'coord1')
  await page.goto(`/requests/${eventId}`)
  await page.getByTestId('request-detail-raise-booking-button').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}/bookings/new$`))
}

// Choose a venue and wait for its check to answer.
async function chooseVenue(page, venueId, label) {
  await Promise.all([
    page.waitForResponse((resp) => resp.url().endsWith(`/venues/${venueId}/warnings`) && resp.ok()),
    page.getByTestId('booking-new-venue-input').selectOption({ label }),
  ])
}

function allWarnings(page) {
  return page.locator('[data-testid^="booking-new-warning-"]')
}

async function fillRequest(page, values) {
  for (const [field, value] of Object.entries(values)) {
    await page.getByTestId(`request-new-${field.replaceAll('_', '-')}-input`).fill(String(value))
  }
}

// @tc: TC-SCRUM-42-01
// @test: An Event Organiser chooses a required layout, facilities and accessibility features when creating a request
// @story: SCRUM-42
// @ac: 1
test('An Event Organiser chooses a required layout, facilities and accessibility features when creating a request', async ({
  page,
}) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillRequest(page, {
    name: 'TC42 Choices',
    date: DATE,
    start_time: '10:00',
    end_time: '16:00',
    attendance: 100,
    ...TEXT_FIELDS,
  })
  // The choices replace the free-text venue requirements and accessibility needs.
  await expect(page.getByTestId('request-new-venue-requirements-input')).toHaveCount(0)
  await expect(page.getByTestId('request-new-accessibility-needs-input')).toHaveCount(0)
  await page.getByTestId('request-new-layout-input').selectOption({ label: 'Theatre' })
  await page.getByTestId('request-new-facilities-projector-input').check()
  await page.getByTestId('request-new-facilities-sound-system-input').check()
  await page.getByTestId('request-new-accessibility-features-hearing-loop-input').check()
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Request submitted')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-layout')).toHaveText('Theatre')
  await expect(page.getByTestId('request-detail-facilities')).toHaveText('Projector, Sound system')
  await expect(page.getByTestId('request-detail-accessibility-features')).toHaveText('Hearing loop')
  await expect(page.getByTestId('request-detail-venue-requirements')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-accessibility-needs')).toHaveCount(0)
})

// @tc: TC-SCRUM-42-02
// @test: An Event Organiser changes the chosen requirements while editing their own Draft
// @story: SCRUM-42
// @ac: 1
test('An Event Organiser changes the chosen requirements while editing their own Draft', async ({ page }) => {
  // An Organiser may have only one open Draft: clear any org1 still has
  // (the seed's, when this spec runs alone) before saving TC42 Draft.
  const organiser = await apiAs('org1')
  const own = await (await organiser.get('/api/requests')).json()
  for (const draft of own.filter((row) => row.status === 'Draft')) {
    expect((await organiser.delete(`/api/requests/${draft.id}`)).status()).toBe(204)
  }
  const saved = await organiser.post('/api/requests/draft', {
    data: { name: 'TC42 Draft', facilities: ['Projector'] },
  })
  expect(saved.status()).toBe(201)
  const { id } = await saved.json()

  try {
    await login(page, 'org1')
    await page.goto(`/requests/${id}`)
    await expect(page.getByTestId('request-detail-facilities')).toHaveText('Projector')
    await page.getByTestId('request-detail-edit-button').click()
    await page.getByTestId('request-detail-edit-facilities-projector-input').uncheck()
    await page.getByTestId('request-detail-edit-facilities-whiteboard-input').check()
    await page.getByTestId('request-detail-edit-accessibility-features-step-free-access-input').check()
    await page.getByTestId('request-detail-edit-confirm-button').click()

    await expect(page.getByTestId('request-detail-banner')).toHaveText('Draft updated')
    await expect(page.getByTestId('request-detail-facilities')).toHaveText('Whiteboard')
    await expect(page.getByTestId('request-detail-facilities')).not.toContainText('Projector')
    await expect(page.getByTestId('request-detail-accessibility-features')).toHaveText('Step-free access')
    await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')
  } finally {
    await organiser.delete(`/api/requests/${id}`)
    await organiser.dispose()
  }
})

// @tc: TC-SCRUM-42-03
// @test: A request with no layout, facility or accessibility feature chosen can be submitted
// @story: SCRUM-42
// @ac: 1
test('A request with no layout, facility or accessibility feature chosen can be submitted', async ({ page }) => {
  await login(page, 'org1')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await fillRequest(page, {
    name: 'TC42 None Chosen',
    date: DATE,
    start_time: '10:00',
    end_time: '12:00',
    attendance: 20,
    ...TEXT_FIELDS,
  })
  await page.getByTestId('request-new-submit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Request submitted')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-layout')).toHaveText('None')
  await expect(page.getByTestId('request-detail-facilities')).toHaveText('None')
  await expect(page.getByTestId('request-detail-accessibility-features')).toHaveText('None')
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
})

// @tc: TC-SCRUM-42-04
// @test: Choosing a venue that misses several requirements shows a warning for each mismatch
// @story: SCRUM-42
// @ac: 2, 3
test('Choosing a venue that misses several requirements shows a warning for each mismatch', async ({ page }) => {
  const eventId = await approvedEvent('TC42 Mismatch', {
    start_time: '07:59',
    end_time: '12:00',
    attendance: 100,
    facilities: ['Projector', 'Sound system'],
    accessibility_features: ['Hearing loop'],
  })
  await startBooking(page, eventId)

  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId('booking-new-warning-capacity')).toHaveText(
    "Expected attendance 100 is above the venue's maximum capacity of 60.",
  )
  await expect(page.getByTestId('booking-new-warning-start-time')).toHaveText(
    "Start time 07:59 is outside the venue's operating hours, 08:00 to 20:00.",
  )
  await expect(page.getByTestId('booking-new-warning-facility-sound-system')).toContainText('Sound system')
  await expect(page.getByTestId('booking-new-warning-accessibility-feature-hearing-loop')).toContainText(
    'Hearing loop',
  )
  await expect(page.getByTestId('booking-new-warning-facility-projector')).toHaveCount(0)
  await expect(page.getByTestId('booking-new-warnings')).not.toContainText('Projector')
  await expect(allWarnings(page)).toHaveCount(4)
})

// @tc: TC-SCRUM-42-05
// @test: A required layout the venue does not record is named in a warning
// @story: SCRUM-42
// @ac: 2, 3
test('A required layout the venue does not record is named in a warning', async ({ page }) => {
  await setAuditoriumLayouts(['Banquet'])
  try {
    const eventId = await approvedEvent('TC42 Layout', {
      start_time: '10:00',
      end_time: '12:00',
      attendance: 100,
      layout: 'Theatre',
    })
    await startBooking(page, eventId)

    await chooseVenue(page, AUDITORIUM, 'Auditorium')

    await expect(page.getByTestId('booking-new-warning-layout-theatre')).toHaveText(
      'The venue does not record the Theatre layout.',
    )
    await expect(allWarnings(page)).toHaveCount(1)
  } finally {
    // Auditorium is standing data: put its layouts back even if a step failed.
    await setAuditoriumLayouts([])
  }
})

// @tc: TC-SCRUM-42-06
// @test: A venue with no mismatches shows no warning, and choosing it clears the warnings shown for an earlier choice
// @story: SCRUM-42
// @ac: 4
test('A venue with no mismatches shows no warning, and choosing it clears the warnings shown for an earlier choice', async ({
  page,
}) => {
  const eventId = await approvedEvent('TC42 Fits', {
    start_time: '10:00',
    end_time: '16:00',
    attendance: 100,
    facilities: ['Projector', 'Sound system'],
    accessibility_features: ['Hearing loop'],
  })
  await startBooking(page, eventId)

  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await expect(page.getByTestId('booking-new-warnings')).toBeVisible()
  await chooseVenue(page, AUDITORIUM, 'Auditorium')

  await expect(page.getByTestId('booking-new-warnings')).toHaveCount(0)
  await expect(allWarnings(page)).toHaveCount(0)
})

// @tc: TC-SCRUM-42-07
// @test: A requirement the event did not choose is not checked
// @story: SCRUM-42
// @ac: 4
test('A requirement the event did not choose is not checked', async ({ page }) => {
  const eventId = await approvedEvent('TC42 Nothing Chosen', {
    start_time: '10:00',
    end_time: '12:00',
    attendance: 20,
  })
  await startBooking(page, eventId)

  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId('booking-new-warnings')).toHaveCount(0)
})

// @tc: TC-SCRUM-42-08
// @test: A venue that records no operating hours is not checked against the event's times
// @story: SCRUM-42
// @ac: 4
test("A venue that records no operating hours is not checked against the event's times", async ({ page }) => {
  const staff = await apiAs('venue1')
  const created = await staff.post('/api/venues', {
    data: { name: 'TC42 Hall', location: 'Block D Level 1', max_capacity: 200 },
  })
  expect(created.status()).toBe(201)
  const hall = await created.json()
  expect(hall.opening_time).toBeNull()
  expect(hall.closing_time).toBeNull()
  await staff.dispose()
  const eventId = await approvedEvent('TC42 Late', {
    start_time: '06:00',
    end_time: '23:30',
    attendance: 50,
  })
  await startBooking(page, eventId)

  await Promise.all([
    page.waitForResponse((resp) => resp.url().endsWith(`/venues/${hall.id}/warnings`) && resp.ok()),
    page.getByTestId('booking-new-venue-input').selectOption(String(hall.id)),
  ])

  await expect(page.getByTestId('booking-new-warnings')).toHaveCount(0)
})

// @tc: TC-SCRUM-42-09
// @test: Attendance equal to the maximum capacity, and times exactly at opening and closing, give no warning
// @story: SCRUM-42
// @ac: 2, 4
test('Attendance equal to the maximum capacity, and times exactly at opening and closing, give no warning', async ({
  page,
}) => {
  const eventId = await approvedEvent('TC42 At Limits', {
    start_time: '08:00',
    end_time: '20:00',
    attendance: 60,
  })
  await startBooking(page, eventId)

  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId('booking-new-warnings')).toHaveCount(0)
})

// @tc: TC-SCRUM-42-10
// @test: Attendance one above the maximum capacity gives a capacity warning
// @story: SCRUM-42
// @ac: 2, 3
test('Attendance one above the maximum capacity gives a capacity warning', async ({ page }) => {
  const eventId = await approvedEvent('TC42 Over By One', {
    start_time: '10:00',
    end_time: '12:00',
    attendance: 61,
  })
  await startBooking(page, eventId)

  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId('booking-new-warning-capacity')).toHaveText(
    "Expected attendance 61 is above the venue's maximum capacity of 60.",
  )
  await expect(allWarnings(page)).toHaveCount(1)
})

// @tc: TC-SCRUM-42-11
// @test: An end time one minute after closing gives an operating-hours warning
// @story: SCRUM-42
// @ac: 2, 3
test('An end time one minute after closing gives an operating-hours warning', async ({ page }) => {
  const eventId = await approvedEvent('TC42 Late Finish', {
    start_time: '18:00',
    end_time: '20:01',
    attendance: 20,
  })
  await startBooking(page, eventId)

  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')

  await expect(page.getByTestId('booking-new-warning-end-time')).toHaveText(
    "End time 20:01 is outside the venue's operating hours, 08:00 to 20:00.",
  )
  await expect(allWarnings(page)).toHaveCount(1)
})

// @tc: TC-SCRUM-42-12
// @test: The Event Coordinator raises the request despite a warning
// @story: SCRUM-42
// @ac: 5
test('The Event Coordinator raises the request despite a warning', async ({ page }) => {
  const eventId = await approvedEvent('TC42 Override', {
    start_time: '10:00',
    end_time: '12:00',
    attendance: 100,
  })
  await startBooking(page, eventId)
  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await expect(page.getByTestId('booking-new-warning-capacity')).toBeVisible()

  await page.getByTestId('booking-new-raise-button').click()

  await expect(page).toHaveURL(`/venues/${SEMINAR_ROOM_1}`)
  await expect(page.getByTestId('venue-detail-banner')).toHaveText('Venue booking requested')
  const row = page.locator('[data-testid^="venue-detail-booking-row-"]', {
    has: page.getByText('TC42 Override', { exact: true }),
  })
  await expect(row.last()).toContainText('Requested')
})

// @tc: TC-SCRUM-42-13
// @test: The Event Coordinator cancels after a warning and nothing is raised
// @story: SCRUM-42
// @ac: 5
test('The Event Coordinator cancels after a warning and nothing is raised', async ({ page }) => {
  const eventId = await approvedEvent('TC42 Cancelled Pick', {
    start_time: '10:00',
    end_time: '12:00',
    attendance: 100,
  })
  await startBooking(page, eventId)
  await chooseVenue(page, SEMINAR_ROOM_1, 'Seminar Room 1')
  await expect(page.getByTestId('booking-new-warning-capacity')).toBeVisible()

  // The back link is the Cancel (SCRUM-42 AC5, PO decision).
  await page.getByTestId('booking-new-back-link').click()

  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}$`))
  await expect(page.getByTestId('request-detail-name')).toHaveText('TC42 Cancelled Pick')

  await logout(page)
  await login(page, 'venue1')
  await page.goto(`/venues/${SEMINAR_ROOM_1}`)
  await expect(page.getByTestId('venue-detail-name')).toHaveText('Seminar Room 1')
  await expect(
    page.locator('[data-testid^="venue-detail-booking-row-"], [data-testid="venue-detail-bookings-empty"]').first(),
  ).toBeVisible()
  await expect(
    page.locator('[data-testid^="venue-detail-booking-event-"]', { hasText: 'TC42 Cancelled Pick' }),
  ).toHaveCount(0)

  const staff = await apiAs('venue1')
  const bookings = await (await staff.get(`/api/venues/${SEMINAR_ROOM_1}/bookings`)).json()
  expect(bookings.filter((row) => row.event_request_id === eventId)).toEqual([])
  await staff.dispose()
})
