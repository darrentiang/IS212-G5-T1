import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The freshly reset runner stages each row's own event/types and, where needed,
// SCRUM-81 review-state preconditions in fixtures/scrum48.py. There is no test-only
// product endpoint and no claim that staging proves a future review workflow.
// Direct negative requests retain the authenticated account; route.continue
// modifies only the invalid field and reaches the real backend (never fulfills).
const fixtureScript = fileURLToPath(new URL('../fixtures/scrum48.py', import.meta.url))
test.beforeAll(() => { execFileSync('python', [fixtureScript], { encoding: 'utf8' }) })
test.afterAll(() => { execFileSync('python', [fixtureScript, '--clear'], { encoding: 'utf8' }) })

const baseURL = 'http://localhost:5173'
const prefix = (n) => `SCRUM-48 TC${String(n).padStart(2, '0')}`
const el = (page, suffix) => page.getByTestId(`equipment-requirements-${suffix}`)
async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL })
  expect((await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })).ok()).toBeTruthy()
  return api
}
async function login(page, username = 'coord1') {
  await page.goto('/login'); await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!'); await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}
async function fixture(n) {
  const api = await apiAs('tech1')
  try {
    const events = await (await api.get('/api/equipment/requests')).json()
    const event = events.find((row) => row.name === `${prefix(n)} Event`)
    expect(event).toBeTruthy()
    const types = (await (await api.get('/api/equipment')).json()).filter((row) => row.name.startsWith(`${prefix(n)} `))
    const context = await (await api.get(`/api/requests/${event.id}/equipment`)).json()
    return { event, types, context, path: `/api/requests/${event.id}/equipment` }
  } finally { await api.dispose() }
}
const type = (f, name) => f.types.find((row) => row.name === `${f.event.name.replace(' Event', '')} ${name}`)
const rowFor = (f, name) => f.context.requirements.find((row) => row.equipment_type_id === type(f, name).id)
async function open(page, f, user = 'coord1') {
  await login(page, user)
  await page.getByTestId('layout-nav-equipment-requirements').click()
  await page.getByTestId(`equipment-requests-event-${f.event.id}`).click()
  await expect(el(page, 'timing')).toHaveText('15 Dec 2026, 10:00–12:00')
}
async function record(page, f, name, quantity, technical = '') {
  await el(page, 'add-button').click(); await el(page, 'type-input').selectOption(String(type(f, name).id))
  await el(page, 'quantity-input').fill(String(quantity)); await el(page, 'technical-input').fill(technical)
  await el(page, 'save-button').click()
}
async function read(f) {
  const api = await apiAs('tech1')
  try { return await (await api.get(f.path)).json() } finally { await api.dispose() }
}
function reservations(f) {
  const helper = fileURLToPath(new URL('./helpers/reservations_json.py', import.meta.url))
  return JSON.parse(execFileSync('python', [helper, ...f.types.map((row) => row.name)], { encoding: 'utf8' }))
}
async function assertNoStockSideEffects(f, before) {
  expect(reservations(f)).toEqual(before)
  const api = await apiAs('tech1')
  try {
    const after = await (await api.get('/api/equipment')).json()
    for (const original of f.types) expect(after.find((row) => row.id === original.id).total_units).toBe(original.total_units)
  } finally { await api.dispose() }
}
async function refusedMutations(f, username) {
  const api = await apiAs(username)
  try {
    const row = rowFor(f, 'Projector')
    const replies = [
      await api.post(f.path, { data: { equipment_type_id: type(f, 'Microphones').id, quantity: 1 } }),
      await api.patch(`${f.path}/${row.id}`, { data: { quantity: 3 } }),
      await api.delete(`${f.path}/${row.id}`),
    ]
    for (const reply of replies) { expect(reply.status()).toBe(username === 'coord2' ? 404 : 403); expect((await reply.json()).message).toBeTruthy() }
  } finally { await api.dispose() }
}

// @tc: TC-SCRUM-48-01
// @test: The assigned Coordinator records multiple equipment requirements, including a quantity of one and optional technical requirements.
// @story: SCRUM-48
// @ac: 1, 2, 4, 6
test('The assigned Coordinator records multiple equipment requirements, including a quantity of one and optional technical requirements.', async ({ page }) => {
  const f = await fixture(1); const before = reservations(f); await open(page, f)
  await record(page, f, 'Projector', 1, 'HDMI connection required')
  await expect(el(page, 'banner')).toHaveText('Equipment requirement recorded')
  await record(page, f, 'Microphones', 4)
  await page.reload(); await page.goto(`/requests/${f.event.id}/equipment`)
  const actual = await read(f)
  expect(actual.requirements.map((r) => [r.quantity, r.technical_requirements, r.status])).toEqual([[1, 'HDMI connection required', 'Requested'], [4, '', 'Requested']])
  for (const r of actual.requirements) { await expect(el(page, `quantity-${r.id}`)).toHaveText(String(r.quantity)); await expect(el(page, `status-${r.id}`)).toHaveText('Requested') }
  await expect(el(page, 'no-venues')).toBeVisible(); await expect(el(page, 'status')).toHaveText('Planning')
  await assertNoStockSideEffects(f, before)
})

// @tc: TC-SCRUM-48-02
// @test: Technical Support Staff can view recorded equipment requirements with the event’s timing and Approved venue bookings.
// @story: SCRUM-48
// @ac: 6
test('Technical Support Staff can view recorded equipment requirements with the event’s timing and Approved venue bookings.', async ({ page }) => {
  const f = await fixture(2); await open(page, f, 'tech1'); const row = rowFor(f, 'Projector')
  await expect(el(page, `type-${row.id}`)).toHaveText(type(f, 'Projector').name)
  await expect(el(page, `quantity-${row.id}`)).toHaveText('2'); await expect(el(page, `technical-${row.id}`)).toHaveText('HDMI connection required')
  for (const booking of f.context.approved_venue_bookings) await expect(el(page, `venue-${booking.id}`)).toContainText(booking.venue_name)
  expect(f.context.approved_venue_bookings.map((b) => b.venue_name)).toEqual([`${prefix(2)} Venue A`, `${prefix(2)} Venue B`])
  await expect(page.getByTestId(/^equipment-requirements-venue-/)).toHaveCount(2)
})

// @tc: TC-SCRUM-48-03
// @test: The assigned Coordinator changes a Requested requirement without changing other requirements, stock or reservations.
// @story: SCRUM-48
// @ac: 1, 3, 4, 6
test('The assigned Coordinator changes a Requested requirement without changing other requirements, stock or reservations.', async ({ page }) => {
  const f = await fixture(3); const before = reservations(f); const row = rowFor(f, 'Projector'); await open(page, f)
  await el(page, `edit-${row.id}`).click(); await el(page, 'quantity-input').fill('3'); await el(page, 'technical-input').fill('HDMI connection and remote required'); await el(page, 'save-button').click()
  await expect(el(page, 'banner')).toHaveText('Equipment requirement updated'); await page.reload()
  await expect(el(page, `quantity-${row.id}`)).toHaveText('3'); await expect(el(page, `technical-${row.id}`)).toHaveText('HDMI connection and remote required')
  const actual = await read(f); expect(actual.requirements[0]).toEqual({ ...row, quantity: 3, technical_requirements: 'HDMI connection and remote required' }); expect(actual.requirements[1]).toEqual(rowFor(f, 'Microphones'))
  await assertNoStockSideEffects(f, before)
})

// @tc: TC-SCRUM-48-04
// @test: The assigned Coordinator removes a Requested requirement without changing another requirement, stock or reservations.
// @story: SCRUM-48
// @ac: 1, 3, 4, 6
test('The assigned Coordinator removes a Requested requirement without changing another requirement, stock or reservations.', async ({ page }) => {
  const f = await fixture(4); const before = reservations(f); const row = rowFor(f, 'Projector'); await open(page, f)
  await el(page, `remove-${row.id}`).click(); await el(page, 'confirm-remove-button').click(); await expect(el(page, 'banner')).toContainText('removed'); await page.reload()
  await expect(el(page, `row-${row.id}`)).toHaveCount(0)
  expect((await read(f)).requirements).toEqual([rowFor(f, 'Microphones')]); await assertNoStockSideEffects(f, before)
})

// @tc: TC-SCRUM-48-05
// @test: Zero quantity is refused when adding an equipment requirement.
// @story: SCRUM-48
// @ac: 2, 5
test('Zero quantity is refused when adding an equipment requirement.', async ({ page }) => {
  const f = await fixture(5); await open(page, f); await record(page, f, 'Projector', 0)
  await expect(el(page, 'banner')).toContainText('positive whole number'); await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-06
// @test: A negative quantity is refused when changing an equipment requirement.
// @story: SCRUM-48
// @ac: 2, 5
test('A negative quantity is refused when changing an equipment requirement.', async ({ page }) => {
  const f = await fixture(6); await open(page, f); await el(page, `edit-${rowFor(f, 'Projector').id}`).click(); await el(page, 'quantity-input').fill('-1'); await el(page, 'save-button').click()
  await expect(el(page, 'banner')).toContainText('positive whole number'); await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-07
// @test: A fractional quantity is refused rather than rounded.
// @story: SCRUM-48
// @ac: 2, 5
test('A fractional quantity is refused rather than rounded.', async ({ page }) => {
  const f = await fixture(7); await open(page, f); await el(page, `edit-${rowFor(f, 'Projector').id}`).click(); await el(page, 'quantity-input').fill('1.5'); await el(page, 'save-button').click()
  await expect(el(page, 'banner')).toContainText('positive whole number'); await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-08
// @test: A duplicate equipment type is refused without altering its existing requirement.
// @story: SCRUM-48
// @ac: 2, 5
test('A duplicate equipment type is refused without altering its existing requirement.', async ({ page }) => {
  const f = await fixture(8); await open(page, f)
  await page.route(`**${f.path}`, (route) => route.request().method() === 'POST' ? route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), equipment_type_id: type(f, 'Projector').id }) }) : route.continue())
  await record(page, f, 'Microphones', 3)
  await expect(el(page, 'banner')).toContainText('already recorded'); await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-09
// @test: An unrecognised equipment type is refused without changing recorded requirements.
// @story: SCRUM-48
// @ac: 2, 5
test('An unrecognised equipment type is refused without changing recorded requirements.', async ({ page }) => {
  const f = await fixture(9); await open(page, f)
  await page.route(`**${f.path}`, (route) => route.request().method() === 'POST' ? route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), equipment_type_id: 2147483647 }) }) : route.continue())
  await record(page, f, 'Microphones', 1)
  await expect(el(page, 'banner')).toContainText('recognised equipment type'); await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-10
// @test: Stock availability does not prevent recording requirements or change existing commitments.
// @story: SCRUM-48
// @ac: 2, 4, 6
test('Stock availability does not prevent recording requirements or change existing commitments.', async ({ page }) => {
  const f = await fixture(10); const before = reservations(f); await open(page, f)
  await record(page, f, 'Projector', 1); await expect(el(page, 'banner')).toContainText('recorded'); await record(page, f, 'Microphones', 8); await expect(el(page, 'banner')).toContainText('recorded'); await page.reload()
  const actual = (await read(f)).requirements
  expect(actual.map((r) => [r.quantity, r.status])).toEqual([[1, 'Requested'], [8, 'Requested']]); await assertNoStockSideEffects(f, before)
  for (const row of actual) await expect(el(page, `quantity-${row.id}`)).toHaveText(String(row.quantity))
})

// @tc: TC-SCRUM-48-11
// @test: A different Event Coordinator cannot add, change or remove the event’s equipment requirements.
// @story: SCRUM-48
// @ac: 1, 5
test('A different Event Coordinator cannot add, change or remove the event’s equipment requirements.', async ({ page }) => {
  const f = await fixture(11); await refusedMutations(f, 'coord2'); await open(page, f)
  await expect(el(page, `quantity-${rowFor(f, 'Projector').id}`)).toHaveText('2'); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-12
// @test: Technical Support Staff can view requirements but cannot use the Coordinator’s add, change or remove actions.
// @story: SCRUM-48
// @ac: 1, 5, 6
test('Technical Support Staff can view requirements but cannot use the Coordinator’s add, change or remove actions.', async ({ page }) => {
  const f = await fixture(12); await open(page, f, 'tech1')
  await expect(el(page, 'add-button')).toHaveCount(0); await expect(el(page, `edit-${rowFor(f, 'Projector').id}`)).toHaveCount(0); await expect(el(page, `remove-${rowFor(f, 'Projector').id}`)).toHaveCount(0)
  await refusedMutations(f, 'tech1'); await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})

// @tc: TC-SCRUM-48-13
// @test: Equipment recording is refused while the event is in Safety Check.
// @story: SCRUM-48
// @ac: 1, 5
test('Equipment recording is refused while the event is in Safety Check.', async ({ page }) => {
  const f = await fixture(13); await open(page, f); await expect(el(page, 'add-button')).toHaveCount(0)
  const api = await apiAs('coord1')
  try { const reply = await api.post(f.path, { data: { equipment_type_id: type(f, 'Projector').id, quantity: 1 } }); expect(reply.status()).toBe(409); expect((await reply.json()).message).toContain('Approved or Planning') } finally { await api.dispose() }
  await page.reload(); await expect(el(page, 'status')).toHaveText('Safety Check'); await expect(el(page, 'empty')).toBeVisible(); expect((await read(f)).requirements).toEqual([])
})

// @tc: TC-SCRUM-48-14
// @test: Approved and Declined requirements cannot be changed or removed through the Coordinator’s actions.
// @story: SCRUM-48
// @ac: 3, 5
test('Approved and Declined requirements cannot be changed or removed through the Coordinator’s actions.', async ({ page }) => {
  const f = await fixture(14); await open(page, f); const api = await apiAs('coord1')
  try {
    for (const row of f.context.requirements) {
      await expect(el(page, `edit-${row.id}`)).toHaveCount(0); await expect(el(page, `remove-${row.id}`)).toHaveCount(0)
      for (const reply of [await api.patch(`${f.path}/${row.id}`, { data: { quantity: row.quantity + 1 } }), await api.delete(`${f.path}/${row.id}`)]) {
        expect(reply.status()).toBe(409); expect((await reply.json()).message).toContain('Only Requested')
      }
    }
  } finally { await api.dispose() }
  await page.reload(); expect((await read(f)).requirements).toEqual(f.context.requirements)
})
