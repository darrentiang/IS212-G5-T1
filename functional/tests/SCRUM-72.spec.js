import { test, expect, request as playwrightRequest } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-72 Resubmit a Rejected Request.
// Seeded Annual Dinner (/requests/1, Submitted) is only read here. Every
// request a test resubmits it creates itself through the API as org1 and has
// coord1 reject it, under its own name.

const BASE_URL = 'http://localhost:5173'
const REASON = 'Venue capacity cannot be met.'

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

// A Rejected request of org1's, rejected by coord1 with REASON.
async function rejectedRequest(name) {
  const org = await apiAs('org1')
  const created = await org.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-72',
      date: futureDate(),
      start_time: '10:00',
      end_time: '12:00',
      attendance: 80,
      equipment_requirements: 'Projector',
      registration_needs: 'Guest list supplied',
    },
  })
  expect(created.status()).toBe(201)
  const { id } = await created.json()
  await org.dispose()

  const coord = await apiAs('coord1')
  const rejected = await coord.post(`/api/requests/${id}/reject`, { data: { reason: REASON } })
  expect(rejected.ok()).toBeTruthy()
  await coord.dispose()
  return id
}

async function readAs(username, id) {
  const api = await apiAs(username)
  const resp = await api.get(`/api/requests/${id}`)
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  await api.dispose()
  return body
}

async function resubmitAsOrg1(id, data = {}) {
  const api = await apiAs('org1')
  const resp = await api.post(`/api/requests/${id}/resubmit`, { data })
  expect(resp.ok()).toBeTruthy()
  await api.dispose()
}

async function openFromRequestsPage(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

// @tc: TC-SCRUM-72-01
// @test: the creating organiser can open a Rejected request, see the reason and edit its fields
// @story: SCRUM-72
// @ac: 1
test('the creating organiser can open a Rejected request, see the reason and edit its fields', async ({ page }) => {
  const id = await rejectedRequest('Resubmit View Reason')
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-decision')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveText(REASON)
  await expect(page.getByTestId('request-detail-resubmit-button')).toBeVisible()
  for (const field of [
    'name',
    'purpose',
    'description',
    'date',
    'start-time',
    'end-time',
    'attendance',
    'equipment-requirements',
    'registration-needs',
  ]) {
    await expect(page.getByTestId(`request-detail-resubmit-${field}-input`)).toBeEditable()
  }
  await expect(page.getByTestId('request-detail-resubmit-layout-input')).toBeEnabled()

  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
})

// @tc: TC-SCRUM-72-02
// @test: the organiser edits fields of a Rejected request and resubmits it
// @story: SCRUM-72
// @ac: 1, 2, 3
test('the organiser edits fields of a Rejected request and resubmits it', async ({ page }) => {
  const id = await rejectedRequest('Resubmit Edit Fields')
  const before = await readAs('org1', id)
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-resubmit-attendance-input').fill('40')
  await page.getByTestId('request-detail-resubmit-equipment-requirements-input').fill('Microphones')
  await page.getByTestId('request-detail-resubmit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-attendance')).toHaveText('40')
  await expect(page.getByTestId('request-detail-equipment-requirements')).toHaveText('Microphones')
  await expect(page.getByTestId('request-detail-submitted-at')).toBeVisible()
  await expect(page.getByTestId('request-detail-resubmit-button')).toHaveCount(0)

  const after = await readAs('org1', id)
  expect(new Date(after.submitted_at).getTime()).toBeGreaterThan(new Date(before.submitted_at).getTime())
})

// @tc: TC-SCRUM-72-03
// @test: a resubmitted request is listed for the coordinator as Submitted and can be decided again
// @story: SCRUM-72
// @ac: 3
test('a resubmitted request is listed for the coordinator as Submitted and can be decided again', async ({ page }) => {
  const id = await rejectedRequest('Resubmit Appears Again')
  await resubmitAsOrg1(id)
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()

  await expect(page.getByTestId(`requests-status-${id}`)).toHaveText('Submitted')
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-approve-button')).toBeVisible()
  await expect(page.getByTestId('request-detail-reject-button')).toBeVisible()
})

// @tc: TC-SCRUM-72-04
// @test: the earlier decision, reason, date and decider stay visible on a resubmitted request
// @story: SCRUM-72
// @ac: 4
test('the earlier decision, reason, date and decider stay visible on a resubmitted request', async ({ page }) => {
  const id = await rejectedRequest('Resubmit Keeps History')
  const rejected = await readAs('org1', id)
  await login(page, 'org1')
  await openFromRequestsPage(page, id)
  const decidedAt = await page.getByTestId('request-detail-decided-at').textContent()

  await page.getByTestId('request-detail-resubmit-attendance-input').fill('40')
  await page.getByTestId('request-detail-resubmit-button').click()

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-decision')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveText(REASON)
  await expect(page.getByTestId('request-detail-decided-at')).toHaveText(decidedAt)
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText('coord1')

  const after = await readAs('org1', id)
  expect(after.decided_at).toBe(rejected.decided_at)
})

// @tc: TC-SCRUM-72-05
// @test: a resubmission with required fields blank is refused and the request stays Rejected
// @story: SCRUM-72
// @ac: 2
test('a resubmission with required fields blank is refused and the request stays Rejected', async ({ page }) => {
  const id = await rejectedRequest('Resubmit Blank Fields')
  const before = await readAs('org1', id)
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-resubmit-name-input').fill('')
  await page.getByTestId('request-detail-resubmit-purpose-input').fill('')
  await page.getByTestId('request-detail-resubmit-button').click()

  await expect(page.getByTestId('request-detail-resubmit-name-error')).toBeVisible()
  await expect(page.getByTestId('request-detail-resubmit-purpose-error')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-name')).toHaveText('Resubmit Blank Fields')

  const after = await readAs('org1', id)
  expect(after.submitted_at).toBe(before.submitted_at)
  expect(after.decision_reason).toBe(REASON)
})

// @tc: TC-SCRUM-72-06
// @test: a resubmission that breaks a business rule is refused, the problem is shown and the request stays Rejected
// @story: SCRUM-72
// @ac: 2
test('a resubmission that breaks a business rule is refused, the problem is shown and the request stays Rejected', async ({ page }) => {
  const id = await rejectedRequest('Resubmit Bad Times')
  const before = await readAs('org1', id)
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-resubmit-start-time-input').fill('14:00')
  await page.getByTestId('request-detail-resubmit-end-time-input').fill('10:00')
  await page.getByTestId('request-detail-resubmit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Start time must be before the end time.')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-start-time')).toHaveText('10:00')

  const after = await readAs('org1', id)
  expect(after.submitted_at).toBe(before.submitted_at)
  expect(after.decision).toBe('Rejected')
})

// @tc: TC-SCRUM-72-07
// @test: a request that is not Rejected cannot be resubmitted
// @story: SCRUM-72
// @ac: 5
test('a request that is not Rejected cannot be resubmitted', async ({ page }) => {
  await login(page, 'org1')
  await openFromRequestsPage(page, 1)

  await expect(page.getByTestId('request-detail-name')).toHaveText('Annual Dinner')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-resubmit-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-resubmit-name-input')).toHaveCount(0)
})

// @tc: TC-SCRUM-72-08
// @test: a Rejected request that was already resubmitted cannot be resubmitted again from an out-of-date page
// @story: SCRUM-72
// @ac: 5
test('a Rejected request that was already resubmitted cannot be resubmitted again from an out-of-date page', async ({ page }) => {
  // Open the page while the request is Rejected, resubmit it behind the page,
  // then try to resubmit from the page that is now out of date.
  const id = await rejectedRequest('Resubmit Already Done')
  await login(page, 'org1')
  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-resubmit-button')).toBeVisible()
  await resubmitAsOrg1(id, { attendance: 70 })

  await page.getByTestId('request-detail-resubmit-attendance-input').fill('55')
  await page.getByTestId('request-detail-resubmit-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Only a Rejected request can be resubmitted.')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-attendance')).toHaveText('70')

  const after = await readAs('org1', id)
  expect(after.attendance).toBe(70)
})

// @tc: TC-SCRUM-72-09
// @test: an organiser who did not create the request cannot open it to resubmit
// @story: SCRUM-72
// @ac: 5
test('an organiser who did not create the request cannot open it to resubmit', async ({ page }) => {
  const id = await rejectedRequest('Resubmit Other Organiser')
  await login(page, 'org2')
  await page.goto(`/requests/${id}`)

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-resubmit-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-name')).toHaveCount(0)

  const after = await readAs('org1', id)
  expect(after.status).toBe('Rejected')
})

// @tc: TC-SCRUM-72-10
// @test: an Event Coordinator cannot resubmit a Rejected request
// @story: SCRUM-72
// @ac: 5
test('an Event Coordinator cannot resubmit a Rejected request', async ({ page }) => {
  const id = await rejectedRequest('Resubmit By Coordinator')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveText(REASON)
  await expect(page.getByTestId('request-detail-resubmit-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-resubmit-name-input')).toHaveCount(0)
})
