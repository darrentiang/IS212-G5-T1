import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-35 Filter Venues by Layout and Facilities. One test per curated row of
// the Test cases tab, in the row's order; every row can be reached through the
// running app, so none is left manual.
//
// Seeded Seminar Room 1 (/venues/1: Projector, Whiteboard, Wi-Fi; Step-free
// access, Lift access; no layouts) and Auditorium (/venues/2: Projector, Stage
// lighting, Sound system; no layouts) are read, never changed. The rows' "Layout
// Hall" (Projector, Wi-Fi; Classroom and Boardroom) and "Theatre Hall"
// (Projector, Stage lighting; Theatre and Classroom) are venues each test
// creates for itself, through the API as venue1, under names of its own. One
// SQLite file is shared by every spec, so a test asserts on those four venues'
// result rows by id: never on a count, and never that the list is empty,
// because other specs' venues also record layouts and facilities.

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

// A date far enough ahead to be clear of every other spec's events and blocks;
// each test passes its own offset so no two tests share a day.
function dateAhead(offset) {
  const date = new Date()
  date.setDate(date.getDate() + 400 + offset)
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
      description: 'An event for SCRUM-35',
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

// A venue as venue1 records it, returning its id.
async function createVenue({ name, capacity, facilities, layouts }) {
  const staff = await apiAs('venue1')
  const created = await staff.post('/api/venues', {
    data: { name, location: 'Block D Level 1', max_capacity: capacity, facilities },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  const recorded = await staff.patch(`/api/venues/${id}/layouts`, { data: { layouts } })
  expect(recorded.ok()).toBeTruthy()
  await staff.dispose()
  return id
}

// The rows' two added venues, under names of this test's own.
async function layoutHall(suffix) {
  return createVenue({
    name: `Layout Hall ${suffix}`,
    capacity: 80,
    facilities: ['Projector', 'Wi-Fi'],
    layouts: ['Classroom', 'Boardroom'],
  })
}

async function theatreHall(suffix) {
  return createVenue({
    name: `Theatre Hall ${suffix}`,
    capacity: 90,
    facilities: ['Projector', 'Stage lighting'],
    layouts: ['Theatre', 'Classroom'],
  })
}

// Blocks a venue on the event's day, 09:00-13:00, as the rows' Maintenance block.
async function blockVenue(venueId, offset) {
  const staff = await apiAs('venue1')
  const day = dateAhead(offset)
  const resp = await staff.post(`/api/venues/${venueId}/blocks`, {
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
// results and the filter options have loaded.
async function openSearch(page, eventId) {
  await login(page, 'coord1')
  await openRequest(page, eventId)
  await page.getByTestId('request-detail-search-venues-button').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${eventId}/venues/search$`))
  await expect(page.getByTestId('venue-search-event-name')).toBeVisible()
  await expect(page.getByTestId('venue-search-facilities-wi-fi-input')).toBeVisible()
}

const row = (page, id) => page.getByTestId(`venue-search-row-${id}`)
const facility = (page, name) => page.getByTestId(`venue-search-facilities-${kebab(name)}-input`)
const layoutSelect = (page) => page.getByTestId('venue-search-layout-input')

async function apply(page) {
  await page.getByTestId('venue-search-apply-button').click()
}

async function tick(page, ...names) {
  for (const name of names) await facility(page, name).check()
}

// @tc: TC-SCRUM-35-01
// @test: the venue search offers the recognised room layouts and facilities for selection, with nothing selected automatically, and no venue is excluded for layout or facilities
// @story: SCRUM-35
// @ac: 1, 2, 3
test('the venue search offers the recognised room layouts and facilities for selection, with nothing selected automatically, and no venue is excluded for layout or facilities', async ({ page }) => {
  const layoutId = await layoutHall('01')
  const theatreId = await theatreHall('01')
  const eventId = await approvedEvent('SCRUM-35 Options Event', 1)
  await openSearch(page, eventId)

  const options = await layoutSelect(page).locator('option').allTextContents()
  expect(options).toEqual(expect.arrayContaining(['None', 'Classroom', 'Theatre', 'Boardroom', 'Banquet', 'Exhibition']))
  expect(options[0]).toBe('None')
  await expect(layoutSelect(page)).toHaveValue('')
  for (const name of ['Projector', 'Stage lighting', 'Sound system', 'Whiteboard', 'Catering kitchen', 'Wi-Fi']) {
    await expect(facility(page, name)).toBeVisible()
    await expect(facility(page, name)).not.toBeChecked()
  }
  for (const id of [SEMINAR_ROOM_1, AUDITORIUM, layoutId, theatreId]) {
    await expect(row(page, id)).toBeVisible()
  }
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-02
// @test: selecting a room layout shows only venues that record that layout as supported, and excludes a venue with no layouts recorded
// @story: SCRUM-35
// @ac: 1
test('selecting a room layout shows only venues that record that layout as supported, and excludes a venue with no layouts recorded', async ({ page }) => {
  const layoutId = await layoutHall('02')
  const theatreId = await theatreHall('02')
  const eventId = await approvedEvent('SCRUM-35 Classroom Event', 2)
  await openSearch(page, eventId)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()

  await layoutSelect(page).selectOption('Classroom')
  await apply(page)

  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, layoutId)).toBeVisible()
  await expect(row(page, theatreId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-03
// @test: ticking one facility shows only venues that record that facility
// @story: SCRUM-35
// @ac: 2
test('ticking one facility shows only venues that record that facility', async ({ page }) => {
  const layoutId = await layoutHall('03')
  const theatreId = await theatreHall('03')
  const eventId = await approvedEvent('SCRUM-35 Wi-Fi Event', 3)
  await openSearch(page, eventId)
  await expect(row(page, AUDITORIUM)).toBeVisible()

  await tick(page, 'Wi-Fi')
  await apply(page)

  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, theatreId)).toHaveCount(0)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, layoutId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-04
// @test: ticking several facilities shows only venues that record every ticked facility, not any of them
// @story: SCRUM-35
// @ac: 2
test('ticking several facilities shows only venues that record every ticked facility, not any of them', async ({ page }) => {
  const layoutId = await layoutHall('04')
  const theatreId = await theatreHall('04')
  const eventId = await approvedEvent('SCRUM-35 Several Facilities Event', 4)
  await openSearch(page, eventId)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()

  await tick(page, 'Projector', 'Stage lighting')
  await apply(page)

  // Seminar Room 1 and Layout Hall have a Projector but no Stage lighting: one is not enough.
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, layoutId)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toBeVisible()
  await expect(row(page, theatreId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-05
// @test: the layout and facility filters apply together: a venue must support the layout and record every ticked facility
// @story: SCRUM-35
// @ac: 1, 2
test('the layout and facility filters apply together: a venue must support the layout and record every ticked facility', async ({ page }) => {
  const layoutId = await layoutHall('05')
  const theatreId = await theatreHall('05')
  const eventId = await approvedEvent('SCRUM-35 Layout And Wi-Fi Event', 5)
  await openSearch(page, eventId)
  await expect(row(page, theatreId)).toBeVisible()

  await layoutSelect(page).selectOption('Classroom')
  await tick(page, 'Wi-Fi')
  await apply(page)

  // Theatre Hall supports Classroom but has no Wi-Fi; Seminar Room 1 has Wi-Fi but no layout.
  await expect(row(page, theatreId)).toHaveCount(0)
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, layoutId)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-06
// @test: the event's own required room layout and facilities are not applied to the search automatically: nothing is selected and the results are not restricted
// @story: SCRUM-35
// @ac: 3
test("the event's own required room layout and facilities are not applied to the search automatically: nothing is selected and the results are not restricted", async ({ page }) => {
  const layoutId = await layoutHall('06')
  const theatreId = await theatreHall('06')
  const eventId = await approvedEvent('SCRUM-35 Needs Event', 6, {
    layout: 'Theatre',
    facilities: ['Stage lighting', 'Sound system'],
  })
  await openSearch(page, eventId)

  await expect(layoutSelect(page)).toHaveValue('')
  for (const name of ['Projector', 'Stage lighting', 'Sound system', 'Whiteboard', 'Catering kitchen', 'Wi-Fi']) {
    await expect(facility(page, name)).not.toBeChecked()
  }
  for (const id of [SEMINAR_ROOM_1, AUDITORIUM, layoutId, theatreId]) {
    await expect(row(page, id)).toBeVisible()
  }
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-07
// @test: the facility filter combines with the location filter: a venue with the facility but the wrong location stays excluded
// @story: SCRUM-35
// @ac: 4
test('the facility filter combines with the location filter: a venue with the facility but the wrong location stays excluded', async ({ page }) => {
  const layoutId = await layoutHall('07')
  const theatreId = await theatreHall('07')
  const eventId = await approvedEvent('SCRUM-35 Location Event', 7)
  await openSearch(page, eventId)

  await page.getByTestId('venue-search-location-input').fill('Block A Level 2')
  await apply(page)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await tick(page, 'Projector')
  await apply(page)

  // Auditorium, Layout Hall and Theatre Hall all have a Projector, but none is in Block A Level 2.
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, layoutId)).toHaveCount(0)
  await expect(row(page, theatreId)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-08
// @test: a venue excluded by an active availability rule stays excluded even when it supports the selected layout
// @story: SCRUM-35
// @ac: 4
test('a venue excluded by an active availability rule stays excluded even when it supports the selected layout', async ({ page }) => {
  const layoutId = await layoutHall('08')
  const theatreId = await theatreHall('08')
  await blockVenue(layoutId, 8)
  const eventId = await approvedEvent('SCRUM-35 Blocked Event', 8)
  await openSearch(page, eventId)
  await expect(row(page, theatreId)).toBeVisible()
  await expect(row(page, layoutId)).toHaveCount(0)

  await layoutSelect(page).selectOption('Classroom')
  await apply(page)

  // Layout Hall supports Classroom but is blocked.
  await expect(row(page, theatreId)).toBeVisible()
  await expect(row(page, layoutId)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-09
// @test: the facility filter combines with the accessibility filter from SCRUM-34: a venue must pass both
// @story: SCRUM-35
// @ac: 4
test('the facility filter combines with the accessibility filter from SCRUM-34: a venue must pass both', async ({ page }) => {
  const layoutId = await layoutHall('09')
  const eventId = await approvedEvent('SCRUM-35 Wi-Fi And Step-free Event', 9)
  await openSearch(page, eventId)
  await expect(row(page, layoutId)).toBeVisible()

  await tick(page, 'Wi-Fi')
  await page.getByTestId('venue-search-accessibility-features-step-free-access-input').check()
  await apply(page)

  // Layout Hall has Wi-Fi but no recorded accessibility feature; the Auditorium has Step-free
  // access but no Wi-Fi.
  await expect(row(page, layoutId)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-10
// @test: clearing the room layout removes that restriction while keeping an active location filter
// @story: SCRUM-35
// @ac: 5
test('clearing the room layout removes that restriction while keeping an active location filter', async ({ page }) => {
  await layoutHall('10')
  await theatreHall('10')
  const eventId = await approvedEvent('SCRUM-35 Clear Layout Event', 10)
  await openSearch(page, eventId)

  await page.getByTestId('venue-search-location-input').fill('Block A Level 2')
  await layoutSelect(page).selectOption('Classroom')
  await apply(page)
  // Seminar Room 1 is in Block A Level 2 but records no layout. (Other specs' venues are
  // not in Block A Level 2, but the empty sentence is not asserted: see the header.)
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)

  await layoutSelect(page).selectOption('None')
  await apply(page)

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(page.getByTestId('venue-search-location-input')).toHaveValue('Block A Level 2')
  await expect(page.getByTestId('venue-search-banner')).toHaveCount(0)
})

// @tc: TC-SCRUM-35-11
// @test: clearing the room layout keeps the ticked facilities
// @story: SCRUM-35
// @ac: 5
test('clearing the room layout keeps the ticked facilities', async ({ page }) => {
  const layoutId = await layoutHall('11')
  const theatreId = await theatreHall('11')
  const eventId = await approvedEvent('SCRUM-35 Clear Layout Keeps Facilities Event', 11)
  await openSearch(page, eventId)

  await layoutSelect(page).selectOption('Classroom')
  await tick(page, 'Wi-Fi')
  await apply(page)
  await expect(row(page, layoutId)).toBeVisible()
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)

  await layoutSelect(page).selectOption('None')
  await apply(page)

  await expect(row(page, SEMINAR_ROOM_1)).toBeVisible()
  await expect(row(page, layoutId)).toBeVisible()
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(row(page, theatreId)).toHaveCount(0)
  await expect(facility(page, 'Wi-Fi')).toBeChecked()
})

// @tc: TC-SCRUM-35-12
// @test: clearing the facilities keeps the selected room layout
// @story: SCRUM-35
// @ac: 5
test('clearing the facilities keeps the selected room layout', async ({ page }) => {
  const layoutId = await layoutHall('12')
  const theatreId = await theatreHall('12')
  const eventId = await approvedEvent('SCRUM-35 Clear Facilities Keeps Layout Event', 12)
  await openSearch(page, eventId)

  await layoutSelect(page).selectOption('Classroom')
  await tick(page, 'Wi-Fi')
  await apply(page)
  await expect(row(page, layoutId)).toBeVisible()
  await expect(row(page, theatreId)).toHaveCount(0)

  await facility(page, 'Wi-Fi').uncheck()
  await apply(page)

  await expect(row(page, layoutId)).toBeVisible()
  await expect(row(page, theatreId)).toBeVisible()
  await expect(row(page, SEMINAR_ROOM_1)).toHaveCount(0)
  await expect(row(page, AUDITORIUM)).toHaveCount(0)
  await expect(layoutSelect(page)).toHaveValue('Classroom')
})
