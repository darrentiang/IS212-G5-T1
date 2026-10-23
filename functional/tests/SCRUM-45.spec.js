import { test, expect, request as playwrightRequest } from '@playwright/test'
import { assignAsLead } from './helpers/assign.js'

// SCRUM-45 Request Clarification on a Submitted Request. Curated rows: team test
// sheet, TC-SCRUM-45-01 to 13. Every request a row needs it creates itself through
// the API under the row's own name (org2 submits it, the Lead assigns coord1, the
// parties do whatever the row's Preconditions say) and finds it by its id. org2
// submits so that org1's notifications, which SCRUM-58 reads, stay as seeded.

const BASE_URL = 'http://localhost:5173'

const FIELDS = {
  purpose: 'Client event',
  description: 'An event for SCRUM-45',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 40,
  equipment_requirements: 'Projector',
  registration_needs: 'Guest list supplied',
}

async function login(page, username) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function as(username, work) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })
  expect(resp.ok()).toBeTruthy()
  try {
    return await work(api)
  } finally {
    await api.dispose()
  }
}

function futureDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

// Submitted by org2 and assigned to coord1 by lead1.
async function submittedRequest(name) {
  const id = await as('org2', async (organiser) => {
    const resp = await organiser.post('/api/requests', { data: { name, ...FIELDS, date: futureDate() } })
    expect(resp.status()).toBe(201)
    return (await resp.json()).id
  })
  await assignAsLead(id, 'coord1')
  return id
}

async function askAs(id, message, username = 'coord1') {
  await as(username, async (api) => {
    const asked = await api.post(`/api/requests/${id}/clarification`, { data: { message } })
    expect(asked.status()).toBe(201)
  })
}

async function replyAs(id, message, username = 'org2') {
  await as(username, async (api) => {
    const replied = await api.post(`/api/requests/${id}/clarification/reply`, { data: { message } })
    expect(replied.ok()).toBeTruthy()
  })
}

async function approveAs(id, username = 'coord1') {
  await as(username, async (api) => {
    const approved = await api.post(`/api/requests/${id}/approve`, { data: { reason: '' } })
    expect(approved.ok()).toBeTruthy()
  })
}

async function detail(username, id) {
  return as(username, async (api) => (await api.get(`/api/requests/${id}`)).json())
}

async function noticeCount(username, name) {
  return as(username, async (api) => {
    const notices = await (await api.get('/api/notifications')).json()
    return notices.filter((notice) => notice.message.includes(`"${name}"`)).length
  })
}

const notice = (page, name) => page.locator('[data-testid^="notifications-message-"]', { hasText: `"${name}"` })
const openRequest = async (page, id) => {
  await page.goto(`/requests/${id}`)
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
}

// @tc: TC-SCRUM-45-01
// @test: the assigned coordinator requests clarification and the Organiser sees it
// @story: SCRUM-45
// @ac: 1, 2
test('the assigned coordinator requests clarification and the Organiser sees it', async ({ page }) => {
  const id = await submittedRequest('Clarify Gala')
  await login(page, 'coord1')
  await openRequest(page, id)

  await page.getByTestId('request-detail-clarification-button').click()
  await page.getByTestId('request-detail-clarification-message-input').fill('Please give the guest list size.')
  await page.getByTestId('request-detail-clarification-send-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Clarification requested')
  for (const username of ['coord1', 'org2']) {
    await login(page, username)
    await openRequest(page, id)
    await expect(page.getByTestId('request-detail-status')).toContainText('Submitted')
    await expect(page.getByTestId('request-detail-clarification-flag')).toHaveText('Clarification requested')
    await expect(page.locator('[data-testid^="request-detail-clarification-message-"]:not([data-testid$="-input"]):not([data-testid$="-error"])')).toHaveText(
      'Please give the guest list size.',
    )
  }
  const stored = await detail('coord1', id)
  expect(stored.status).toBe('Submitted')
  expect(stored.name).toBe('Clarify Gala')
  expect(stored.attendance).toBe(40)
})

// @tc: TC-SCRUM-45-02
// @test: the Organiser replies and the wait ends
// @story: SCRUM-45
// @ac: 3
test('the Organiser replies and the wait ends', async ({ page }) => {
  const id = await submittedRequest('Clarify Reply')
  await askAs(id, 'Which room do you prefer?')
  await login(page, 'org2')
  await openRequest(page, id)

  await page.getByTestId('request-detail-clarification-reply-input').fill('The Seminar Room.')
  await page.getByTestId('request-detail-clarification-reply-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Reply sent')
  await page.reload()
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  await expect(page.locator('[data-testid^="request-detail-clarification-reply-"]:not([data-testid*="-by-"])')).toHaveText(
    'The Seminar Room.',
  )
  await expect(page.getByTestId('request-detail-clarification-flag')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-status')).toContainText('Submitted')
  const stored = await detail('org2', id)
  expect([stored.name, stored.attendance, stored.purpose]).toEqual(['Clarify Reply', 40, 'Client event'])
})

// @tc: TC-SCRUM-45-03
// @test: a blank clarification request is refused
// @story: SCRUM-45
// @ac: 1
test('a blank clarification request is refused', async ({ page }) => {
  const id = await submittedRequest('Clarify Blank')
  const before = await noticeCount('org2', 'Clarify Blank')
  await login(page, 'coord1')
  await openRequest(page, id)
  await page.getByTestId('request-detail-clarification-button').click()

  await page.getByTestId('request-detail-clarification-send-button').click()
  await expect(page.getByTestId('request-detail-clarification-message-error')).toHaveText('Say what is missing or unclear.')
  await page.getByTestId('request-detail-clarification-message-input').fill('   ')
  await page.getByTestId('request-detail-clarification-send-button').click()

  await expect(page.getByTestId('request-detail-clarification-message-error')).toHaveText('Say what is missing or unclear.')
  await page.reload()
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  await expect(page.getByTestId('request-detail-clarification-flag')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-status')).toContainText('Submitted')
  expect(await noticeCount('org2', 'Clarify Blank')).toBe(before)
})

// @tc: TC-SCRUM-45-04
// @test: a blank reply is refused and the clarification stays open
// @story: SCRUM-45
// @ac: 3
test('a blank reply is refused and the clarification stays open', async ({ page }) => {
  const id = await submittedRequest('Reply Blank')
  await askAs(id, 'Please confirm the date.')
  const before = await noticeCount('coord1', 'Reply Blank')
  await login(page, 'org2')
  await openRequest(page, id)

  await page.getByTestId('request-detail-clarification-reply-button').click()
  await expect(page.getByTestId('request-detail-clarification-reply-error')).toHaveText('Write a reply.')
  await page.getByTestId('request-detail-clarification-reply-input').fill('   ')
  await page.getByTestId('request-detail-clarification-reply-button').click()

  await expect(page.getByTestId('request-detail-clarification-reply-error')).toHaveText('Write a reply.')
  await page.reload()
  await expect(page.getByTestId('request-detail-clarification-flag')).toHaveText('Clarification requested')
  await expect(page.locator('[data-testid^="request-detail-clarification-reply-"][data-testid$="-by"]')).toHaveCount(0)
  expect(await noticeCount('coord1', 'Reply Blank')).toBe(before)
})

// @tc: TC-SCRUM-45-05
// @test: a second clarification is refused while one is open
// @story: SCRUM-45
// @ac: 4
test('a second clarification is refused while one is open', async ({ page }) => {
  const id = await submittedRequest('Clarify Twice')
  await login(page, 'coord1')
  await openRequest(page, id)
  await page.getByTestId('request-detail-clarification-button').click()
  await page.getByTestId('request-detail-clarification-message-input').fill('Second question')
  await askAs(id, 'First question')
  const before = await noticeCount('org2', 'Clarify Twice')

  await page.getByTestId('request-detail-clarification-send-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('A clarification is already open on this request.')
  await page.reload()
  await expect(page.getByTestId('request-detail-name')).toBeVisible()
  const messages = page.locator('[data-testid^="request-detail-clarification-message-"]')
  await expect(messages).toHaveCount(1)
  await expect(messages).toHaveText('First question')
  expect(await noticeCount('org2', 'Clarify Twice')).toBe(before)
})

// @tc: TC-SCRUM-45-06
// @test: a reply is refused when no clarification is open
// @story: SCRUM-45
// @ac: 4, 6
test('a reply is refused when no clarification is open', async ({ page }) => {
  const id = await submittedRequest('Reply Late')
  await askAs(id, 'Which room?')
  const before = await noticeCount('coord1', 'Reply Late')
  await login(page, 'org2')
  await openRequest(page, id)
  await page.getByTestId('request-detail-clarification-reply-input').fill('Too late?')
  await approveAs(id)

  await page.getByTestId('request-detail-clarification-reply-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('No clarification is open on this request.')
  await page.reload()
  await expect(page.getByTestId('request-detail-status')).toContainText('Approved')
  await expect(page.locator('[data-testid^="request-detail-clarification-reply-"][data-testid$="-by"]')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-clarification-flag')).toHaveCount(0)
  expect(await noticeCount('coord1', 'Reply Late')).toBe(before)
})

// @tc: TC-SCRUM-45-07
// @test: every clarification and reply stays on the request, oldest first, with who and when
// @story: SCRUM-45
// @ac: 5
test('every clarification and reply stays on the request, oldest first, with who and when', async ({ page }) => {
  const id = await submittedRequest('Clarify History')
  await askAs(id, 'Q1')
  await replyAs(id, 'A1')
  await askAs(id, 'Q2')
  await replyAs(id, 'A2')

  for (const username of ['org2', 'coord1']) {
    await login(page, username)
    await openRequest(page, id)

    const rows = page.locator('[data-testid^="request-detail-clarification-row-"]')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Q1')
    await expect(rows.nth(0)).toContainText('A1')
    await expect(rows.nth(1)).toContainText('Q2')
    await expect(rows.nth(1)).toContainText('A2')
    await expect(rows.nth(0).locator('[data-testid^="request-detail-clarification-by-"]')).toHaveText(
      /^coord1, \d{2} \w{3} \d{4}, \d{2}:\d{2}$/,
    )
    await expect(rows.nth(0).locator('[data-testid^="request-detail-clarification-reply-by-"]')).toHaveText(
      /^org2, \d{2} \w{3} \d{4}, \d{2}:\d{2}$/,
    )
  }
})

// @tc: TC-SCRUM-45-08
// @test: approving or rejecting while a clarification is open ends the wait
// @story: SCRUM-45
// @ac: 6
test('approving or rejecting while a clarification is open ends the wait', async ({ page }) => {
  const approveId = await submittedRequest('Decide Approve')
  const rejectId = await submittedRequest('Decide Reject')
  await askAs(approveId, 'Which room?')
  await askAs(rejectId, 'Which room?')
  await login(page, 'coord1')

  await openRequest(page, approveId)
  await page.getByTestId('request-detail-approve-button').click()
  await page.getByTestId('request-detail-approve-confirm-button').click()
  await expect(page.getByTestId('request-detail-status')).toContainText('Approved')
  await openRequest(page, rejectId)
  await page.getByTestId('request-detail-reject-button').click()
  await page.getByTestId('request-detail-reject-reason-input').fill('Capacity cannot be met.')
  await page.getByTestId('request-detail-reject-confirm-button').click()
  await expect(page.getByTestId('request-detail-status')).toContainText('Rejected')

  for (const id of [approveId, rejectId]) {
    await openRequest(page, id)
    await expect(page.getByTestId('request-detail-clarification-flag')).toHaveCount(0)
    await expect(page.locator('[data-testid^="request-detail-clarification-message-"]')).toHaveText('Which room?')
    await expect(page.locator('[data-testid^="request-detail-clarification-reply-"][data-testid$="-by"]')).toHaveCount(0)
  }
})

// @tc: TC-SCRUM-45-09
// @test: a coordinator the event is not assigned to cannot request clarification
// @story: SCRUM-45
// @ac: 7
test('a coordinator the event is not assigned to cannot request clarification', async ({ page }) => {
  const id = await submittedRequest('Clarify Wrong Coordinator')
  const before = await noticeCount('org2', 'Clarify Wrong Coordinator')
  await login(page, 'coord2')

  const refused = await page.request.post(`/api/requests/${id}/clarification`, { data: { message: 'Any news?' } })

  expect(refused.status()).toBe(404)
  expect((await refused.json()).message).toBe('Event request not found.')
  const stored = await detail('coord1', id)
  expect(stored.clarification_requested).toBe(false)
  expect(stored.clarifications).toEqual([])
  expect(await noticeCount('org2', 'Clarify Wrong Coordinator')).toBe(before)
})

// @tc: TC-SCRUM-45-10
// @test: clarification cannot be requested on a request that is not Submitted
// @story: SCRUM-45
// @ac: 7
test('clarification cannot be requested on a request that is not Submitted', async ({ page }) => {
  const id = await submittedRequest('Clarify Approved')
  await approveAs(id)
  const before = await noticeCount('org2', 'Clarify Approved')
  await login(page, 'coord1')
  await openRequest(page, id)
  await expect(page.getByTestId('request-detail-clarification-button')).toHaveCount(0)

  const refused = await page.request.post(`/api/requests/${id}/clarification`, { data: { message: 'Any news?' } })

  expect(refused.status()).toBe(409)
  expect((await refused.json()).message).toBe('Only a Submitted request can have clarification requested.')
  expect((await detail('coord1', id)).status).toBe('Approved')
  expect(await noticeCount('org2', 'Clarify Approved')).toBe(before)
})

// @tc: TC-SCRUM-45-11
// @test: only the Organiser who created the request can reply
// @story: SCRUM-45
// @ac: 7
test('only the Organiser who created the request can reply', async ({ page }) => {
  const id = await submittedRequest('Reply Wrong Organiser')
  await askAs(id, 'Which room?')
  const before = await noticeCount('coord1', 'Reply Wrong Organiser')
  await login(page, 'org1')

  const refused = await page.request.post(`/api/requests/${id}/clarification/reply`, { data: { message: 'I can answer.' } })

  expect(refused.status()).toBe(404)
  expect((await refused.json()).message).toBe('Event request not found.')
  const stored = await detail('coord1', id)
  expect(stored.clarification_requested).toBe(true)
  expect(stored.clarifications.map((row) => row.reply)).toEqual([null])
  expect(await noticeCount('coord1', 'Reply Wrong Organiser')).toBe(before)
})

// @tc: TC-SCRUM-45-12
// @test: the Organiser is notified when clarification is requested
// @story: SCRUM-45
// @ac: 8
test('the Organiser is notified when clarification is requested', async ({ page }) => {
  const id = await submittedRequest('Notify Organiser Ask')
  const before = await noticeCount('org2', 'Notify Organiser Ask')
  await login(page, 'coord1')
  await openRequest(page, id)
  await page.getByTestId('request-detail-clarification-button').click()
  await page.getByTestId('request-detail-clarification-message-input').fill('Please give the guest list size.')
  await page.getByTestId('request-detail-clarification-send-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Clarification requested')

  await login(page, 'org2')
  await page.getByTestId('layout-nav-notifications').click()

  await expect(notice(page, 'Notify Organiser Ask')).toHaveCount(before + 1)
  await expect(notice(page, 'Notify Organiser Ask').first()).toHaveText(
    'Clarification was requested on your request "Notify Organiser Ask".',
  )
  expect(await noticeCount('coord1', 'Notify Organiser Ask')).toBe(1)
  expect(await noticeCount('lead1', 'Notify Organiser Ask')).toBe(0)
})

// @tc: TC-SCRUM-45-13
// @test: the assigned coordinator is notified when the Organiser replies
// @story: SCRUM-45
// @ac: 8
test('the assigned coordinator is notified when the Organiser replies', async ({ page }) => {
  const id = await submittedRequest('Notify Coordinator Reply')
  await askAs(id, 'Which room?')
  const organiserBefore = await noticeCount('org2', 'Notify Coordinator Reply')
  await login(page, 'org2')
  await openRequest(page, id)
  await page.getByTestId('request-detail-clarification-reply-input').fill('The Seminar Room.')
  await page.getByTestId('request-detail-clarification-reply-button').click()
  await expect(page.getByTestId('request-detail-banner')).toHaveText('Reply sent')

  await login(page, 'coord1')
  await page.getByTestId('layout-nav-notifications').click()

  await expect(notice(page, 'Notify Coordinator Reply').first()).toHaveText(
    'org2 replied to your clarification request on "Notify Coordinator Reply".',
  )
  expect(await noticeCount('org2', 'Notify Coordinator Reply')).toBe(organiserBefore)
  expect(await noticeCount('coord2', 'Notify Coordinator Reply')).toBe(0)
})
