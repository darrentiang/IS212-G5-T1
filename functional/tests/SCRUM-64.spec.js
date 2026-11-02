import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-64 Notify on Confirmation, Changes and Registration. TC-SCRUM-64-01 to 14
// (test-case sheet), one test per row in the row's order.
//
// Each test stages its own "SCRUM-64 TCnn Event" with fixtures/scrum64.py, and clears it
// afterwards, together with the Attendees att64a, att64b and att64c and the notices its
// actions caused. Every row pins the app's clock to 01 Dec 2026, 09:00. A notice is found by
// the row's own event name, never by counting the whole inbox.

const fixtureScript = fileURLToPath(new URL('../fixtures/scrum64.py', import.meta.url))
const BASE_URL = 'http://localhost:5173'
const NAME = (n) => `SCRUM-64 TC${String(n).padStart(2, '0')} Event`
const PASSWORD = 'Passw0rd!'
let ids
let contexts = []

function stage(n) {
  ids = JSON.parse(execFileSync('python', [fixtureScript, String(n)], { encoding: 'utf8' }))
  return ids
}

test.beforeEach(() => pinClock('2026-12-01T09:00'))
test.afterEach(async () => {
  await Promise.all(contexts.map((api) => api.dispose()))
  contexts = []
  clearClock()
  execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' })
})

async function login(page, username) {
  // A signed-in page is sent away from /login, so drop the previous user's session first.
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill(PASSWORD)
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  contexts.push(api)
  const logged = await api.post('/api/login', { data: { username, password: PASSWORD } })
  expect(logged.ok()).toBeTruthy()
  return api
}

// The event's status as the coordinator's API reads it: what the rows assert on.
async function statusOf(eventId) {
  const api = await apiAs('coord1')
  return (await (await api.get(`/api/requests/${eventId}`)).json()).status
}

async function openRequest(page, eventId, n) {
  await page.goto(`/requests/${eventId}`)
  await expect(page.getByTestId('request-detail-name')).toHaveText(NAME(n))
}

// Signs in as the account and opens Notifications, waiting for the list the page reads.
async function openNotifications(page, username) {
  await login(page, username)
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/notifications') && r.request().method() === 'GET'),
    page.getByTestId('layout-nav-notifications').click(),
  ])
  await expect(page.getByTestId('notifications-title')).toBeVisible()
  // The title shows while the list loads; wait for its rows or its empty message, so a
  // "nobody was notified" check cannot pass against a list that has not rendered yet.
  await expect(page.locator('[data-testid^="notifications-row-"], [data-testid="notifications-empty"]').first()).toBeVisible()
}

// The messages on the page that name this event, newest first.
const messagesAbout = (page, name) =>
  page.locator('[data-testid^="notifications-message-"]').filter({ hasText: name }).allTextContents()

async function expectNotices(page, username, name, expected) {
  await openNotifications(page, username)
  await expect.poll(() => messagesAbout(page, name)).toEqual(expected)
}

// Click Block on a venue page and return the API's reply to the POST it sends.
async function submitBlock(page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/blocks') && r.request().method() === 'POST'),
    page.getByTestId('venue-detail-block-confirm-button').click(),
  ])
  return resp
}

// @tc: TC-SCRUM-64-01
// @test: approving the safety check confirms the event and tells its Organiser once
// @story: SCRUM-64
// @ac: 1, 8
test('approving the safety check confirms the event and tells its Organiser once', async ({ page }) => {
  stage(1)
  await login(page, 'safety1')
  await openRequest(page, ids.event, 1)
  await page.getByTestId('request-detail-safety-approve-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Confirmed')
  await expectNotices(page, 'org1', NAME(1), [
    `Your event "${NAME(1)}" is confirmed: 15 Dec 2026, 10:00–12:00, Auditorium, Seminar Room 1.`,
  ])
  await expectNotices(page, 'org2', NAME(1), [])
})

// @tc: TC-SCRUM-64-02
// @test: accepting a change request tells the Organiser it was accepted, without a reason
// @story: SCRUM-64
// @ac: 2, 8
test('accepting a change request tells the Organiser it was accepted, without a reason', async ({ page }) => {
  stage(2)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 2)
  await page.getByTestId('request-detail-change-accept-button').click()
  await page.getByTestId('request-detail-decide-confirm-button').click()
  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Accepted')
  await expect.poll(() => statusOf(ids.event)).toBe('Approved')
  await expectNotices(page, 'org2', NAME(2), [`Your change request on "${NAME(2)}" was accepted.`])
})

// @tc: TC-SCRUM-64-03
// @test: declining a change request tells the Organiser the coordinator's reason
// @story: SCRUM-64
// @ac: 2, 8
test("declining a change request tells the Organiser the coordinator's reason", async ({ page }) => {
  stage(3)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 3)
  await page.getByTestId('request-detail-change-decline-button').click()
  await page.getByTestId('request-detail-decide-reason-input').fill('Venue is not free on that day.')
  await page.getByTestId('request-detail-decide-confirm-button').click()
  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Declined')
  await expect.poll(() => statusOf(ids.event)).toBe('Planning')
  await expectNotices(page, 'org2', NAME(3), [
    `Your change request on "${NAME(3)}" was declined. Reason: Venue is not free on that day.`,
  ])
})

// @tc: TC-SCRUM-64-04
// @test: declining a withdrawal request tells the Organiser the coordinator's reason
// @story: SCRUM-64
// @ac: 2, 8
test("declining a withdrawal request tells the Organiser the coordinator's reason", async ({ page }) => {
  stage(4)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 4)
  await page.getByTestId('request-detail-change-decline-button').click()
  await page.getByTestId('request-detail-decide-reason-input').fill('Venue already paid for')
  await page.getByTestId('request-detail-decide-confirm-button').click()
  await expect(page.locator('[data-testid^="request-detail-change-status-"]')).toHaveText('Declined')
  await expect.poll(() => statusOf(ids.event)).toBe('Planning')
  await expectNotices(page, 'org2', NAME(4), [
    `Your withdrawal request on "${NAME(4)}" was declined. Reason: Venue already paid for`,
  ])
})

// @tc: TC-SCRUM-64-05
// @test: an accepted change returns a Confirmed event to Planning and warns only the Registered Attendee
// @story: SCRUM-64
// @ac: 3, 7, 8
test('an accepted change returns a Confirmed event to Planning and warns only the Registered Attendee', async ({ page }) => {
  stage(5)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 5)
  await page.getByTestId('request-detail-change-accept-button').click()
  await page.getByTestId('request-detail-decide-confirm-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Planning')
  await expectNotices(page, 'att64a', NAME(5), [`"${NAME(5)}" is back in planning. Its details may change.`])
  await expectNotices(page, 'att64b', NAME(5), [])
})

// @tc: TC-SCRUM-64-06
// @test: a venue block over a Confirmed event's booking warns its Registered Attendee once
// @story: SCRUM-64
// @ac: 3, 8
test("a venue block over a Confirmed event's booking warns its Registered Attendee once", async ({ page }) => {
  stage(6)
  await login(page, 'venue1')
  await page.goto(`/venues/${ids.venue}`)
  await expect(page.getByTestId('venue-detail-fields')).toBeVisible()
  await page.getByTestId('venue-detail-block-button').click()
  await page.getByTestId('venue-detail-block-start-date-input').fill('2026-12-12')
  await page.getByTestId('venue-detail-block-start-time-input').fill('09:00')
  await page.getByTestId('venue-detail-block-end-date-input').fill('2026-12-12')
  await page.getByTestId('venue-detail-block-end-time-input').fill('11:00')
  await page.getByTestId('venue-detail-block-reason-input').fill('Stage repair')
  expect((await submitBlock(page)).status()).toBe(201)
  await expect.poll(() => statusOf(ids.event)).toBe('Planning')
  await expectNotices(page, 'att64a', NAME(6), [`"${NAME(6)}" is back in planning. Its details may change.`])
})

// @tc: TC-SCRUM-64-07
// @test: returning an event from Safety Check to Planning tells no Attendee
// @story: SCRUM-64
// @ac: 3
test('returning an event from Safety Check to Planning tells no Attendee', async ({ page }) => {
  stage(7)
  await login(page, 'safety1')
  await openRequest(page, ids.event, 7)
  await page.getByTestId('request-detail-safety-reject-button').click()
  await page.getByTestId('request-detail-safety-reason-input').fill('Exit route blocked')
  await page.getByTestId('request-detail-safety-reject-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Planning')
  await expectNotices(page, 'att64a', NAME(7), [])
})

// @tc: TC-SCRUM-64-08
// @test: confirming the event again tells the Registered Attendee its current details
// @story: SCRUM-64
// @ac: 1, 4, 8
test('confirming the event again tells the Registered Attendee its current details', async ({ page }) => {
  stage(8)
  await login(page, 'safety1')
  await openRequest(page, ids.event, 8)
  await page.getByTestId('request-detail-safety-approve-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Confirmed')
  await expectNotices(page, 'att64a', NAME(8), [
    `"${NAME(8)}" is confirmed again: 12 Dec 2026, 14:00–16:00, Auditorium, Seminar Room 1.`,
  ])
  await expectNotices(page, 'att64b', NAME(8), [])
  await expectNotices(page, 'org1', NAME(8), [
    `Your event "${NAME(8)}" is confirmed: 12 Dec 2026, 14:00–16:00, Auditorium, Seminar Room 1.`,
  ])
})

// @tc: TC-SCRUM-64-09
// @test: cancelling a Confirmed event tells the Organiser the reason and each Registered Attendee without it
// @story: SCRUM-64
// @ac: 5, 7, 8
test('cancelling a Confirmed event tells the Organiser the reason and each Registered Attendee without it', async ({ page }) => {
  stage(9)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 9)
  await page.getByTestId('request-detail-cancel-button').click()
  await page.getByTestId('request-detail-cancel-reason-input').fill('Speaker unavailable')
  await page.getByTestId('request-detail-cancel-confirm-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Cancelled')
  await expectNotices(page, 'org1', NAME(9), [`Your event "${NAME(9)}" was cancelled. Reason: Speaker unavailable`])
  await expectNotices(page, 'att64a', NAME(9), [`"${NAME(9)}" was cancelled.`])
  await expectNotices(page, 'att64b', NAME(9), [`"${NAME(9)}" was cancelled.`])
  await expectNotices(page, 'att64c', NAME(9), [])
})

// @tc: TC-SCRUM-64-10
// @test: accepting a withdrawal sends the Organiser one cancellation notice and the Attendee a cancellation
// @story: SCRUM-64
// @ac: 2, 5, 7, 8
test('accepting a withdrawal sends the Organiser one cancellation notice and the Attendee a cancellation', async ({ page }) => {
  stage(10)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 10)
  await page.getByTestId('request-detail-change-accept-button').click()
  await page.getByTestId('request-detail-decide-confirm-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Cancelled')
  await openNotifications(page, 'org2')
  await expect.poll(() => messagesAbout(page, NAME(10))).toHaveLength(1)
  const [organiser] = await messagesAbout(page, NAME(10))
  expect(organiser).toMatch(
    new RegExp(`^Your event "${NAME(10)}" was cancelled\\. Reason: Withdrawn at the Event Organiser's request on \\d{2} \\w{3} \\d{4}, \\d{2}:\\d{2}\\. Client cancelled the programme$`),
  )
  await expectNotices(page, 'att64a', NAME(10), [`"${NAME(10)}" was cancelled.`])
})

// @tc: TC-SCRUM-64-11
// @test: registering tells the Attendee the event's name, date, time and venues
// @story: SCRUM-64
// @ac: 6, 8
test("registering tells the Attendee the event's name, date, time and venues", async ({ page }) => {
  stage(11)
  await login(page, 'att1')
  await page.getByTestId('layout-nav-registration').click()
  await page.getByTestId(`registration-register-button-${ids.event}`).click()
  await expect(page.getByTestId(`registration-action-${ids.event}`)).toContainText('Registered')
  await expectNotices(page, 'att1', NAME(11), [
    `You are Registered for "${NAME(11)}": 10 Dec 2026, 19:00–21:00, Seminar Room 1.`,
  ])
})

// @tc: TC-SCRUM-64-12
// @test: an Attendee who withdraws and registers again is told of each step and of a later cancellation
// @story: SCRUM-64
// @ac: 5, 6, 7, 8
test('an Attendee who withdraws and registers again is told of each step and of a later cancellation', async ({ page }) => {
  stage(12)
  await login(page, 'att64a')
  await page.getByTestId('layout-nav-registration').click()
  await page.getByTestId(`registration-register-button-${ids.event}`).click()
  await expect(page.getByTestId(`registration-action-${ids.event}`)).toContainText('Registered')
  await page.getByTestId('layout-nav-registrations').click()
  await page.locator('[data-testid^="registrations-withdraw-button-"]').click()
  await expect(page.locator('[data-testid^="registrations-withdraw-button-"]')).toHaveCount(0)
  await page.getByTestId('layout-nav-registration').click()
  await page.getByTestId(`registration-register-button-${ids.event}`).click()
  await expect(page.getByTestId(`registration-action-${ids.event}`)).toContainText('Registered')
  await login(page, 'coord1')
  await openRequest(page, ids.event, 12)
  await page.getByTestId('request-detail-cancel-button').click()
  await page.getByTestId('request-detail-cancel-reason-input').fill('Venue closed')
  await page.getByTestId('request-detail-cancel-confirm-button').click()
  await expect.poll(() => statusOf(ids.event)).toBe('Cancelled')
  const registered = `You are Registered for "${NAME(12)}": 10 Dec 2026, 19:00–21:00, Seminar Room 1.`
  await expectNotices(page, 'att64a', NAME(12), [
    `"${NAME(12)}" was cancelled.`,
    registered,
    `You are Withdrawn from "${NAME(12)}".`,
    registered,
  ])
})

// @tc: TC-SCRUM-64-13
// @test: a registration refused because the event is full tells the Attendee nothing
// @story: SCRUM-64
// @ac: 6, 7
test('a registration refused because the event is full tells the Attendee nothing', async ({ page }) => {
  stage(13)
  const api = await apiAs('att1')
  const reply = await api.post(`/api/registration/events/${ids.event}/register`)
  expect(reply.status()).toBe(409)
  expect((await reply.json()).message).toBe('This event is full.')
  await expectNotices(page, 'att1', NAME(13), [])
})

// @tc: TC-SCRUM-64-14
// @test: a cancellation refused for a blank reason tells nobody
// @story: SCRUM-64
// @ac: 5, 7
test('a cancellation refused for a blank reason tells nobody', async ({ page }) => {
  stage(14)
  await login(page, 'coord1')
  await openRequest(page, ids.event, 14)
  await page.getByTestId('request-detail-cancel-button').click()
  await page.getByTestId('request-detail-cancel-reason-input').fill('   ')
  await page.getByTestId('request-detail-cancel-confirm-button').click()
  await expect(page.getByTestId('request-detail-cancel-error')).toHaveText('Cancellation reason is required.')
  await expect.poll(() => statusOf(ids.event)).toBe('Confirmed')
  await expectNotices(page, 'org1', NAME(14), [])
  await expectNotices(page, 'att64a', NAME(14), [])
})
