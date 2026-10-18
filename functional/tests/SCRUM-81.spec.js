import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Independent namespaced records, staged by the same test-only DB fixture
// pattern as SCRUM-48. No product shortcut endpoint; all review steps hit Flask.
const fixtureScript = fileURLToPath(new URL('../fixtures/scrum81.py', import.meta.url))
test.beforeAll(() => execFileSync('python', [fixtureScript], { encoding: 'utf8' }))
test.afterAll(() => execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' }))
const baseURL = 'http://localhost:5173'
const el = (page, suffix) => page.getByTestId(`equipment-requirements-${suffix}`)
async function apiAs(username = 'tech1') {
  const api = await playwrightRequest.newContext({ baseURL })
  expect((await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })).ok()).toBeTruthy()
  return api
}
async function login(page, username = 'tech1') {
  await page.goto('/login'); await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!'); await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}
async function fixture(n) {
  const prefix = `SCRUM-81 TC${String(n).padStart(2, '0')}`
  const api = await apiAs()
  try {
    const event = (await (await api.get('/api/equipment/requests')).json()).find((r) => r.name === `${prefix} Event`)
    expect(event).toBeTruthy()
    const path = `/api/requests/${event.id}/equipment`
    const context = await (await api.get(path)).json()
    const types = (await (await api.get('/api/equipment')).json()).filter((r) => r.name.startsWith(`${prefix} `))
    return { event, path, context, types, projector: context.requirements.find((r) => r.equipment_type_name.endsWith(' Projector')), microphones: context.requirements.find((r) => r.equipment_type_name.endsWith(' Microphones')) }
  } finally { await api.dispose() }
}
async function open(page, f, username = 'tech1') {
  await login(page, username); await page.getByTestId('layout-nav-equipment-requirements').click()
  await page.getByTestId(`equipment-requests-event-${f.event.id}`).click()
  await expect(el(page, 'timing')).toHaveText('15 Dec 2026, 10:00–12:00')
}
async function reopen(page, f) {
  await page.reload(); await expect(el(page, 'timing')).toBeVisible()
  await page.getByTestId('layout-nav-equipment-requirements').click()
  await page.getByTestId(`equipment-requests-event-${f.event.id}`).click()
  await expect(el(page, 'timing')).toBeVisible()
}
async function read(f) {
  const api = await apiAs()
  try { const response = await api.get(f.path); expect(response.ok()).toBeTruthy(); return await response.json() } finally { await api.dispose() }
}
function reservations(f) {
  const script = fileURLToPath(new URL('./helpers/reservations_json.py', import.meta.url))
  return JSON.parse(execFileSync('python', [script, ...f.types.map((r) => r.name)], { encoding: 'utf8' }))
}
async function assertPreserved(f, beforeReservations, changed = {}) {
  const actual = await read(f)
  expect({ ...actual, requirements: undefined }).toEqual({ ...f.context, requirements: undefined })
  expect(actual.requirements).toHaveLength(f.context.requirements.length)
  for (const original of f.context.requirements) {
    const after = { ...actual.requirements.find((r) => r.id === original.id) }
    const before = { ...original }
    for (const key of changed[original.id] || []) { delete after[key]; delete before[key] }
    expect(after).toEqual(before)
  }
  expect(reservations(f)).toEqual(beforeReservations)
  const api = await apiAs()
  try {
    const inventory = await (await api.get('/api/equipment')).json()
    for (const type of f.types) expect(inventory.find((r) => r.id === type.id)).toEqual(type)
  } finally { await api.dispose() }
  return actual
}
const reviewFields = ['status', 'decline_reason', 'decided_by', 'decided_at']
async function decision(page, row, decision, reason = '') {
  await el(page, `${decision === 'Approved' ? 'approve' : 'decline'}-${row.id}`).click()
  if (decision === 'Declined') await el(page, 'review-reason-input').fill(reason)
  await el(page, 'review-save-button').click()
  await expect(el(page, 'banner')).toHaveText(decision === 'Approved' ? 'Equipment requirement approved' : 'Equipment requirement declined')
  await expect(el(page, `status-${row.id}`)).toHaveText(decision)
}
async function note(page, row, text) {
  await el(page, `edit-note-${row.id}`).click(); await el(page, 'review-note-input').fill(text)
  await el(page, 'review-save-button').click(); await expect(el(page, 'banner')).toHaveText('Arrangement note updated')
}
function decisionRecorded(row, earliest) {
  expect(row.decided_by).toBe('tech1'); expect(row.decided_at).toBeTruthy()
  // Backend follows the repo's naive-ISO UTC wire convention.
  const moment = Date.parse(`${row.decided_at}Z`)
  expect(moment).toBeGreaterThanOrEqual(earliest - 1000); expect(moment).toBeLessThanOrEqual(Date.now() + 1000)
}

// @tc: TC-SCRUM-81-01
// @test: Technical Support Staff can view each equipment requirement with the event’s timing and Approved venue bookings.
// @story: SCRUM-81
// @ac: 1
test('Technical Support Staff can view each equipment requirement with the event’s timing and Approved venue bookings.', async ({ page }) => {
  const f = await fixture(1); await open(page, f)
  for (const [row, qty, text] of [[f.projector, 2, 'HDMI connection required'], [f.microphones, 4, 'None']]) {
    await expect(el(page, `type-${row.id}`)).toHaveText(row.equipment_type_name)
    await expect(el(page, `quantity-${row.id}`)).toHaveText(String(qty)); await expect(el(page, `technical-${row.id}`)).toHaveText(text)
  }
  expect(f.context.approved_venue_bookings).toHaveLength(2)
  for (const b of f.context.approved_venue_bookings) await expect(el(page, `venue-${b.id}`)).toContainText(b.venue_name)
  await expect(page.getByTestId(/^equipment-requirements-venue-\d+$/)).toHaveCount(2)
  expect(f.context.approved_venue_bookings.every((b) => !b.venue_name.endsWith(' C'))).toBeTruthy()
})

// @tc: TC-SCRUM-81-02
// @test: Technical Support Staff approve a Requested requirement without reserving equipment or changing other records.
// @story: SCRUM-81
// @ac: 2, 3, 5, 6
test('Technical Support Staff approve a Requested requirement without reserving equipment or changing other records.', async ({ page }) => {
  const f = await fixture(2); const before = reservations(f); await open(page, f); const earliest = Date.now()
  await decision(page, f.projector, 'Approved'); await reopen(page, f)
  await expect(el(page, `status-${f.projector.id}`)).toHaveText('Approved')
  await expect(el(page, `decision-${f.projector.id}`)).toContainText('tech1')
  const actual = await assertPreserved(f, before, { [f.projector.id]: reviewFields })
  decisionRecorded(actual.requirements[0], earliest)
})

// @tc: TC-SCRUM-81-03
// @test: Technical Support Staff decline a Requested requirement with a reason while the event is Approved.
// @story: SCRUM-81
// @ac: 2, 3, 5, 6
test('Technical Support Staff decline a Requested requirement with a reason while the event is Approved.', async ({ page }) => {
  const f = await fixture(3); const before = reservations(f); await open(page, f); const earliest = Date.now()
  const reason = 'The requested HDMI capability cannot be provided.'
  await decision(page, f.projector, 'Declined', reason); await reopen(page, f)
  await expect(el(page, `status-${f.projector.id}`)).toHaveText('Declined')
  await expect(el(page, `decline-reason-${f.projector.id}`)).toContainText(reason)
  const actual = await assertPreserved(f, before, { [f.projector.id]: reviewFields })
  expect(actual.requirements[0].decline_reason).toBe(reason); decisionRecorded(actual.requirements[0], earliest)
})

// @tc: TC-SCRUM-81-04
// @test: A decline with an empty or whitespace-only reason is refused without changing the requirement.
// @story: SCRUM-81
// @ac: 3, 7
test('A decline with an empty or whitespace-only reason is refused without changing the requirement.', async ({ page }) => {
  const f = await fixture(4); const before = reservations(f); await open(page, f)
  await el(page, `decline-${f.projector.id}`).click()
  for (const reason of ['', '   ']) {
    await el(page, 'review-reason-input').fill(reason); await el(page, 'review-save-button').click()
    await expect(el(page, 'review-reason-error')).toHaveText('A decline reason is required.')
  }
  await reopen(page, f); await expect(el(page, `status-${f.projector.id}`)).toHaveText('Requested')
  await assertPreserved(f, before)
})

// @tc: TC-SCRUM-81-05
// @test: Technical Support Staff add and change an arrangement note on a Requested requirement without deciding it.
// @story: SCRUM-81
// @ac: 4, 5, 6
test('Technical Support Staff add and change an arrangement note on a Requested requirement without deciding it.', async ({ page }) => {
  const f = await fixture(5); const before = reservations(f); await open(page, f)
  await note(page, f.projector, 'Checking suitable HDMI projectors.'); await page.reload()
  await expect(el(page, `note-${f.projector.id}`)).toContainText('Checking suitable HDMI projectors.')
  const updated = 'Suitable model identified; reservation not yet made.'
  await note(page, f.projector, updated); await reopen(page, f)
  await expect(el(page, `note-${f.projector.id}`)).toContainText(updated)
  await assertPreserved(f, before, { [f.projector.id]: ['arrangement_note'] })
})

// @tc: TC-SCRUM-81-06
// @test: Technical Support Staff change arrangement notes on Approved and Declined requirements, including an Approved requirement with reserved equipment.
// @story: SCRUM-81
// @ac: 4, 5, 6
test('Technical Support Staff change arrangement notes on Approved and Declined requirements, including an Approved requirement with reserved equipment.', async ({ page }) => {
  const f = await fixture(6); const before = reservations(f); await open(page, f)
  await note(page, f.projector, 'Collect from Equipment Store A.'); await note(page, f.microphones, 'Discuss a wired alternative with the Coordinator.')
  await reopen(page, f)
  await expect(el(page, `note-${f.projector.id}`)).toContainText('Collect from Equipment Store A.')
  await expect(el(page, `note-${f.microphones.id}`)).toContainText('Discuss a wired alternative with the Coordinator.')
  await assertPreserved(f, before, { [f.projector.id]: ['arrangement_note'], [f.microphones.id]: ['arrangement_note'] })
})

// @tc: TC-SCRUM-81-07
// @test: Technical Support Staff correct an Approved requirement to Declined before equipment is reserved.
// @story: SCRUM-81
// @ac: 2, 3, 5, 6
test('Technical Support Staff correct an Approved requirement to Declined before equipment is reserved.', async ({ page }) => {
  const f = await fixture(7); const before = reservations(f); await open(page, f); const earliest = Date.now()
  const reason = 'The required projector model cannot be provided.'
  await decision(page, f.projector, 'Declined', reason); await reopen(page, f)
  await expect(el(page, `status-${f.projector.id}`)).toHaveText('Declined')
  await expect(el(page, `decline-reason-${f.projector.id}`)).toContainText(reason)
  const actual = await assertPreserved(f, before, { [f.projector.id]: reviewFields })
  expect(actual.requirements[0].decline_reason).toBe(reason); decisionRecorded(actual.requirements[0], earliest)
})

// @tc: TC-SCRUM-81-08
// @test: Technical Support Staff correct a Declined requirement to Approved when its earlier reservation has been released.
// @story: SCRUM-81
// @ac: 2, 3, 5, 6
test('Technical Support Staff correct a Declined requirement to Approved when its earlier reservation has been released.', async ({ page }) => {
  const f = await fixture(8); const before = reservations(f); await open(page, f); const earliest = Date.now()
  await decision(page, f.projector, 'Approved'); await reopen(page, f)
  await expect(el(page, `status-${f.projector.id}`)).toHaveText('Approved')
  await expect(el(page, `decline-reason-${f.projector.id}`)).toHaveText('Decline reason: None')
  const actual = await assertPreserved(f, before, { [f.projector.id]: reviewFields })
  expect(actual.requirements[0].decline_reason).toBeNull(); decisionRecorded(actual.requirements[0], earliest)
})

// @tc: TC-SCRUM-81-09
// @test: An unreleased reservation prevents correction of the requirement’s review decision.
// @story: SCRUM-81
// @ac: 2, 6, 7
test('An unreleased reservation prevents correction of the requirement’s review decision.', async ({ page }) => {
  const f = await fixture(9); const before = reservations(f); await open(page, f)
  await expect(el(page, `decline-${f.projector.id}`)).toHaveCount(0)
  await expect(el(page, `review-locked-${f.projector.id}`)).toContainText('locked')
  const reply = await page.request.patch(`${f.path}/${f.projector.id}/decision`, { data: { decision: 'Declined', reason: 'The required model cannot be provided.' } })
  expect(reply.status()).toBe(409); expect((await reply.json()).message).toContain('reservation')
  await reopen(page, f); await expect(el(page, `status-${f.projector.id}`)).toHaveText('Approved')
  await assertPreserved(f, before)
})

// @tc: TC-SCRUM-81-10
// @test: Review decision corrections and arrangement-note changes are refused while the event is in Safety Check.
// @story: SCRUM-81
// @ac: 2, 4, 7
test('Review decision corrections and arrangement-note changes are refused while the event is in Safety Check.', async ({ page }) => {
  const f = await fixture(10); const before = reservations(f); await open(page, f)
  await expect(el(page, `decline-${f.projector.id}`)).toHaveCount(0); await expect(el(page, `edit-note-${f.projector.id}`)).toHaveCount(0)
  for (const [action, data] of [['decision', { decision: 'Declined', reason: 'The required model cannot be provided.' }], ['note', { arrangement_note: 'Use an alternative model.' }]]) {
    const reply = await page.request.patch(`${f.path}/${f.projector.id}/${action}`, { data })
    expect(reply.status()).toBe(409); expect((await reply.json()).message).toContain('Approved or Planning')
  }
  await reopen(page, f); await expect(el(page, 'status')).toHaveText('Safety Check')
  await assertPreserved(f, before)
})

// @tc: TC-SCRUM-81-11
// @test: The assigned Event Coordinator can view saved review outcomes, decline reasons and arrangement notes.
// @story: SCRUM-81
// @ac: 5
test('The assigned Event Coordinator can view saved review outcomes, decline reasons and arrangement notes.', async ({ page }) => {
  const f = await fixture(11); await open(page, f)
  await decision(page, f.projector, 'Approved'); await note(page, f.projector, 'Reservation pending')
  await decision(page, f.microphones, 'Declined', 'Wireless microphones cannot be provided.')
  await note(page, f.microphones, 'Discuss a wired alternative')
  await page.getByTestId('layout-logout-button').click(); await open(page, f, 'coord1'); await reopen(page, f)
  await expect(el(page, `status-${f.projector.id}`)).toHaveText('Approved'); await expect(el(page, `decline-reason-${f.projector.id}`)).toHaveText('Decline reason: None')
  await expect(el(page, `note-${f.projector.id}`)).toContainText('Reservation pending')
  await expect(el(page, `status-${f.microphones.id}`)).toHaveText('Declined'); await expect(el(page, `decline-reason-${f.microphones.id}`)).toContainText('Wireless microphones cannot be provided.')
  await expect(el(page, `note-${f.microphones.id}`)).toContainText('Discuss a wired alternative')
})

// @tc: TC-SCRUM-81-12
// @test: The assigned Event Coordinator can view requirements but cannot make Technical Support decisions or change arrangement notes.
// @story: SCRUM-81
// @ac: 2, 4, 7
test('The assigned Event Coordinator can view requirements but cannot make Technical Support decisions or change arrangement notes.', async ({ page }) => {
  const f = await fixture(12); const before = reservations(f); await open(page, f, 'coord1')
  for (const action of ['approve', 'decline', 'edit-note']) await expect(el(page, `${action}-${f.projector.id}`)).toHaveCount(0)
  for (const [action, data] of [['decision', { decision: 'Approved' }], ['decision', { decision: 'Declined', reason: 'Suitable model unavailable' }], ['note', { arrangement_note: 'Ready for collection' }]]) {
    const reply = await page.request.patch(`${f.path}/${f.projector.id}/${action}`, { data })
    expect(reply.status()).toBe(403); expect((await reply.json()).message).toBeTruthy()
  }
  await reopen(page, f); await expect(el(page, `status-${f.projector.id}`)).toHaveText('Requested')
  await assertPreserved(f, before)
})
