import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// Curated rows: team test sheet — SCRUM-29 Approve or Reject Event Request.
// SCRUM-86: approving assigns no one, so an approved request stays Approved.
// Seeded Annual Dinner (/requests/1, Submitted, coord1's) and Open House
// (/requests/4, Confirmed, coord2's) are only read here, never decided. Every request a test decides
// it creates itself through the API as org1, under its own name.

const BASE_URL = 'http://localhost:5173'

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

async function submitAsOrg1(name) {
  const api = await apiAs('org1')
  const resp = await api.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for SCRUM-29',
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
  await assignAsLead(id) // SCRUM-87: only the assigned coordinator decides
  return id
}

async function decideAsCoord1(id, action, reason) {
  const api = await apiAs('coord1')
  const resp = await api.post(`/api/requests/${id}/${action}`, { data: { reason } })
  expect(resp.ok()).toBeTruthy()
  await api.dispose()
}

async function openFromRequestsPage(page, id) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId(`requests-row-${id}`).getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
}

// @tc: TC-SCRUM-29-01
// @test: coordinator sees every submitted field, the submission date and time and the organiser before deciding
// @story: SCRUM-29
// @ac: 2
test('coordinator sees every submitted field, the submission date and time and the organiser before deciding', async ({ page }) => {
  await login(page, 'coord1')
  await openFromRequestsPage(page, 1)

  await expect(page.getByTestId('request-detail-name')).toHaveText('Annual Dinner')
  for (const field of [
    'purpose',
    'description',
    'date',
    'start-time',
    'end-time',
    'attendance',
    'equipment-requirements',
    'registration-needs',
  ]) {
    await expect(page.getByTestId(`request-detail-${field}`)).not.toBeEmpty()
  }
  await expect(page.getByTestId('request-detail-submitted-at')).toHaveText('01 Sep 2026, 10:00')
  await expect(page.getByTestId('request-detail-created-by')).toHaveText('org1')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-approve-button')).toBeVisible()
  await expect(page.getByTestId('request-detail-reject-button')).toBeVisible()
})

// @tc: TC-SCRUM-29-02
// @test: coordinator approves a Submitted request without a reason
// @story: SCRUM-29
// @ac: 1, 3, 5
test('coordinator approves a Submitted request without a reason', async ({ page }) => {
  const id = await submitAsOrg1('Approval Without Reason')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decision')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decided-at')).toHaveText(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}$/)
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText('coord1')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveCount(0)
})

// @tc: TC-SCRUM-29-03
// @test: coordinator approves a Submitted request with an optional reason
// @story: SCRUM-29
// @ac: 1, 3, 5
test('coordinator approves a Submitted request with an optional reason', async ({ page }) => {
  const id = await submitAsOrg1('Approval With Reason')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-reason-input').fill('Fits the autumn calendar.')
  await page.getByTestId('request-detail-approve-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveText('Fits the autumn calendar.')
  await expect(page.getByTestId('request-detail-decided-at')).toHaveText(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}$/)
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText('coord1')
})

// @tc: TC-SCRUM-29-04
// @test: coordinator rejects a Submitted request with a reason
// @story: SCRUM-29
// @ac: 1, 4, 5
test('coordinator rejects a Submitted request with a reason', async ({ page }) => {
  const id = await submitAsOrg1('Rejection With Reason')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-reject-button').click()
  await page.getByTestId('request-detail-reject-reason-input').fill('Venue capacity cannot be met.')
  await page.getByTestId('request-detail-reject-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveText('Venue capacity cannot be met.')
  await expect(page.getByTestId('request-detail-decided-at')).toHaveText(/^\d{2} \w{3} \d{4}, \d{2}:\d{2}$/)
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText('coord1')
})

// @tc: TC-SCRUM-29-05
// @test: the submitting organiser sees the decision, the resulting status and the reason
// @story: SCRUM-29
// @ac: 6
test('the submitting organiser sees the decision, the resulting status and the reason', async ({ page }) => {
  const id = await submitAsOrg1('Organiser Sees Reject')
  await decideAsCoord1(id, 'reject', 'Venue capacity cannot be met.')
  await login(page, 'org1')
  await openFromRequestsPage(page, id)

  await expect(page.getByTestId('request-detail-decision')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveText('Venue capacity cannot be met.')
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-reject-button')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
})

// @tc: TC-SCRUM-29-06
// @test: rejecting without a reason is refused and the request stays Submitted
// @story: SCRUM-29
// @ac: 4
test('rejecting without a reason is refused and the request stays Submitted', async ({ page }) => {
  const id = await submitAsOrg1('Reject Missing Reason')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)

  await page.getByTestId('request-detail-reject-button').click()
  await page.getByTestId('request-detail-reject-confirm-button').click()

  await expect(page.getByTestId('request-detail-reject-reason-error')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-decision')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-decided-at')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-decided-by')).toHaveCount(0)
})

// @tc: TC-SCRUM-29-07
// @test: coordinator cannot decide a request that is not Submitted
// @story: SCRUM-29
// @ac: 1
test('coordinator cannot decide a request that is not Submitted', async ({ page }) => {
  await login(page, 'coord2') // Open House is assigned to coord2 (SCRUM-87)
  await openFromRequestsPage(page, 4)

  await expect(page.getByTestId('request-detail-name')).toHaveText('Open House')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Confirmed')
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-reject-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-decision')).toHaveCount(0)
})

// @tc: TC-SCRUM-29-08
// @test: an organiser cannot approve or reject a request
// @story: SCRUM-29
// @ac: 1
test('an organiser cannot approve or reject a request', async ({ page }) => {
  await login(page, 'org1')
  await openFromRequestsPage(page, 1)

  await expect(page.getByTestId('request-detail-name')).toHaveText('Annual Dinner')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-reject-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-decision')).toHaveCount(0)
})

// @tc: TC-SCRUM-29-09
// @test: a second decision on an already decided request is refused and the existing decision and date are shown
// @story: SCRUM-29
// @ac: 7
test('a second decision on an already decided request is refused and the existing decision and date are shown', async ({ page }) => {
  // The page hides Approve and Reject once a request is decided, so the only
  // way a coordinator can attempt a second decision is from a page opened
  // before the first one landed: open it while Submitted, then record the
  // approval (the precondition) behind the page, then attempt to Reject.
  const id = await submitAsOrg1('Second Decision Blocked')
  await login(page, 'coord1')
  await openFromRequestsPage(page, id)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await decideAsCoord1(id, 'approve')

  await page.getByTestId('request-detail-reject-button').click()
  await page.getByTestId('request-detail-reject-reason-input').fill('Changed my mind.')
  await page.getByTestId('request-detail-reject-confirm-button').click()

  const banner = page.getByTestId('request-detail-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(/^This request has already been decided \(Approved on \d{2} \w{3} \d{4}, \d{2}:\d{2}\)\.$/)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
  const decidedAt = await page.getByTestId('request-detail-decided-at').textContent()
  expect(await banner.textContent()).toContain(decidedAt)

  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decision')).toHaveText('Approved')
  await expect(page.getByTestId('request-detail-decided-at')).toHaveText(decidedAt)
  await expect(page.getByTestId('request-detail-decided-by')).toHaveText('coord1')
  await expect(page.getByTestId('request-detail-decision-reason')).toHaveCount(0)
})
