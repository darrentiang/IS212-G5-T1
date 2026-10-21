import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-62 Notify on Event Request Decisions. TC-SCRUM-62-01 to 12 (test-case
// sheet), one test per row in the row's order.
//
// Every request a row needs it creates itself under the row's own name
// ("SCRUM-62 TCnn Event"), through the page where the row's steps say so and
// through the API otherwise, and finds it by its id. A notice is found by its
// event's id from the page's own /api/notifications, then checked on the
// Notifications page by its test id: never by counting a shared inbox, and
// never by the event name alone, which a retry's earlier request shares.
// The seed gives org1 its one open Draft, so the two Draft rows use org2.

const BASE_URL = 'http://localhost:5173'

const FIELDS = {
  purpose: 'Alumni dinner',
  description: 'An event for SCRUM-62',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'Projector',
  registration_needs: 'Online sign-up',
}

const received = (name) => `Your request "${name}" was received.`
const assigned = (name, coordinator = 'coord1') => `${coordinator} has been assigned to your event "${name}".`
const approved = (name, reason) => `Your request "${name}" was approved.${reason ? ` Reason: ${reason}` : ''}`
const rejected = (name, reason) => `Your request "${name}" was rejected. Reason: ${reason}`

let contexts = []
let draftsToRemove = []

test.afterEach(async () => {
  // A Draft row leaves org2 without an open Draft, so the next row (or SCRUM-30) can save one.
  if (draftsToRemove.length) {
    const org2 = await apiAs('org2')
    for (const id of draftsToRemove) await org2.delete(`/api/requests/${id}`)
  }
  draftsToRemove = []
  await Promise.all(contexts.map((c) => c.dispose()))
  contexts = []
})

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  contexts.push(api)
  expect((await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })).status()).toBe(200)
  return api
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
  await expect(page).toHaveURL(/\/login$/)
}

// A month ahead, so the submission's "not in the past" rule never trips.
function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function submitAs(organiser, name) {
  const api = await apiAs(organiser)
  const resp = await api.post('/api/requests', { data: { name, ...FIELDS, date: futureDate() } })
  expect(resp.status()).toBe(201)
  return (await resp.json()).id
}

async function decideAs(coordinator, id, action, reason) {
  const api = await apiAs(coordinator)
  const resp = await api.post(`/api/requests/${id}/${action}`, { data: reason ? { reason } : {} })
  expect(resp.status()).toBe(200)
}

// The signed-in account's notifications about the event, oldest first, as the page's own API reads them.
async function noticesAbout(page, id) {
  const reply = await page.request.get('/api/notifications')
  expect(reply.status()).toBe(200)
  return (await reply.json()).filter((row) => row.event_request_id === id).sort((a, b) => a.id - b.id)
}

// Notices that name the event in their text, for an account that may not open it (no event id is sent).
async function noticesNaming(page, name) {
  const reply = await page.request.get('/api/notifications')
  expect(reply.status()).toBe(200)
  return (await reply.json()).filter((row) => row.message.includes(`"${name}"`))
}

async function openNotifications(page) {
  await page.getByTestId('layout-nav-notifications').click()
  await expect(page.getByTestId('notifications-title')).toBeVisible()
}

// One notice as the Notifications page shows it: its message word for word, Unread, and the event named as a link.
async function expectNoticeShown(page, notice, message, eventName) {
  await expect(page.getByTestId(`notifications-message-${notice.id}`)).toHaveText(message)
  await expect(page.getByTestId(`notifications-status-${notice.id}`)).toHaveText('Unread')
  await expect(page.getByTestId(`notifications-event-${notice.id}`)).toHaveText(eventName)
}

async function fillNewRequest(page, name, { skip = [] } = {}) {
  const values = {
    name,
    purpose: FIELDS.purpose,
    description: FIELDS.description,
    date: futureDate(),
    'start-time': FIELDS.start_time,
    'end-time': FIELDS.end_time,
    attendance: String(FIELDS.attendance),
    'equipment-requirements': FIELDS.equipment_requirements,
    'registration-needs': FIELDS.registration_needs,
  }
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()
  for (const [field, value] of Object.entries(values)) {
    if (!skip.includes(field)) await page.getByTestId(`request-new-${field}-input`).fill(value)
  }
}

const idFromUrl = (page) => Number(new URL(page.url()).pathname.split('/').pop())

// @tc: TC-SCRUM-62-01
// @test: submitting a new request directly notifies its organiser once that it was received
// @story: SCRUM-62
// @ac: 1, 8
test('submitting a new request directly notifies its organiser once that it was received', async ({ page }) => {
  const name = 'SCRUM-62 TC01 Event'
  await login(page, 'org1')

  await fillNewRequest(page, name)
  await page.getByTestId('request-new-submit-button').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  const id = idFromUrl(page)
  await openNotifications(page)

  const notices = await noticesAbout(page, id)
  expect(notices.map((row) => row.message)).toEqual([received(name)])
  await expectNoticeShown(page, notices[0], received(name), name)
  await page.getByTestId(`notifications-event-${notices[0].id}`).click()
  await expect(page).toHaveURL(new RegExp(`/requests/${id}$`))
})

// @tc: TC-SCRUM-62-02
// @test: submitting a saved draft notifies its organiser once that it was received
// @story: SCRUM-62
// @ac: 1, 8
test('submitting a saved draft notifies its organiser once that it was received', async ({ page }) => {
  const name = 'SCRUM-62 TC02 Event'
  const org2 = await apiAs('org2')
  const saved = await org2.post('/api/requests/draft', { data: { name, ...FIELDS, date: futureDate() } })
  expect(saved.status()).toBe(201)
  const id = (await saved.json()).id
  draftsToRemove.push(id)
  await login(page, 'org2')
  expect(await noticesAbout(page, id)).toEqual([])

  await page.goto(`/requests/${id}`)
  await page.getByTestId('request-detail-submit-button').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  draftsToRemove = []
  await openNotifications(page)

  const notices = await noticesAbout(page, id)
  expect(notices.map((row) => row.message)).toEqual([received(name)])
  await expectNoticeShown(page, notices[0], received(name), name)
})

// @tc: TC-SCRUM-62-03
// @test: resubmitting a rejected request notifies its organiser that it was received again
// @story: SCRUM-62
// @ac: 1, 8
test('resubmitting a rejected request notifies its organiser that it was received again', async ({ page }) => {
  const name = 'SCRUM-62 TC03 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await decideAs('coord1', id, 'reject', 'Date clashes with exams')
  await login(page, 'org1')
  await page.goto(`/requests/${id}`)

  await page.getByTestId('request-detail-resubmit-attendance-input').fill('35')
  await page.getByTestId('request-detail-resubmit-button').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
  await openNotifications(page)

  const notices = await noticesAbout(page, id)
  expect(notices.map((row) => row.message)).toEqual([
    received(name),
    assigned(name),
    rejected(name, 'Date clashes with exams'),
    received(name),
  ])
  await expectNoticeShown(page, notices[3], received(name), name)
  await expect(page.getByTestId(`notifications-message-${notices[2].id}`)).toHaveText(
    rejected(name, 'Date clashes with exams')
  )
})

// @tc: TC-SCRUM-62-04
// @test: assigning a coordinator from the unassigned queue notifies the organiser naming the coordinator
// @story: SCRUM-62
// @ac: 2, 8
test('assigning a coordinator from the unassigned queue notifies the organiser naming the coordinator', async ({
  page,
}) => {
  const name = 'SCRUM-62 TC04 Event'
  const id = await submitAs('org1', name)
  await login(page, 'lead1')
  const coordinators = await (await page.request.get('/api/assignments/coordinators')).json()
  const coord1 = coordinators.find((row) => row.username === 'coord1')

  await expect(page.getByTestId(`assignment-queue-row-${id}`)).toBeVisible()
  await page.getByTestId(`assignment-queue-coordinator-input-${id}`).selectOption(String(coord1.id))
  await page.getByTestId(`assignment-queue-assign-button-${id}`).click()
  await expect(page.getByTestId('assignment-queue-banner')).toHaveText(`${name} assigned to coord1`)
  await logout(page)
  await login(page, 'org1')
  await openNotifications(page)

  const notices = (await noticesAbout(page, id)).filter((row) => row.message.includes('has been assigned'))
  expect(notices.map((row) => row.message)).toEqual([assigned(name)])
  await expectNoticeShown(page, notices[0], assigned(name), name)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-assigned-coordinator')).toHaveText('coord1')
})

// @tc: TC-SCRUM-62-05
// @test: approving a request with a reason notifies the organiser with that reason
// @story: SCRUM-62
// @ac: 3, 8
test('approving a request with a reason notifies the organiser with that reason', async ({ page }) => {
  const name = 'SCRUM-62 TC05 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}`)

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-reason-input').fill('Fits the calendar.')
  await page.getByTestId('request-detail-approve-confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await logout(page)
  await login(page, 'org1')
  await openNotifications(page)

  const notices = (await noticesAbout(page, id)).filter((row) => row.message.includes('was approved'))
  expect(notices.map((row) => row.message)).toEqual([approved(name, 'Fits the calendar.')])
  await expectNoticeShown(page, notices[0], approved(name, 'Fits the calendar.'), name)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
})

// @tc: TC-SCRUM-62-06
// @test: approving a request without a reason notifies the organiser with no reason part
// @story: SCRUM-62
// @ac: 3
test('approving a request without a reason notifies the organiser with no reason part', async ({ page }) => {
  const name = 'SCRUM-62 TC06 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}`)

  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await logout(page)
  await login(page, 'org1')
  await openNotifications(page)

  const notices = (await noticesAbout(page, id)).filter((row) => row.message.includes('was approved'))
  expect(notices.map((row) => row.message)).toEqual([approved(name)])
  await expectNoticeShown(page, notices[0], approved(name), name)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
})

// @tc: TC-SCRUM-62-07
// @test: rejecting a request notifies the organiser of the rejection with its reason
// @story: SCRUM-62
// @ac: 4, 8
test('rejecting a request notifies the organiser of the rejection with its reason', async ({ page }) => {
  const name = 'SCRUM-62 TC07 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}`)

  await page.getByTestId('request-detail-reject-button').click()
  await page.getByTestId('request-detail-reject-reason-input').fill('Date clashes with exams')
  await page.getByTestId('request-detail-reject-confirm-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
  await logout(page)
  await login(page, 'org1')
  await openNotifications(page)

  const notices = (await noticesAbout(page, id)).filter((row) => row.message.includes('was rejected'))
  expect(notices.map((row) => row.message)).toEqual([rejected(name, 'Date clashes with exams')])
  await expectNoticeShown(page, notices[0], rejected(name, 'Date clashes with exams'), name)
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Rejected')
})

// @tc: TC-SCRUM-62-08
// @test: only the organiser who created the request receives its notices
// @story: SCRUM-62
// @ac: 5
test('only the organiser who created the request receives its notices', async ({ page }) => {
  const name = 'SCRUM-62 TC08 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await decideAs('coord1', id, 'approve', 'Fits the calendar.')

  await login(page, 'org1')
  await openNotifications(page)
  expect((await noticesAbout(page, id)).map((row) => row.message)).toEqual([
    received(name),
    assigned(name),
    approved(name, 'Fits the calendar.'),
  ])
  await logout(page)

  for (const other of ['org2', 'coord2', 'lead1']) {
    await login(page, other)
    await openNotifications(page)
    expect(await noticesNaming(page, name), `${other} is told nothing about ${name}`).toEqual([])
    await logout(page)
  }

  // coord1 has only SCRUM-86's own notice that the event was assigned to them.
  await login(page, 'coord1')
  await openNotifications(page)
  expect((await noticesAbout(page, id)).map((row) => row.message)).toEqual([
    `You have been assigned the event "${name}".`,
  ])
})

// @tc: TC-SCRUM-62-09
// @test: saving a request as a draft creates no notification
// @story: SCRUM-62
// @ac: 6
test('saving a request as a draft creates no notification', async ({ page }) => {
  const name = 'SCRUM-62 TC09 Event'
  await login(page, 'org2')

  await fillNewRequest(page, name)
  await page.getByTestId('request-new-save-draft-button').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')
  const id = idFromUrl(page)
  draftsToRemove.push(id)
  await openNotifications(page)

  expect(await noticesAbout(page, id)).toEqual([])
  expect(await noticesNaming(page, name)).toEqual([])
})

// @tc: TC-SCRUM-62-10
// @test: a submission refused for a missing required field creates no request and no notification
// @story: SCRUM-62
// @ac: 6
test('a submission refused for a missing required field creates no request and no notification', async ({
  page,
}) => {
  const name = 'SCRUM-62 TC10 Event'
  await login(page, 'org1')
  await fillNewRequest(page, name, { skip: ['attendance'] })

  // The page stops a blank required field before sending, so the submission goes to the API directly.
  const refused = await page.request.post('/api/requests', {
    data: { name, ...FIELDS, attendance: '', date: futureDate() },
  })
  expect(refused.status()).toBe(400)
  expect((await refused.json()).message).toMatch(/attendance/i)

  await page.getByTestId('layout-nav-requests').click()
  const mine = await (await page.request.get('/api/requests')).json()
  expect(mine.filter((row) => row.name === name)).toEqual([])
  await openNotifications(page)
  expect(await noticesNaming(page, name)).toEqual([])
})

// @tc: TC-SCRUM-62-11
// @test: a decision refused because the coordinator is not assigned creates no notification
// @story: SCRUM-62
// @ac: 6
test('a decision refused because the coordinator is not assigned creates no notification', async ({ page }) => {
  const name = 'SCRUM-62 TC11 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await login(page, 'coord2')

  const approve = await page.request.post(`/api/requests/${id}/approve`, { data: {} })
  const reject = await page.request.post(`/api/requests/${id}/reject`, { data: { reason: 'Not mine' } })
  expect(approve.ok()).toBe(false)
  expect(reject.ok()).toBe(false)
  await logout(page)

  await login(page, 'org1')
  await openNotifications(page)
  expect((await noticesAbout(page, id)).map((row) => row.message)).toEqual([received(name), assigned(name)])
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
})

// @tc: TC-SCRUM-62-12
// @test: repeating an approval refused because the request is already approved adds no notification
// @story: SCRUM-62
// @ac: 3, 7
test('repeating an approval refused because the request is already approved adds no notification', async ({
  page,
}) => {
  const name = 'SCRUM-62 TC12 Event'
  const id = await submitAs('org1', name)
  await assignAsLead(id, 'coord1')
  await decideAs('coord1', id, 'approve', 'Fits the calendar.')
  await login(page, 'coord1')
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')

  await expect(page.getByTestId('request-detail-approve-button')).toHaveCount(0)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const again = await page.request.post(`/api/requests/${id}/approve`, { data: {} })
    expect(again.status()).toBe(409)
  }
  await logout(page)

  await login(page, 'org1')
  await openNotifications(page)
  const approvals = (await noticesAbout(page, id)).filter((row) => row.message.includes('was approved'))
  expect(approvals.map((row) => row.message)).toEqual([approved(name, 'Fits the calendar.')])
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-status')).toHaveText('Approved')
})
