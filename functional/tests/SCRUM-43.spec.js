import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-43 Assign a Coordinator to an Event Request.
//
// Every approval, in any spec, adds to some Coordinator's open events, so the
// counts a row names cannot be assumed. Each test calls arrange() with the
// situation it needs; arrange() reads the counts and approves a "SCRUM-43
// filler" event only while the situation does not hold yet. The rule gives
// every approval to the lowest Coordinator (first username on a tie), so the
// right situation is never more than a few fillers away, and often none.
// Exact counts per row, and Confirmed counting as open, are proved with the
// data set directly in backend/tests/test_coordinator_assignment.py.
// Seeded Past Gala (Completed) and Called Off Fair (Cancelled) belong to multi1
// and must not count as open (TC-04).

const BASE_URL = 'http://localhost:5173'
const OPEN = ['Planning', 'Confirmed']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// The situations a row needs, from the open-event counts of the three Coordinators.
const SITUATIONS = {
  // All three level: the next approval is a three-way tie.
  threeWayTie: (c) => c.coord1 === c.coord2 && c.coord2 === c.multi1,
  // coord2 and multi1 level and below coord1: a tie between only the lowest two.
  twoWayTie: (c) => c.coord2 === c.multi1 && c.multi1 < c.coord1,
  // multi1 alone is the lowest.
  multi1Lowest: (c) => c.multi1 < c.coord1 && c.multi1 < c.coord2,
}

let organiser // org1, logged in through the API once for the whole file
let coordinator // coord1, likewise
let fillers = 0
let assignedToCoord2 // one Planning event, shared by the three rows that only read it

test.beforeAll(async () => {
  organiser = await apiAs('org1')
  coordinator = await apiAs('coord1')
})

test.afterAll(async () => {
  await organiser.dispose()
  await coordinator.dispose()
})

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  return api
}

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

// A month ahead, so the submission's "not in the past" rule never trips.
function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

// Today's date as the page shows it: the server stores UTC.
function todayShown() {
  const now = new Date()
  return `${String(now.getUTCDate()).padStart(2, '0')} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`
}

async function submitEvent(name) {
  const resp = await organiser.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-43',
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 80,
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
    },
  })
  expect(resp.status()).toBe(201)
  return (await resp.json()).id
}

async function approve(id) {
  const resp = await coordinator.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(resp.ok()).toBeTruthy()
  return resp.json()
}

async function openEvents() {
  const rows = await (await coordinator.get('/api/requests')).json()
  const counts = { coord1: 0, coord2: 0, multi1: 0 }
  for (const row of rows) {
    if (OPEN.includes(row.status) && row.assigned_coordinator in counts) {
      counts[row.assigned_coordinator] += 1
    }
  }
  return counts
}

// Approve fillers only while the situation does not hold yet.
async function arrange(situation) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (SITUATIONS[situation](await openEvents())) return
    fillers += 1
    await approve(await submitEvent(`SCRUM-43 filler ${fillers}`))
  }
  throw new Error(`The Coordinators could not be put in the "${situation}" situation`)
}

// One Planning event assigned to coord2, made when first needed and then reused.
function planningEventAssignedToCoord2() {
  assignedToCoord2 ??= (async () => {
    await arrange('twoWayTie')
    const id = await submitEvent('Alumni Networking Night')
    expect((await approve(id)).assigned_coordinator).toBe('coord2')
    return id
  })()
  return assignedToCoord2
}

async function openFromRequestsPage(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

async function approveThroughThePage(page, id) {
  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
}

async function expectAssignment(page, assignee, decidedBy) {
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText(assignee)
  await expect(page.getByTestId('request-detail-assigned-at')).toHaveText(todayShown())
  await expect(page.getByTestId('request-detail-decision')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText(decidedBy)
}

// @tc: TC-SCRUM-43-01
// @test: approving a Submitted request assigns it to the Event Coordinator with the fewest open events and moves it to Planning
// @story: SCRUM-43
// @ac: 1, 3
test('approving a Submitted request assigns it to the Event Coordinator with the fewest open events and moves it to Planning', async ({ page }) => {
  await arrange('multi1Lowest')
  const id = await submitEvent('Assign Fewest Open')
  await login(page, 'coord1')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'multi1', 'coord1')
  await page.reload()
  await expectAssignment(page, 'multi1', 'coord1')
})

// @tc: TC-SCRUM-43-02
// @test: a three-way tie goes to the Coordinator whose username comes first alphabetically
// @story: SCRUM-43
// @ac: 2
test('a three-way tie goes to the Coordinator whose username comes first alphabetically', async ({ page }) => {
  await arrange('threeWayTie')
  const id = await submitEvent('Assign Three Way Tie')
  await login(page, 'coord2')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'coord1', 'coord2')
})

// @tc: TC-SCRUM-43-03
// @test: a tie between only the lowest-loaded Coordinators goes to the first of them alphabetically
// @story: SCRUM-43
// @ac: 2
test('a tie between only the lowest-loaded Coordinators goes to the first of them alphabetically', async ({ page }) => {
  await arrange('twoWayTie')
  const id = await submitEvent('Assign Two Way Tie')
  await login(page, 'coord1')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'coord2', 'coord1')
})

// @tc: TC-SCRUM-43-04
// @test: only Planning and Confirmed events count as open
// @story: SCRUM-43
// @ac: 1
test('only Planning and Confirmed events count as open', async ({ page }) => {
  // multi1 holds a Completed and a Cancelled event from the seed. If those
  // counted, multi1 would be two ahead, not the lowest, and coord1 would win.
  await arrange('multi1Lowest')
  const id = await submitEvent('Assign Open Definition')
  await login(page, 'coord1')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'multi1', 'coord1')
})

// @tc: TC-SCRUM-43-05
// @test: the Coordinator who approves a request can be the one assigned to it
// @story: SCRUM-43
// @ac: 1
test('the Coordinator who approves a request can be the one assigned to it', async ({ page }) => {
  // Every approval goes to the lowest Coordinator, so coord1 can only be the
  // lowest in a tie (it comes first); the unique-lowest case is a unit test.
  await arrange('threeWayTie')
  const id = await submitEvent('Assign To Approver')
  await login(page, 'coord1')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'coord1', 'coord1')
})

// @tc: TC-SCRUM-43-06
// @test: the submitting Event Organiser can see who is assigned and the date
// @story: SCRUM-43
// @ac: 6
test('the submitting Event Organiser can see who is assigned and the date', async ({ page }) => {
  const id = await planningEventAssignedToCoord2()
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.getByTestId('request-detail-assigned-at')).toHaveText(todayShown())
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-43-07
// @test: an Event Coordinator who is not assigned can also see who is assigned and the date
// @story: SCRUM-43
// @ac: 6
test('an Event Coordinator who is not assigned can also see who is assigned and the date', async ({ page }) => {
  const id = await planningEventAssignedToCoord2()
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()
  await expect(page.getByTestId(`requests-status-${id}`)).toHaveText('Planning')
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()

  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.getByTestId('request-detail-assigned-at')).toHaveText(todayShown())
})

// @tc: TC-SCRUM-43-08
// @test: an assigned Coordinator cannot decline the assignment
// @story: SCRUM-43
// @ac: 5
test('an assigned Coordinator cannot decline the assignment', async ({ page }) => {
  const id = await planningEventAssignedToCoord2()
  await login(page, 'coord2')
  await openFromRequestsPage(page, id)

  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.locator('[data-testid*="decline"]')).toHaveCount(0)
  await expect(page.locator('[data-testid*="unassign"]')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-reject-button')).toHaveCount(0)

  await page.reload()
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord2')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
})

// @tc: TC-SCRUM-43-09
// @test: a second approval from an out-of-date page is refused and the single assigned Coordinator is unchanged
// @story: SCRUM-43
// @ac: 4
test('a second approval from an out-of-date page is refused and the single assigned Coordinator is unchanged', async ({ page }) => {
  await arrange('multi1Lowest')
  const id = await submitEvent('Assign Only Once')
  await login(page, 'coord2')
  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  // coord1 approves behind coord2's open page, so multi1 is assigned.
  const first = await approve(id)
  expect(first.assigned_coordinator).toBe('multi1')

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()

  const banner = page.getByTestId('request-detail-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toContainText('already been decided')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('multi1')

  const after = await (await organiser.get(`/api/requests/${id}`)).json()
  expect(after.assigned_coordinator).toBe('multi1')
  expect(after.assigned_at).toBe(first.assigned_at)
  expect(after.decided_by).toBe('coord1')
})

// @tc: TC-SCRUM-43-10
// @test: rejecting a request assigns no Coordinator
// @story: SCRUM-43
// @ac: 1
test('rejecting a request assigns no Coordinator', async ({ page }) => {
  const id = await submitEvent('Reject Not Assigned')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-reject-button').click()
  await page.getByTestId('request-detail-reject-reason-input').fill('Venue capacity cannot be met.')
  await page.getByTestId('request-detail-reject-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-assigned-at')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveCount(0)
})
