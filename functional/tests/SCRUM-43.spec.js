import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-43 Assign a Coordinator to an Event Request.
//
// Every spec shares one database, and every approval anywhere adds to some
// Coordinator's open events, so the open-event counts a row names cannot be
// assumed; each test builds them. The rule hands every approval to the
// Coordinator with the fewest open events (first username on a tie), so:
//   - approving filler requests until all three are level gives a three-way tie;
//   - one more filler then makes coord1 the highest, so coord2 and multi1 tie;
//   - two more make multi1 the single lowest.
// Each test checks the counts it built before it approves, so a wrong set-up
// fails there and not as a confusing assertion on the assignee. The exact
// counts in each row (and Confirmed counting as open) are also proved, with
// the data set directly, by backend/tests/test_coordinator_assignment.py.
// Seeded Past Gala (Completed) and Called Off Fair (Cancelled) belong to multi1
// and must not count as open (TC-04).

const BASE_URL = 'http://localhost:5173'
const COORDINATORS = ['coord1', 'coord2', 'multi1']
const OPEN = ['Planning', 'Confirmed']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

async function submitAsOrg1(name) {
  const api = await apiAs('org1')
  const resp = await api.post('/api/requests', {
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
  const { id } = await resp.json()
  await api.dispose()
  return id
}

async function approveAs(username, id) {
  const api = await apiAs(username)
  const resp = await api.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  await api.dispose()
  return body
}

async function readAs(username, id) {
  const api = await apiAs(username)
  const resp = await api.get(`/api/requests/${id}`)
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  await api.dispose()
  return body
}

// The open events of each Coordinator right now: Planning or Confirmed and assigned.
async function openEvents() {
  const api = await apiAs('coord1')
  const rows = await (await api.get('/api/requests')).json()
  await api.dispose()
  const counts = Object.fromEntries(COORDINATORS.map((username) => [username, 0]))
  for (const row of rows) {
    if (OPEN.includes(row.status) && row.assigned_coordinator in counts) {
      counts[row.assigned_coordinator] += 1
    }
  }
  return counts
}

async function filler() {
  const id = await submitAsOrg1(`SCRUM-43 filler ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)
  await approveAs('coord1', id)
}

// Approve fillers until the three Coordinators have the same number of open events.
async function level() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const counts = await openEvents()
    const values = COORDINATORS.map((username) => counts[username])
    if (Math.min(...values) === Math.max(...values)) return counts
    await filler()
  }
  throw new Error('The Coordinators could not be levelled')
}

// All three level, so the next approval is a three-way tie.
async function threeWayTie() {
  const counts = await level()
  expect(new Set(COORDINATORS.map((username) => counts[username])).size).toBe(1)
}

// coord1 one ahead of coord2 and multi1, which are level: a two-way tie at the bottom.
async function twoWayTie() {
  await level()
  await filler()
  const counts = await openEvents()
  expect(counts.coord1).toBe(counts.coord2 + 1)
  expect(counts.coord2).toBe(counts.multi1)
}

// coord1 and coord2 level and one ahead of multi1: multi1 is the single lowest.
async function singleLowestMulti1() {
  await level()
  await filler()
  await filler()
  const counts = await openEvents()
  expect(counts.coord1).toBe(counts.multi1 + 1)
  expect(counts.coord2).toBe(counts.multi1 + 1)
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

// A Planning request of org1's, assigned to coord2 (a two-way tie leaves coord2 first).
async function planningAssignedToCoord2(name) {
  await twoWayTie()
  const id = await submitAsOrg1(name)
  const approved = await approveAs('coord1', id)
  expect(approved.assigned_coordinator).toBe('coord2')
  return id
}

// @tc: TC-SCRUM-43-01
// @test: approving a Submitted request assigns it to the Event Coordinator with the fewest open events and moves it to Planning
// @story: SCRUM-43
// @ac: 1, 3
test('approving a Submitted request assigns it to the Event Coordinator with the fewest open events and moves it to Planning', async ({ page }) => {
  await singleLowestMulti1()
  const id = await submitAsOrg1('Assign Fewest Open')
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
  await threeWayTie()
  const id = await submitAsOrg1('Assign Three Way Tie')
  await login(page, 'coord2')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'coord1', 'coord2')
})

// @tc: TC-SCRUM-43-03
// @test: a tie between only the lowest-loaded Coordinators goes to the first of them alphabetically
// @story: SCRUM-43
// @ac: 2
test('a tie between only the lowest-loaded Coordinators goes to the first of them alphabetically', async ({ page }) => {
  await twoWayTie()
  const id = await submitAsOrg1('Assign Two Way Tie')
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
  // counted, multi1 (two ahead) would not be the lowest and coord1 would win.
  await singleLowestMulti1()
  const id = await submitAsOrg1('Assign Open Definition')
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
  await threeWayTie()
  const id = await submitAsOrg1('Assign To Approver')
  await login(page, 'coord1')
  await approveThroughThePage(page, id)

  await expectAssignment(page, 'coord1', 'coord1')
})

// @tc: TC-SCRUM-43-06
// @test: the submitting Event Organiser can see who is assigned and the date
// @story: SCRUM-43
// @ac: 6
test('the submitting Event Organiser can see who is assigned and the date', async ({ page }) => {
  const id = await planningAssignedToCoord2('Organiser Sees Assignment')
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
  const id = await planningAssignedToCoord2('Coordinator Sees Assignment')
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
  const id = await planningAssignedToCoord2('Assignment No Decline')
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
  await singleLowestMulti1()
  const id = await submitAsOrg1('Assign Only Once')
  await login(page, 'coord2')
  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  // coord1 approves behind coord2's open page, so multi1 is assigned.
  const first = await approveAs('coord1', id)
  expect(first.assigned_coordinator).toBe('multi1')

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()

  const banner = page.getByTestId('request-detail-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toContainText('already been decided')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Planning')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('multi1')

  const after = await readAs('org1', id)
  expect(after.assigned_coordinator).toBe('multi1')
  expect(after.assigned_at).toBe(first.assigned_at)
  expect(after.decided_by).toBe('coord1')
})

// @tc: TC-SCRUM-43-10
// @test: rejecting a request assigns no Coordinator
// @story: SCRUM-43
// @ac: 1
test('rejecting a request assigns no Coordinator', async ({ page }) => {
  const id = await submitAsOrg1('Reject Not Assigned')
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
