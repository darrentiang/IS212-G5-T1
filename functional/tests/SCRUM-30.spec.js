import { test, expect } from '@playwright/test'

// Curated rows: team test sheet — SCRUM-30 Save Draft Event Request.
// An Organiser may have only one open Draft at a time, so these tests use
// org2 and clean up after themselves, rather than org1, whose one open Draft
// is the seeded "Design Workshop" (read, never changed, by other specs).

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

async function saveDraft(page, overrides = {}) {
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()
  for (const [field, value] of Object.entries(overrides)) {
    await page.getByTestId(`request-new-${field}-input`).fill(value)
  }
  await page.getByTestId('request-new-save-draft-button').click()
  await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')
  return new URL(page.url()).pathname
}

async function deleteDraft(page, path) {
  await page.goto(path)
  await page.getByTestId('request-detail-delete-button').click()
  await page.getByTestId('request-detail-delete-confirm-button').click()
}

// @tc: TC-SCRUM-30-01
// @test: organiser saves a new draft with only a name filled in
// @story: SCRUM-30
// @ac: 1
test('organiser saves a new draft with only a name filled in', async ({ page }) => {
  await login(page, 'org2')
  const path = await saveDraft(page, { name: 'SCRUM-30 Draft Event' })

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Draft saved')
  await expect(page.getByTestId('request-detail-name')).toHaveText('SCRUM-30 Draft Event')

  await deleteDraft(page, path)
})

// @tc: TC-SCRUM-30-02
// @test: a draft can be saved with an invalid attendance value; validation is deferred to submission
// @story: SCRUM-30
// @ac: 6
test('a draft can be saved with an invalid attendance value; validation is deferred to submission', async ({
  page,
}) => {
  await login(page, 'org2')
  const path = await saveDraft(page, { name: 'SCRUM-30 Draft Event', attendance: '-5' })

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Draft saved')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')

  await deleteDraft(page, path)
})

// @tc: TC-SCRUM-30-03
// @test: a draft is not visible to Event Coordinators in their queue or count
// @story: SCRUM-30
// @ac: 2
test('a draft is not visible to Event Coordinators in their queue or count', async ({ page }) => {
  await login(page, 'org2')
  await saveDraft(page, { name: 'SCRUM-30 Draft Event' })

  await logout(page)
  await login(page, 'coord1')
  await page.getByTestId('layout-nav-requests').click()

  await expect(page.getByText('SCRUM-30 Draft Event')).toHaveCount(0)
})

// @tc: TC-SCRUM-30-04
// @test: the creating Organiser can reopen and edit their own draft, including the event name
// @story: SCRUM-30
// @ac: 3
test('the creating Organiser can reopen and edit their own draft, including the event name', async ({ page }) => {
  // Continues the draft TC-SCRUM-30-03 left open for org2.
  await login(page, 'org2')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByText('SCRUM-30 Draft Event').click()

  await page.getByTestId('request-detail-edit-button').click()
  const nameInput = page.getByTestId('request-detail-edit-name-input')
  await nameInput.fill('SCRUM-30 Draft Event (Updated)')
  await page.getByTestId('request-detail-edit-confirm-button').click()

  await expect(page.getByTestId('request-detail-banner')).toHaveText('Draft updated')
  await expect(page.getByTestId('request-detail-name')).toHaveText('SCRUM-30 Draft Event (Updated)')
  await expect(page.getByTestId('request-detail-status')).toHaveText('Draft')
})

// @tc: TC-SCRUM-30-05
// @test: the creating Organiser can permanently delete their own draft
// @story: SCRUM-30
// @ac: 3, 8
test("the creating Organiser can permanently delete their own draft", async ({ page }) => {
  // Continues the draft TC-SCRUM-30-04 left open for org2, now renamed.
  await login(page, 'org2')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByText('SCRUM-30 Draft Event (Updated)').click()

  const path = new URL(page.url()).pathname
  await page.getByTestId('request-detail-delete-button').click()
  await page.getByTestId('request-detail-delete-confirm-button').click()

  await expect(page.getByTestId('requests-banner')).toHaveText('Draft deleted')
  await expect(page.getByText('SCRUM-30 Draft Event (Updated)')).toHaveCount(0)

  await page.goto(path)
  await expect(page.getByTestId('request-detail-banner')).toHaveText(/not found/i)
})

// @tc: TC-SCRUM-30-06
// @test: a different Organiser cannot view, edit, or delete another Organiser's draft
// @story: SCRUM-30
// @ac: 3, 10
test("a different Organiser cannot view, edit, or delete another Organiser's draft", async ({ page }) => {
  await login(page, 'org2')
  const path = await saveDraft(page, { name: 'Cross Access Draft' })

  await logout(page)
  await login(page, 'org1')
  await page.goto(path)

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-edit-button')).toHaveCount(0)
  await expect(page.getByTestId('request-detail-delete-button')).toHaveCount(0)

  await logout(page)
  await login(page, 'org2')
  await deleteDraft(page, path)
})

// @tc: TC-SCRUM-30-07
// @test: a Coordinator cannot view a draft's detail directly by ID
// @story: SCRUM-30
// @ac: 10
test("a Coordinator cannot view a draft's detail directly by ID", async ({ page }) => {
  await login(page, 'org2')
  const path = await saveDraft(page, { name: 'Coordinator Blocked Draft' })

  await logout(page)
  await login(page, 'coord1')
  await page.goto(path)

  await expect(page.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('request-detail-fields')).toHaveCount(0)

  await logout(page)
  await login(page, 'org2')
  await deleteDraft(page, path)
})

// @tc: TC-SCRUM-30-08
// @test: a submitted request can no longer be deleted as a draft
// @story: SCRUM-30
// @ac: 4
test('a submitted request can no longer be deleted as a draft', async ({ page }) => {
  await login(page, 'org1')
  await page.goto('/requests/1') // seeded "Annual Dinner", status Submitted

  await expect(page.getByTestId('request-detail-status')).toHaveText('Submitted')
  await expect(page.getByTestId('request-detail-delete-button')).toHaveCount(0)
})

// @tc: TC-SCRUM-30-09
// @test: an Organiser cannot save a second draft while one is already open
// @story: SCRUM-30
// @ac: 7
test('an Organiser cannot save a second draft while one is already open', async ({ page }) => {
  await login(page, 'org2')
  const path = await saveDraft(page, { name: 'SCRUM-30 Draft Event' })

  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()
  await page.getByTestId('request-new-name-input').fill('Second Event')
  await page.getByTestId('request-new-save-draft-button').click()

  await expect(page.getByTestId('request-new-banner')).toHaveText(/already have an open draft/i)
  await expect(page).toHaveURL(/\/requests\/new$/)

  await deleteDraft(page, path)
})

// @tc: TC-SCRUM-30-10
// @test: a draft cannot be saved with no fields at all, not even a name
// @story: SCRUM-30
// @ac: 9
test('a draft cannot be saved with no fields at all, not even a name', async ({ page }) => {
  await login(page, 'org2')
  await page.getByTestId('layout-nav-requests').click()
  await page.getByTestId('requests-new-button').click()

  await page.getByTestId('request-new-save-draft-button').click()

  await expect(page.getByTestId('request-new-name-error')).toBeVisible()
  await expect(page).toHaveURL(/\/requests\/new$/)
})
