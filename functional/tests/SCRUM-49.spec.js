import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-49 Maintain Equipment Inventory. Curated rows: team test sheet,
// TC-SCRUM-49-01 to 12, one test per row in the row's order, each named for
// its Scenario. Fixture types (SCRUM-49 TCxx Projector), their events and
// their event-linked reservations are seeded by the webServer command
// (seed.py --reset && seed.py --extra fixtures/scrum49.json); only the
// inventory interaction under test goes through the UI, everything else is
// set up through the API or the seed (docs/test-cases/AUTOMATION.md).
//
// Method notes (SCRUM-49 plan §7):
// - The form is `noValidate` (the repository's form pattern), so typed
//   fractions reach the server and the SERVER's refusal is what the banner
//   shows — the path SCRUM-75's fractional-capacity row already proves.
// - Time-sensitive rows pin the backend clock via the clock-file override
//   (CONNECTSPHERE_CLOCK_FILE, set for the backend by playwright.config.js);
//   beforeEach/afterEach clear it so no later spec can inherit a frozen time.
// - "Reservations remain unchanged" is proved with the read-only test-side
//   helper tests/helpers/reservations_json.py (no product endpoint); the
//   requirements clauses use the existing requests API as coord1.
// - TC12's sheet expectation is the direct API refusal; the AC7 DISPLAYED
//   message is verified afterwards in the same test by swapping the shared
//   session to coord1 while tech1's already-open form is submitted — the
//   refusal is the real backend's, nothing is mocked.

const BASE_URL = 'http://localhost:5173'
const INVALID = 'Total units must be zero or a positive whole number.'
const belowMinimum = (n) =>
  `Total units cannot be reduced below ${n} units: ${n} units are reserved.`
const PINNED = '2026-12-15T11:00'

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function logout(page) {
  await page.getByTestId('layout-logout-button').click()
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  const resp = await api.post('/api/login', {
    data: { username, password: 'Passw0rd!' },
  })
  expect(resp.ok()).toBeTruthy()
  return api
}

async function findType(api, name) {
  const resp = await api.get('/api/equipment')
  expect(resp.ok()).toBeTruthy()
  const row = (await resp.json()).find((candidate) => candidate.name === name)
  expect(row, `equipment type ${name} should exist`).toBeTruthy()
  return row
}

// Read-only snapshot of every reservation of the named type(s), via the
// test-side helper (same database as the app, opened with mode=ro).
function reservationsFor(...typeNames) {
  const helper = fileURLToPath(new URL('./helpers/reservations_json.py', import.meta.url))
  const stdout = execFileSync('python', [helper, ...typeNames], { encoding: 'utf8' })
  return JSON.parse(stdout)
}

async function requirementsFor(api, eventName) {
  const list = await (await api.get('/api/requests')).json()
  const row = list.find((candidate) => candidate.name === eventName)
  expect(row, `event ${eventName} should exist`).toBeTruthy()
  const detail = await (await api.get(`/api/requests/${row.id}`)).json()
  return detail.equipment_requirements
}

async function openEdit(page, typeId) {
  await page.getByTestId(`equipment-edit-button-${typeId}`).click()
  await expect(page.getByTestId('equipment-edit-units-input')).toBeVisible()
}

async function saveTotal(page, value) {
  await page.getByTestId('equipment-edit-units-input').fill(String(value))
  await page.getByTestId('equipment-edit-save-button').click()
}

test.beforeEach(() => clearClock())
test.afterEach(() => clearClock())

// @tc: TC-SCRUM-49-01
// @test: Technical Support Staff view inventory and change an equipment type's total units.
// @story: SCRUM-49
// @ac: 1, 2, 3, 6
test("Technical Support Staff view inventory and change an equipment type's total units.", async ({ page }) => {
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC01 Projector')
  expect(type.total_units).toBe(5)
  expect(type.description).toBe('Portable projector')
  expect(type.location).toBe('Equipment Store A')
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await expect(page.getByTestId(`equipment-name-${type.id}`)).toHaveText(
    'SCRUM-49 TC01 Projector',
  )
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('5 units')
  await expect(page.getByTestId(`equipment-description-${type.id}`)).toHaveText('Portable projector')
  await expect(page.getByTestId(`equipment-location-${type.id}`)).toHaveText('Equipment Store A')

  await openEdit(page, type.id)
  await saveTotal(page, 8)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('8 units')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('8 units')
  await page.goto('/equipment') // reopen the inventory
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('8 units')
  await expect(page.getByTestId(`equipment-description-${type.id}`)).toHaveText('Portable projector')
  await expect(page.getByTestId(`equipment-location-${type.id}`)).toHaveText('Equipment Store A')
})

// @tc: TC-SCRUM-49-02
// @test: An Event Coordinator can view inventory but is not offered an action to change stock.
// @story: SCRUM-49
// @ac: 1, 7
test('An Event Coordinator can view inventory but is not offered an action to change stock.', async ({ page }) => {
  const api = await apiAs('coord1')
  const type = await findType(api, 'SCRUM-49 TC02 Projector')
  await api.dispose()
  await login(page, 'coord1')
  await page.goto('/equipment')

  const row = page
    .locator('tr[data-testid^="equipment-row-"]')
    .filter({ hasText: 'SCRUM-49 TC02 Projector' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('5 units')
  await expect(page.getByTestId(`equipment-description-${type.id}`)).toHaveText('Ceiling-mounted projector')
  await expect(page.getByTestId(`equipment-location-${type.id}`)).toHaveText('Equipment Store B')
  await expect(
    page.locator('[data-testid^="equipment-edit-button-"]'),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-testid^="equipment-edit-units-"]'),
  ).toHaveCount(0)
})

// @tc: TC-SCRUM-49-03
// @test: Negative total units are refused.
// @story: SCRUM-49
// @ac: 3, 5
test('Negative total units are refused.', async ({ page }) => {
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC03 Projector')
  expect(type.total_units).toBe(5)
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, -1)

  const banner = page.getByTestId('equipment-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(INVALID)

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('5 units')
})

// @tc: TC-SCRUM-49-04
// @test: Zero total units are accepted when no reservations require stock.
// @story: SCRUM-49
// @ac: 2, 3, 6
test('Zero total units are accepted when no reservations require stock.', async ({ page }) => {
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC04 Projector')
  expect(type.total_units).toBe(5)
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 0)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('0 units')
  await page.goto('/equipment') // reopen
  const row = page.locator('tr[data-testid^="equipment-row-"]').filter({
    hasText: 'SCRUM-49 TC04 Projector',
  })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('0 units')
})

// @tc: TC-SCRUM-49-05
// @test: One total unit is accepted when no reservations require more stock.
// @story: SCRUM-49
// @ac: 2, 3, 6
test('One total unit is accepted when no reservations require more stock.', async ({ page }) => {
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC05 Projector')
  expect(type.total_units).toBe(5)
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 1)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('1 unit')
  await page.goto('/equipment')
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('1 unit')
})

// @tc: TC-SCRUM-49-06
// @test: Fractional total units are refused rather than rounded.
// @story: SCRUM-49
// @ac: 3, 5
test('Fractional total units are refused rather than rounded.', async ({ page }) => {
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC06 Projector')
  expect(type.total_units).toBe(5)
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 1.5)

  const banner = page.getByTestId('equipment-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(INVALID)

  await page.reload()
  // Still 5 — not rounded to 1 or 2.
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('5 units')
})

// @tc: TC-SCRUM-49-07
// @test: Stock one unit below the simultaneous reservation minimum is refused.
// @story: SCRUM-49
// @ac: 4, 5
test('Stock one unit below the simultaneous reservation minimum is refused.', async ({ page }) => {
  pinClock(PINNED)
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC07 Projector')
  expect(type.total_units).toBe(10)
  const before = reservationsFor('SCRUM-49 TC07 Projector')
  expect(before).toHaveLength(2) // 2 units + 3 units, overlapping
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 4)

  const banner = page.getByTestId('equipment-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText(belowMinimum(5))

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('10 units')
  expect(reservationsFor('SCRUM-49 TC07 Projector')).toEqual(before)
})

// @tc: TC-SCRUM-49-08
// @test: Stock exactly at the simultaneous reservation minimum is accepted.
// @story: SCRUM-49
// @ac: 2, 4, 6
test('Stock exactly at the simultaneous reservation minimum is accepted.', async ({ page }) => {
  pinClock(PINNED)
  const tech = await apiAs('tech1')
  const type = await findType(tech, 'SCRUM-49 TC08 Projector')
  expect(type.total_units).toBe(10)
  const reservationsBefore = reservationsFor('SCRUM-49 TC08 Projector')
  expect(reservationsBefore).toHaveLength(2)
  await tech.dispose()

  const coordinator = await apiAs('coord1')
  const requirementsBefore = [
    await requirementsFor(coordinator, 'SCRUM-49 TC08 Session A'),
    await requirementsFor(coordinator, 'SCRUM-49 TC08 Session B'),
  ]
  expect(requirementsBefore).toEqual(['Projector', 'Projector'])
  await coordinator.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 5)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('5 units')
  await page.goto('/equipment')
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('5 units')

  expect(reservationsFor('SCRUM-49 TC08 Projector')).toEqual(reservationsBefore)
  const after = await apiAs('coord1')
  expect([
    await requirementsFor(after, 'SCRUM-49 TC08 Session A'),
    await requirementsFor(after, 'SCRUM-49 TC08 Session B'),
  ]).toEqual(requirementsBefore)
  await after.dispose()
})

// @tc: TC-SCRUM-49-09
// @test: Stock one unit above the simultaneous reservation minimum is accepted.
// @story: SCRUM-49
// @ac: 2, 4, 6
test('Stock one unit above the simultaneous reservation minimum is accepted.', async ({ page }) => {
  pinClock(PINNED)
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC09 Projector')
  expect(type.total_units).toBe(10)
  const before = reservationsFor('SCRUM-49 TC09 Projector')
  expect(before).toHaveLength(2)
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 6)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('6 units')
  await page.goto('/equipment')
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('6 units')
  expect(reservationsFor('SCRUM-49 TC09 Projector')).toEqual(before)
})

// @tc: TC-SCRUM-49-10
// @test: Non-overlapping reservations are not added together when reducing stock.
// @story: SCRUM-49
// @ac: 2, 4, 6
test('Non-overlapping reservations are not added together when reducing stock.', async ({ page }) => {
  pinClock(PINNED)
  const api = await apiAs('tech1')
  const type = await findType(api, 'SCRUM-49 TC10 Projector')
  expect(type.total_units).toBe(10)
  const before = reservationsFor('SCRUM-49 TC10 Projector')
  expect(before).toHaveLength(2) // 6 units 12:00-13:00 and 6 units 14:00-15:00
  await api.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  // Peak is 6 (they never overlap), not 12.
  await saveTotal(page, 6)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('6 units')
  await page.goto('/equipment')
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('6 units')
  expect(reservationsFor('SCRUM-49 TC10 Projector')).toEqual(before)
})

// @tc: TC-SCRUM-49-11
// @test: Past and inactive reservations do not prevent reducing stock to zero.
// @story: SCRUM-49
// @ac: 2, 4, 6
test('Past and inactive reservations do not prevent reducing stock to zero.', async ({ page }) => {
  pinClock(PINNED)
  const tech = await apiAs('tech1')
  const type = await findType(tech, 'SCRUM-49 TC11 Projector')
  expect(type.total_units).toBe(10)
  const reservationsBefore = reservationsFor('SCRUM-49 TC11 Projector')
  expect(reservationsBefore).toHaveLength(2)
  expect(reservationsBefore.map((row) => row.status).sort()).toEqual([
    'Released',
    'Reserved',
  ])
  await tech.dispose()

  const coordinator = await apiAs('coord1')
  const requirementsBefore = [
    await requirementsFor(coordinator, 'SCRUM-49 TC11 Past Session'),
    await requirementsFor(coordinator, 'SCRUM-49 TC11 Released Session'),
  ]
  expect(requirementsBefore).toEqual(['Projector', 'Projector'])
  await coordinator.dispose()

  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await saveTotal(page, 0)
  await expect(page.getByTestId('equipment-banner')).toHaveText('Total units updated')

  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('0 units')
  await page.goto('/equipment')
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('0 units')

  expect(reservationsFor('SCRUM-49 TC11 Projector')).toEqual(reservationsBefore)
  const after = await apiAs('coord1')
  expect([
    await requirementsFor(after, 'SCRUM-49 TC11 Past Session'),
    await requirementsFor(after, 'SCRUM-49 TC11 Released Session'),
  ]).toEqual(requirementsBefore)
  await after.dispose()
})

// @tc: TC-SCRUM-49-12
// @test: An Event Coordinator's direct stock-change attempt is refused.
// @story: SCRUM-49
// @ac: 7
test("An Event Coordinator's direct stock-change attempt is refused.", async ({ page }) => {
  const api = await apiAs('coord1')
  const type = await findType(api, 'SCRUM-49 TC12 Projector')
  expect(type.total_units).toBe(5)

  // 1-2. The sheet's direct authenticated request as coord1.
  const resp = await api.patch(`/api/equipment/${type.id}`, {
    data: { total_units: 8 },
  })
  expect(resp.status()).toBe(403)
  const body = await resp.json()
  expect(body.message).toBeTruthy()
  await api.dispose()

  // 3. Reload inventory: the stored total is still 5.
  await login(page, 'coord1')
  await page.goto('/equipment')
  const row = page
    .locator('tr[data-testid^="equipment-row-"]')
    .filter({ hasText: 'SCRUM-49 TC12 Projector' })
  await expect(row).toContainText('5 units')

  // AC7's DISPLAYED message (plan §7): tech1's already-open form is
  // submitted on coord1's real session — the backend's genuine 403, the
  // page's genuine error path, nothing mocked.
  await logout(page)
  await login(page, 'tech1')
  await page.goto('/equipment')
  await openEdit(page, type.id)
  await page.context().request.post('/api/login', {
    data: { username: 'coord1', password: 'Passw0rd!' },
  })
  await page.getByTestId('equipment-edit-save-button').click()

  const banner = page.getByTestId('equipment-banner')
  await expect(banner).toHaveAttribute('role', 'alert')
  await expect(banner).toHaveText('You do not have permission to perform this action.')
  await page.reload()
  await expect(page.getByTestId(`equipment-units-${type.id}`)).toHaveText('5 units')
})
