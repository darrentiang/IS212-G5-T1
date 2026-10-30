import { test, expect, request as playwrightRequest } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { pinClock, clearClock } from './helpers/clock.js'

// SCRUM-52 Withdraw Equipment from Service. TC-SCRUM-52-01 through 10 (test-case
// sheet), one test per row in the row's order.
//
// Every row uses Stage Speakers, an equipment type fixtures/scrum52.py stages for
// this spec (8 units, Equipment Store B), never the seeded Speakers that
// SCRUM-51's spec reserves. Each test stages its own row's preconditions
// (the units out of service, the row's events, requirements and reservations,
// inserted directly) and clears them afterwards. The app's clock is pinned to
// 1 Dec 2026, 09:00 for every row and cleared before and after each test.

const BASE_URL = 'http://localhost:5173'
const fixtureScript = fileURLToPath(new URL('../fixtures/scrum52.py', import.meta.url))
const fixture = (n, option) =>
  execFileSync('python', [fixtureScript, String(n), ...(option ? [option] : [])], { encoding: 'utf8' })

let currentRow
let contexts = []

// Stages row n and pins the clock; returns the staged ids.
function setup(n) {
  currentRow = n
  pinClock('2026-12-01T09:00')
  return JSON.parse(fixture(n))
}

test.beforeEach(() => clearClock())
test.afterEach(async () => {
  await Promise.all(contexts.map((context) => context.dispose()))
  contexts = []
  if (currentRow) fixture(currentRow, '--clear')
  currentRow = undefined
  clearClock()
})

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function apiAs(username) {
  const api = await playwrightRequest.newContext({ baseURL: BASE_URL })
  contexts.push(api)
  expect((await api.post('/api/login', { data: { username, password: 'Passw0rd!' } })).ok()).toBeTruthy()
  return api
}

async function openEquipment(page) {
  await page.getByTestId('layout-nav-equipment').click()
  await expect(page.getByTestId('equipment-title')).toHaveText('Equipment inventory')
}

async function withdrawOnPage(page, id, quantity, reason) {
  await page.getByTestId(`equipment-withdraw-button-${id}`).click()
  await page.getByTestId('equipment-withdraw-quantity-input').fill(quantity)
  await page.getByTestId('equipment-withdraw-reason-input').fill(reason)
  await page.getByTestId('equipment-withdraw-save-button').click()
}

async function checkAvailability(page) {
  await page.getByTestId('equipment-check-type-input').selectOption({ label: 'Stage Speakers' })
  await page.getByTestId('equipment-check-start-input').fill('2026-12-05T10:00')
  await page.getByTestId('equipment-check-end-input').fill('2026-12-05T12:00')
  await page.getByTestId('equipment-check-button').click()
}

const notificationIds = async (api) => (await (await api.get('/api/notifications')).json()).map((row) => row.id)

// @tc: TC-SCRUM-52-01
// @test: Technical Support withdraws one unit with a reason and availability counts it as out of service
// @story: SCRUM-52
// @ac: 1, 3
test('Technical Support withdraws one unit with a reason and availability counts it as out of service', async ({ page }) => {
  const staged = setup(1)
  await login(page, 'tech1')
  await openEquipment(page)

  await withdrawOnPage(page, staged.type, '1', 'Cone damaged')

  await expect(page.getByTestId('equipment-banner')).toHaveText('Equipment withdrawn from service')
  await expect(page.getByTestId('equipment-shortfalls')).toHaveCount(0)
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('1 out of service')
  await checkAvailability(page)
  await expect(page.getByTestId('equipment-check-total')).toHaveText('8')
  await expect(page.getByTestId('equipment-check-reserved')).toHaveText('7')
  await expect(page.getByTestId('equipment-check-out-of-service')).toHaveText('1')
  await expect(page.getByTestId('equipment-check-available')).toHaveText('0')
})

// @tc: TC-SCRUM-52-02
// @test: a withdrawal with a blank reason is refused
// @story: SCRUM-52
// @ac: 1
test('a withdrawal with a blank reason is refused', async ({ page }) => {
  const staged = setup(2)
  await login(page, 'tech1')
  await openEquipment(page)
  const sent = []
  page.on('request', (req) => { if (req.url().includes('/withdraw')) sent.push(req.url()) })

  await withdrawOnPage(page, staged.type, '1', '')

  await expect(page.getByTestId('equipment-withdraw-reason-error')).toBeVisible()
  expect(sent).toEqual([])
  await page.reload()
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('0 out of service')
})

// @tc: TC-SCRUM-52-03
// @test: a withdrawal of 0 units is refused
// @story: SCRUM-52
// @ac: 2
test('a withdrawal of 0 units is refused', async ({ page }) => {
  const staged = setup(3)
  await login(page, 'tech1')
  await openEquipment(page)

  await withdrawOnPage(page, staged.type, '0', 'Cone damaged')

  await expect(page.getByTestId('equipment-banner')).toHaveText('Quantity must be a whole number from 1 to 8.')
  await expect(page.getByTestId('equipment-withdraw-quantity-input')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('0 out of service')
})

// @tc: TC-SCRUM-52-04
// @test: a withdrawal of more units than are in service is refused
// @story: SCRUM-52
// @ac: 2
test('a withdrawal of more units than are in service is refused', async ({ page }) => {
  const staged = setup(4)
  await login(page, 'tech1')
  await openEquipment(page)

  await withdrawOnPage(page, staged.type, '9', 'Cone damaged')

  await expect(page.getByTestId('equipment-banner')).toHaveText('Quantity must be a whole number from 1 to 8.')
  await page.reload()
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('0 out of service')
})

// @tc: TC-SCRUM-52-05
// @test: a withdrawal leaving fewer units in service than reserved is allowed and lists every event it leaves short
// @story: SCRUM-52
// @ac: 2, 4, 5
test('a withdrawal leaving fewer units in service than reserved is allowed and lists every event it leaves short', async ({ page }) => {
  const staged = setup(5)
  const { events, reservations } = staged
  await login(page, 'tech1')
  await openEquipment(page)

  await withdrawOnPage(page, staged.type, '2', 'Water damage')

  await expect(page.getByTestId('equipment-banner')).toHaveText('Equipment withdrawn from service')
  const listed = [
    ['Stage Show', '05 Dec 2026, 10:00–12:00', '5', 'coord1'],
    ['Late Panel', '05 Dec 2026, 11:00–13:00', '2', 'coord2'],
    ['Morning Talk', '06 Dec 2026, 09:00–11:00', '7', 'coord1'],
  ]
  for (const [name, period, reserved, coordinator] of listed) {
    const id = events[name]
    await expect(page.getByTestId(`equipment-shortfall-name-${id}`)).toHaveText(name)
    await expect(page.getByTestId(`equipment-shortfall-period-${id}`)).toHaveText(period)
    await expect(page.getByTestId(`equipment-shortfall-reserved-${id}`)).toHaveText(reserved)
    await expect(page.getByTestId(`equipment-shortfall-coordinator-${id}`)).toHaveText(coordinator)
  }
  await expect(page.getByTestId(`equipment-shortfall-${events['Small Meetup']}`)).toHaveCount(0)
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('2 out of service')

  for (const [name, quantity] of [['Stage Show', 5], ['Late Panel', 2], ['Morning Talk', 7], ['Small Meetup', 2]]) {
    await page.goto(`/requests/${events[name]}/equipment`)
    const id = reservations[name]
    await expect(page.getByTestId(`equipment-requirements-reservation-${id}`)).toContainText(`Stage Speakers × ${quantity}`)
    await expect(page.getByTestId(`equipment-requirements-reservation-status-${id}`)).toHaveText('Reserved')
  }
})

// @tc: TC-SCRUM-52-06
// @test: each assigned coordinator of a listed event is notified once naming their own listed events
// @story: SCRUM-52
// @ac: 4
test('each assigned coordinator of a listed event is notified once naming their own listed events', async ({ page }) => {
  const staged = setup(6)
  const before = {}
  for (const username of ['coord1', 'coord2', 'tech1']) before[username] = await notificationIds(await apiAs(username))
  const tech = await apiAs('tech1')
  const withdrawn = await tech.post(`/api/equipment/${staged.type}/withdraw`, { data: { quantity: '2', reason: 'Water damage' } })
  expect(withdrawn.status()).toBe(200)

  const expected = {
    coord1: 'Equipment withdrawn from service: Stage Speakers. Reserved units may no longer be covered for '
      + 'Stage Show (05 Dec 2026, 10:00–12:00), Morning Talk (06 Dec 2026, 09:00–11:00).',
    coord2: 'Equipment withdrawn from service: Stage Speakers. Reserved units may no longer be covered for '
      + 'Late Panel (05 Dec 2026, 11:00–13:00).',
  }
  for (const username of ['coord1', 'coord2', 'tech1']) {
    const fresh = (await notificationIds(await apiAs(username))).filter((id) => !before[username].includes(id))
    await login(page, username)
    await page.getByTestId('layout-nav-notifications').click()
    await expect(page.getByTestId('notifications-title')).toBeVisible()
    if (username === 'tech1') {
      expect(fresh).toEqual([])
    } else {
      expect(fresh).toHaveLength(1)
      await expect(page.getByTestId(`notifications-message-${fresh[0]}`)).toHaveText(expected[username])
    }
    await page.getByTestId('layout-logout-button').click()
  }
})

// @tc: TC-SCRUM-52-07
// @test: units out of service are not available when equipment is reserved
// @story: SCRUM-52
// @ac: 3
test('units out of service are not available when equipment is reserved', async ({ page }) => {
  const staged = setup(7)
  const event = staged.events['Extra Talk']
  await login(page, 'tech1')
  await page.goto(`/requests/${event}/equipment`)

  await page.getByTestId(`equipment-requirements-reserve-${staged.requirements['Extra Talk']}`).click()
  await page.getByTestId('equipment-requirements-reservation-save-button').click()

  await expect(page.getByTestId('equipment-requirements-banner'))
    .toHaveText('Insufficient equipment: 0 units available for this period.')
  await expect(page.getByTestId('equipment-requirements-reservation-form')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('equipment-requirements-reservations-empty')).toHaveText('No equipment reservations.')
})

// @tc: TC-SCRUM-52-08
// @test: returning more units than are out of service is refused and returning all counts them as available again
// @story: SCRUM-52
// @ac: 6
test('returning more units than are out of service is refused and returning all counts them as available again', async ({ page }) => {
  const staged = setup(8)
  await login(page, 'tech1')
  await openEquipment(page)

  await page.getByTestId(`equipment-return-button-${staged.type}`).click()
  await page.getByTestId('equipment-return-quantity-input').fill('3')
  await page.getByTestId('equipment-return-save-button').click()
  await expect(page.getByTestId('equipment-banner')).toHaveText('Quantity must be a whole number from 1 to 2.')
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('2 out of service')

  await page.getByTestId('equipment-return-quantity-input').fill('2')
  await page.getByTestId('equipment-return-save-button').click()
  await expect(page.getByTestId('equipment-banner')).toHaveText('Equipment returned to service')
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('0 out of service')
  await checkAvailability(page)
  await expect(page.getByTestId('equipment-check-out-of-service')).toHaveText('0')
})

// @tc: TC-SCRUM-52-09
// @test: a total cannot be lowered below its units out of service plus the most units reserved at one time
// @story: SCRUM-52
// @ac: 7
test('a total cannot be lowered below its units out of service plus the most units reserved at one time', async ({ page }) => {
  const staged = setup(9)
  await login(page, 'tech1')
  await openEquipment(page)

  await page.getByTestId(`equipment-edit-button-${staged.type}`).click()
  await page.getByTestId('equipment-edit-units-input').fill('7')
  await page.getByTestId('equipment-edit-save-button').click()

  await expect(page.getByTestId('equipment-banner')).toHaveText(
    'Total units cannot be reduced below 8 units: 7 are reserved at the same time and 1 is out of service.',
  )
  await page.reload()
  await expect(page.getByTestId(`equipment-units-${staged.type}`)).toHaveText('8 units')
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('1 out of service')
})

// @tc: TC-SCRUM-52-10
// @test: an Event Coordinator sees units out of service but cannot withdraw or return equipment
// @story: SCRUM-52
// @ac: 8
test('an Event Coordinator sees units out of service but cannot withdraw or return equipment', async ({ page }) => {
  const staged = setup(10)
  await login(page, 'coord1')
  await openEquipment(page)

  await expect(page.getByTestId(`equipment-units-${staged.type}`)).toHaveText('8 units')
  await expect(page.getByTestId(`equipment-out-of-service-${staged.type}`)).toHaveText('1 out of service')
  await expect(page.getByTestId(/^equipment-withdraw-button-/)).toHaveCount(0)
  await expect(page.getByTestId(/^equipment-return-button-/)).toHaveCount(0)
})
