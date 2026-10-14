import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// SCRUM-50 Check Equipment Availability for an Event Period. TC-SCRUM-50-01
// through 12 (test-case sheet), one test per row in the row's order.
//
// The types, events and reservations a row reads are standing data in
// functional/fixtures/scrum50.json, loaded by `seed.py --extra` in the web
// server command (the mechanism SCRUM-49 added). The check changes nothing, so
// none of them is used up by running a row; row 11 proves that.
//
// Rows 08, 09 and 10 open the check from a recorded requirement, which
// SCRUM-48 (record equipment required for an event) has not built. They are
// test.fixme: reported as skipped, never as passed. The same rules are
// proved at the API in backend/tests/test_equipment_availability.py.

async function login(page, username) {
  await page.goto('/login')
  await page.getByTestId('login-username-input').fill(username)
  await page.getByTestId('login-password-input').fill('Passw0rd!')
  await page.getByTestId('login-submit-button').click()
  await expect(page.getByTestId('layout-username')).toHaveText(username)
}

async function openInventory(page) {
  await page.getByTestId('layout-nav-equipment').click()
  await expect(page.getByTestId('equipment-title')).toBeVisible()
}

async function check(page, typeName, start, end) {
  await page.getByTestId('equipment-check-type-input').selectOption({ label: typeName })
  await page.getByTestId('equipment-check-start-input').fill(start)
  await page.getByTestId('equipment-check-end-input').fill(end)
  await page.getByTestId('equipment-check-button').click()
}

async function expectResult(page, { total, reserved, outOfService = '0', available }) {
  await expect(page.getByTestId('equipment-check-result')).toBeVisible()
  await expect(page.getByTestId('equipment-check-total')).toHaveText(total)
  await expect(page.getByTestId('equipment-check-reserved')).toHaveText(reserved)
  await expect(page.getByTestId('equipment-check-out-of-service')).toHaveText(outOfService)
  await expect(page.getByTestId('equipment-check-available')).toHaveText(available)
}

// Read-only snapshot of the reservations of a type, as SCRUM-49's spec does.
function reservationsFor(...typeNames) {
  const helper = fileURLToPath(new URL('./helpers/reservations_json.py', import.meta.url))
  return JSON.parse(execFileSync('python', [helper, ...typeNames], { encoding: 'utf8' }))
}

// @tc: TC-SCRUM-50-01
// @test: Technical Support Staff check a type for a period and see total, reserved, out of service and available units
// @story: SCRUM-50
// @ac: 1, 3, 4
test('Technical Support Staff check a type for a period and see total, reserved, out of service and available units', async ({
  page,
}) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC01 Projector', '2027-02-15T10:00', '2027-02-15T13:00')

  await expectResult(page, { total: '10', reserved: '5', available: '5' })
})

// @tc: TC-SCRUM-50-02
// @test: reserved for the period is the most held at the same time, not the sum
// @story: SCRUM-50
// @ac: 3, 4
test('reserved for the period is the most held at the same time, not the sum', async ({ page }) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC02 Projector', '2027-02-16T09:00', '2027-02-16T12:00')

  await expectResult(page, { total: '10', reserved: '3', available: '7' })
})

// @tc: TC-SCRUM-50-03
// @test: a reservation that only touches the start of the period is not counted
// @story: SCRUM-50
// @ac: 5
test('a reservation that only touches the start of the period is not counted', async ({ page }) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC03 Projector', '2027-02-17T10:00', '2027-02-17T12:00')

  await expectResult(page, { total: '5', reserved: '0', available: '5' })
})

// @tc: TC-SCRUM-50-04
// @test: a reservation that overlaps the period by one minute is counted
// @story: SCRUM-50
// @ac: 3, 5
test('a reservation that overlaps the period by one minute is counted', async ({ page }) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC04 Projector', '2027-02-17T10:00', '2027-02-17T12:00')

  await expectResult(page, { total: '5', reserved: '4', available: '1' })
})

// @tc: TC-SCRUM-50-05
// @test: units available never go below zero
// @story: SCRUM-50
// @ac: 4
test('units available never go below zero', async ({ page }) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC05 Projector', '2027-02-18T10:00', '2027-02-18T12:00')

  await expectResult(page, { total: '3', reserved: '5', available: '0' })
})

// @tc: TC-SCRUM-50-06
// @test: a period whose start equals its end is refused
// @story: SCRUM-50
// @ac: 1
test('a period whose start equals its end is refused', async ({ page }) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC06 Projector', '2027-02-19T10:00', '2027-02-19T10:00')

  await expect(page.getByTestId('equipment-banner')).toHaveText('The start must be before the end.')
  await expect(page.getByTestId('equipment-check-result')).toHaveCount(0)
})

// @tc: TC-SCRUM-50-07
// @test: a period whose start is after its end is refused
// @story: SCRUM-50
// @ac: 1
test('a period whose start is after its end is refused', async ({ page }) => {
  await login(page, 'tech1')
  await openInventory(page)

  await check(page, 'SCRUM-50 TC06 Projector', '2027-02-19T12:00', '2027-02-19T10:00')

  await expect(page.getByTestId('equipment-banner')).toHaveText('The start must be before the end.')
  await expect(page.getByTestId('equipment-check-result')).toHaveCount(0)
})

// @tc: TC-SCRUM-50-08
// @test: opening the check from a recorded requirement uses the event's period and says it is covered
// @story: SCRUM-50
// @ac: 2, 7
test.fixme("opening the check from a recorded requirement uses the event's period and says it is covered", async () => {
  // PENDING SCRUM-48: no equipment requirement can be recorded yet.
})

// @tc: TC-SCRUM-50-09
// @test: a requirement that cannot be fully covered shows how many units short it is
// @story: SCRUM-50
// @ac: 7
test.fixme('a requirement that cannot be fully covered shows how many units short it is', async () => {
  // PENDING SCRUM-48: no equipment requirement can be recorded yet.
})

// @tc: TC-SCRUM-50-10
// @test: the event's own reservation is not counted against its requirement
// @story: SCRUM-50
// @ac: 6
test.fixme("the event's own reservation is not counted against its requirement", async () => {
  // PENDING SCRUM-48: no equipment requirement can be recorded yet.
})

// @tc: TC-SCRUM-50-11
// @test: running the check does not reserve equipment or change anything
// @story: SCRUM-50
// @ac: 8
test('running the check does not reserve equipment or change anything', async ({ page }) => {
  const typeName = 'SCRUM-50 TC11 Projector'
  const before = reservationsFor(typeName)
  expect(before).toHaveLength(1)

  await login(page, 'tech1')
  await openInventory(page)
  await check(page, typeName, '2027-02-23T10:00', '2027-02-23T12:00')
  await expectResult(page, { total: '6', reserved: '2', available: '4' })
  await check(page, typeName, '2027-02-23T10:00', '2027-02-23T12:00')
  await expectResult(page, { total: '6', reserved: '2', available: '4' })

  expect(reservationsFor(typeName)).toEqual(before)
  await page.reload()
  const rows = await (await page.request.get('/api/equipment')).json()
  expect(rows.find((row) => row.name === typeName).total_units).toBe(6)
})

// @tc: TC-SCRUM-50-12
// @test: an Event Coordinator who can view the inventory cannot run the check
// @story: SCRUM-50
// @ac: 9
test('an Event Coordinator who can view the inventory cannot run the check', async ({ page }) => {
  await login(page, 'coord1')
  await openInventory(page)

  await expect(page.getByTestId('equipment-name-1')).toBeVisible()
  await expect(page.getByTestId('equipment-check-form')).toHaveCount(0)
  await expect(page.getByTestId('equipment-check-button')).toHaveCount(0)

  const rows = await (await page.request.get('/api/equipment')).json()
  const type = rows.find((row) => row.name === 'SCRUM-50 TC12 Projector')
  const reply = await page.request.get(
    `/api/equipment/${type.id}/availability?start=2027-02-24T10:00&end=2027-02-24T12:00`,
  )
  expect(reply.status()).toBe(403)
  expect((await reply.json()).message).toBeTruthy()
})
