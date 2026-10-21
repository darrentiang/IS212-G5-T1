import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// Chore: make every action's result visible (ui-guidelines.md §4 and §13).
// Not a story, so there are no rows in the team test sheet; the TC ids below
// are this spec's own. Every request a test decides it creates itself through
// the API as org1, under its own name.
//
// A short window, so the request page is longer than the viewport and has to
// scroll: what is proved here is that the response is in view *despite* that.

const BASE_URL = 'http://localhost:5173'

test.use({ viewport: { width: 1280, height: 600 } })

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

async function submitAsOrg1(name) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  expect((await api.post('/api/login', { data: { username: 'org1', password: 'Passw0rd!' } })).ok()).toBeTruthy()
  const resp = await api.post('/api/requests', {
    data: {
      name,
      purpose: 'Client event',
      description: 'An event for the UI feedback checks',
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

// The banner must not only be in the viewport but clear of the sticky header.
async function expectClearOfHeader(page, locator) {
  const header = await page.locator('header.topbar').boundingBox()
  const box = await locator.boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height)
}

// @tc: TC-UI-FEEDBACK-01
// @test: an inline form opened by a control is in view with its first field focused
// @story: chore-ui-feedback
// @ac: point-of-action
test('an inline form opened by a control is in view with its first field focused', async ({ page }) => {
  const id = await submitAsOrg1('UI Feedback Form')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}`)

  await page.getByTestId('request-detail-approve-button').click()

  const reason = page.getByTestId('request-detail-approve-reason-input')
  await expect(reason).toBeInViewport()
  await expect(reason).toBeFocused()
  await expectClearOfHeader(page, reason)
})

// @tc: TC-UI-FEEDBACK-02
// @test: a banner raised by an action at the bottom of a long page is in view, until dismissed
// @story: chore-ui-feedback
// @ac: banner-visible
test('a banner raised by an action at the bottom of a long page is in view, until dismissed', async ({ page }) => {
  const id = await submitAsOrg1('UI Feedback Banner')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}`)
  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-reason-input').fill('Fits the calendar.')

  // The page is longer than the window, and the user is at its bottom.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  await page.getByTestId('request-detail-approve-confirm-button').click()

  const banner = page.getByTestId('request-detail-banner')
  await expect(banner).toHaveText('Request approved')
  await expect(banner).toHaveAttribute('role', 'status')
  await expect(banner).toBeInViewport()
  await expectClearOfHeader(page, banner)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

  await page.getByTestId('request-detail-banner-dismiss').click()
  await expect(banner).toHaveCount(0)
})
