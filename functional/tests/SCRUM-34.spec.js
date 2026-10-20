import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-34 Filter Venue Results by Accessibility Requirements. One test per
// curated row of the Test cases tab, in the row's order; every row can be
// reached through the running app, so none is left manual.
//
// Seeded Seminar Room 1 (/venues/1: Step-free access, Lift access) and
// Auditorium (/venues/2: Step-free access, Hearing loop, Accessible toilet,
// Reserved seating) are read, never changed. The rows' "No Features Hall" is a
// venue each test creates for itself (no accessibility features, capacity 80).
// One SQLite file is shared by every spec, so a test asserts on those three
// venues' result rows by id: never on a count, and never that the list is
// empty when a feature other specs also record on their venues (Hearing loop,
// Step-free access) is ticked. TC-05 alone asserts the empty sentence: no
// spec records Lift access and Hearing loop on one venue.

const BASE_URL = 'http://localhost:5173'
const SEMINAR_ROOM_1 = 1
const AUDITORIUM = 2

const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')

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

// A date far enough ahead to be clear of every other spec's events, blocks and
// the seeded 2026-2027 series; each test passes its own offset so no two tests
// share a day. 700 keeps this band clear of the other specs' bands, which start
// at +30/+90/+200/+300/+400 days: every band advances one day per day, so the
// separation between them is permanent.
function dateAhead(offset) {
  const date = new Date()
  date.setDate(date.getDate() + 700 + offset)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

// Submits as org1 and approves as coord1, so the event may be searched.
async function approvedEvent(name, offset, overrides = {}) {
  const organiser = await apiAs('org1')
  const resp = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-34',
      date: dateAhead(offset),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 50,
      equipment_requirements: 'None',
      registration_needs: 'None',
      ...overrides,
    },
  })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await organiser.dispose()

  await assignAsLead(id) // SCRUM-87: only the assigned coordinator decides

  const coordinator = await apiAs('coord1')
  const approved = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(approved.ok()).toBeTruthy()
  await coordinator.dispose()
  return id
}

// A venue that records no accessibility features, as the rows' "No Features Hall".
async function noFeaturesHall(name) {
  const staff = await apiAs('venue1')
  const resp = await staff.post('/api/venues', {
    data: { name, location: 'Block D Level 1', max_capacity: 80 },
  })
  expect(resp.status()).toBe(201)
  const { id } = await resp.json()
  await staff.dispose()
  return id
}

// Blocks the Auditorium on the event's day, 09:00-13:00, as the rows' Maintenance block.
async function blockAuditorium(offset) {
  const staff = await apiAs('venue1')
  const day = dateAhead(offset)
  const resp = await staff.post(`/api/venues/${AUDITORIUM}/blocks`, {
    data: { start_date: day, start_time: '09:00', end_date: day, end_time: '13:00', reason: 'Maintenance' },
  })
  expect(resp.status()).toBe(201)
  await staff.dispose()
}

async function openRequest(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

// Logs in as coord1, opens the event and opens venue search for it, once its
// results and the accessibility options have loaded.
async function openSearch(page, eventId) {
  await login(page, 'coord1')
  await openRequest(page, eventId)
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}/venues/search$`))
  await expect(page.getByTestId('venue-search-event-name')).toBeVisible()
  await expect(page.getByTestId('venue-search-accessibility-features-hearing-loop-input')).toBeVisible()
}

const feature = (page, name) => page.getByTestId(`venue-search-accessibility-features-${kebab(name)}-input`)
const row = (page, id) => page.getByTestId(`venue-search-row-${id}`)

async function select(page, ...names) {
  for (const name of names) await feature(page, name).check()
}

async function apply(page) {
  await page.getByTestId('venue-search-apply-button').click()
}

// @tc: TC-SCRUM-34-01
// @test: the venue search offers the recognised accessibility features for selection, with none selected automatically
// @story: SCRUM-34
// @ac: 1, 3
test('the venue search offers the recognised accessibility features for selection, with none selected automatically', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-34 Options Event', 1)
  await openSearch(page, eventId)

  const group = page.getByRole('group', { name: 'Accessibility features' })
  await expect(group.getByRole('checkbox')).toHaveCount(5)
  for (const name of ['Step-free access', 'Hearing loop', 'Accessible toilet', 'Lift access', 'Reserved seating']) {
    await expect(feature(page, name)).toBeVisible()
    await expect(feature(page, name)).not.toBeChecked()
  }
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-02
// @test: selecting one accessibility feature keeps venues that have that feature and excludes a venue with no recorded accessibility features
// @story: SCRUM-34
// @ac: 1, 2
test('selecting one accessibility feature keeps venues that have that feature and excludes a venue with no recorded accessibility features', async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 02')
  const eventId = await approvedEvent('SCRUM-34 Step-free Event', 2)
  await openSearch(page, eventId)
  await expect(row(page, hallId)).toBeVisible()

  await select(page, 'Step-free access')
  await apply(page)

  await expect(row(page, hallId)).toHaveCount(0)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-03
// @test: selecting a feature recorded by only one venue shows only that venue
// @story: SCRUM-34
// @ac: 1, 2
test('selecting a feature recorded by only one venue shows only that venue', async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 03')
  const eventId = await approvedEvent('SCRUM-34 Hearing Loop Event', 3)
  await openSearch(page, eventId)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()

  await select(page, 'Hearing loop')
  await apply(page)

  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, hallId)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-04
// @test: selecting several accessibility features shows only venues that have every selected feature
// @story: SCRUM-34
// @ac: 2
test('selecting several accessibility features shows only venues that have every selected feature', async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 04')
  const eventId = await approvedEvent('SCRUM-34 Several Features Event', 4)
  await openSearch(page, eventId)
  await expect(row(page, AUDITORIUM)).toBeVisible()

  await select(page, 'Step-free access', 'Lift access')
  await apply(page)

  // The Auditorium has Step-free access but not Lift access: one is not enough.
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, hallId)).toHaveCount(0)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-05
// @test: selecting features that no single venue has together produces no matching venue
// @story: SCRUM-34
// @ac: 2
test('selecting features that no single venue has together produces no matching venue', async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 05')
  const eventId = await approvedEvent('SCRUM-34 No Match Event', 5)
  await openSearch(page, eventId)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()

  await select(page, 'Lift access', 'Hearing loop')
  await apply(page)

  // No spec records Lift access and Hearing loop on the same venue.
  await expect(page.getByTestId('venue-search-empty')).toBeVisible()
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, hallId)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-06
// @test: when the Event Coordinator selects no accessibility feature, accessibility does not restrict the venue results
// @story: SCRUM-34
// @ac: 3
test('when the Event Coordinator selects no accessibility feature, accessibility does not restrict the venue results', async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 06')
  const eventId = await approvedEvent('SCRUM-34 No Selection Event', 6)
  await openSearch(page, eventId)

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(row(page, hallId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-07
// @test: the accessibility filter combines with the location filter, so a venue with the selected accessibility feature but the wrong location remains excluded
// @story: SCRUM-34
// @ac: 4
test('the accessibility filter combines with the location filter, so a venue with the selected accessibility feature but the wrong location remains excluded', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-34 Location Event', 7)
  await openSearch(page, eventId)

  await page.getByTestId('venue-search-location-input').fill('Block C Level 1')
  await apply(page)
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await select(page, 'Step-free access')
  await apply(page)

  // Seminar Room 1 has Step-free access, but its location is Block A Level 2.
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-08
// @test: a venue excluded by the event's capacity criterion remains excluded even when it has the selected accessibility feature
// @story: SCRUM-34
// @ac: 4
test("a venue excluded by the event's capacity criterion remains excluded even when it has the selected accessibility feature", async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-34 Attendance 61 Event', 8, { attendance: 61 })
  await openSearch(page, eventId)

  await select(page, 'Step-free access')
  await apply(page)

  // Seminar Room 1 has Step-free access but holds 60.
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-09
// @test: a venue excluded by an active availability rule remains excluded even when it has the selected accessibility feature
// @story: SCRUM-34
// @ac: 4
test('a venue excluded by an active availability rule remains excluded even when it has the selected accessibility feature', async ({ page }) => {
  await blockAuditorium(9)
  const eventId = await approvedEvent('SCRUM-34 Blocked Event', 9)
  await openSearch(page, eventId)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toHaveCount(0)

  await select(page, 'Hearing loop')
  await apply(page)

  // The Auditorium has Hearing loop but is blocked; no other seeded venue has it.
  // Other specs' venues may record it, so the empty sentence is not asserted.
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-34-10
// @test: clearing the accessibility filter retains an active location filter
// @story: SCRUM-34
// @ac: 5
test('clearing the accessibility filter retains an active location filter', async ({ page }) => {
  const eventId = await approvedEvent('SCRUM-34 Clear Location Event', 10)
  await openSearch(page, eventId)

  await page.getByTestId('venue-search-location-input').fill('Block A Level 2')
  await apply(page)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await select(page, 'Hearing loop')
  await apply(page)
  // Seminar Room 1 is in Block A but has no Hearing loop.
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)

  await feature(page, 'Hearing loop').uncheck()
  await apply(page)

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-location-input')).toHaveValue('Block A Level 2')
})

// @tc: TC-SCRUM-34-11
// @test: clearing the accessibility filter does not remove the event's other active search restrictions
// @story: SCRUM-34
// @ac: 4, 5
test("clearing the accessibility filter does not remove the event's other active search restrictions", async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 11')
  await blockAuditorium(11)
  const eventId = await approvedEvent('SCRUM-34 Clear Block Event', 11)
  await openSearch(page, eventId)

  await select(page, 'Hearing loop')
  await apply(page)
  await expect(row(page, hallId)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)

  await feature(page, 'Hearing loop').uncheck()
  await apply(page)

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, hallId)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
})

// @tc: TC-SCRUM-34-12
// @test: the event's own required accessibility features are not applied to the search automatically: no feature is selected and accessibility does not restrict the results
// @story: SCRUM-34
// @ac: 3
test("the event's own required accessibility features are not applied to the search automatically: no feature is selected and accessibility does not restrict the results", async ({ page }) => {
  const hallId = await noFeaturesHall('SCRUM-34 Hall 12')
  const eventId = await approvedEvent('SCRUM-34 Needs Event', 12, {
    accessibility_features: ['Hearing loop', 'Accessible toilet'],
  })
  await openSearch(page, eventId)

  for (const name of ['Step-free access', 'Hearing loop', 'Accessible toilet', 'Lift access', 'Reserved seating']) {
    await expect(feature(page, name)).not.toBeChecked()
  }
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(row(page, hallId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})
