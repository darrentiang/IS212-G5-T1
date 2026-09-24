import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import RequestDetailPage from '../RequestDetailPage'
import RequestsPage from '../RequestsPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/1']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route path="/requests" element={<RequestsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequestDetailPage', () => {
  // @story: SCRUM-27
  // @ac: 1
  it('shows public fields when the API returns the request', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Annual Dinner',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-name')).toHaveTextContent('Annual Dinner')
    })
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    expect(screen.queryByTestId('request-detail-coordinator-notes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-submit-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 2, 8
  it('shows the refusal banner and no fields when the API refuses', async () => {
    api.getRequest.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent(/permission/i)
    })
    expect(screen.queryByTestId('request-detail-name')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 6
  it('shows coordinator notes when the API includes them', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Annual Dinner',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
      coordinator_notes: 'Internal: venue shortlist pending.',
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-coordinator-notes')).toHaveTextContent('venue shortlist')
    })
  })

  // @story: SCRUM-27
  // @ac: 1
  it('ignores the API result after unmount', async () => {
    let resolveGet
    api.getRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    resolveGet({ id: 1, name: 'Annual Dinner', status: 'Submitted', created_by: 'org1', registration_enabled: false })
  })

  // @story: SCRUM-27
  // @ac: 8
  it('ignores the API error after unmount', async () => {
    let rejectGet
    api.getRequest.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectGet = reject
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    rejectGet(new Error('gone'))
  })

  // @story: SCRUM-28
  // @ac: 2
  it("offers Submit on the owner's Draft request", async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-submit-button')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-28
  // @ac: 2, 4, 6
  it('submits the Draft and shows the new status with a success banner', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.submitDraft.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-submit-button'))
    await userEvent.click(screen.getByTestId('request-detail-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    })
    expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request submitted')
    expect(screen.queryByTestId('request-detail-submit-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-28
  // @ac: 3
  it('shows the API refusal when submitting an already-Submitted request', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.submitDraft.mockRejectedValue(
      Object.assign(new Error('Only a Draft request can be submitted.'), { status: 400 }),
    )

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-submit-button'))
    await userEvent.click(screen.getByTestId('request-detail-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Only a Draft request can be submitted.')
    })
  })

  // @story: SCRUM-30
  // @ac: 3
  it("offers Edit and Delete on the owner's Draft request", async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-edit-button')).toBeInTheDocument()
    })
    expect(screen.getByTestId('request-detail-delete-button')).toBeInTheDocument()
  })

  // @story: SCRUM-30
  // @ac: 3
  it('edits the name of a draft and shows the update', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Old name',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.updateDraft.mockResolvedValue({
      id: 1,
      name: 'New name',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-button'))

    const nameInput = screen.getByTestId('request-detail-edit-name-input')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'New name')
    await userEvent.type(screen.getByTestId('request-detail-edit-description-input'), 'Updated description')
    await userEvent.click(screen.getByTestId('request-detail-edit-confirm-button'))

    await waitFor(() => {
      expect(api.updateDraft).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ name: 'New name', description: 'Updated description' }),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('request-detail-name')).toHaveTextContent('New name')
    })
    expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Draft updated')
    expect(screen.queryByTestId('request-detail-edit-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-30
  // @ac: 9
  it('refuses to save an edit that blanks the name, sending nothing', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-button'))

    const nameInput = screen.getByTestId('request-detail-edit-name-input')
    await userEvent.clear(nameInput)
    await userEvent.click(screen.getByTestId('request-detail-edit-confirm-button'))

    expect(await screen.findByTestId('request-detail-edit-name-error')).toBeInTheDocument()
    expect(api.updateDraft).not.toHaveBeenCalled()
  })

  // @story: SCRUM-30
  // @ac: 3
  it('shows the API refusal when editing a draft fails', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.updateDraft.mockRejectedValue(
      Object.assign(new Error('Only a Draft request can be edited.'), { status: 400 }),
    )

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Only a Draft request can be edited.')
    })
  })

  // @story: SCRUM-30
  // @ac: 3
  it('closes the edit form on Cancel without saving', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-cancel-button'))

    expect(screen.queryByTestId('request-detail-edit-form')).not.toBeInTheDocument()
    expect(api.updateDraft).not.toHaveBeenCalled()
  })

  // @story: SCRUM-30
  // @ac: 3, 8
  it('deletes a draft and lands on the Requests list with a success banner', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.deleteDraft.mockResolvedValue()
    api.listRequests = vi.fn().mockResolvedValue([])

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-delete-button'))
    await userEvent.click(screen.getByTestId('request-detail-delete-button'))
    await userEvent.click(screen.getByTestId('request-detail-delete-confirm-button'))

    await waitFor(() => {
      expect(api.deleteDraft).toHaveBeenCalledWith('1')
    })
    await waitFor(() => {
      expect(screen.getByTestId('requests-banner')).toHaveTextContent('Draft deleted')
    })
  })

  // @story: SCRUM-30
  // @ac: 4
  it('shows the API refusal when deleting a draft fails', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.deleteDraft.mockRejectedValue(
      Object.assign(new Error('Only a Draft request can be deleted.'), { status: 400 }),
    )

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-delete-button'))
    await userEvent.click(screen.getByTestId('request-detail-delete-button'))
    await userEvent.click(screen.getByTestId('request-detail-delete-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Only a Draft request can be deleted.')
    })
  })

  // @story: SCRUM-30
  // @ac: 3
  it('closes the delete confirmation on Cancel without deleting', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-delete-button'))
    await userEvent.click(screen.getByTestId('request-detail-delete-button'))
    await userEvent.click(screen.getByTestId('request-detail-delete-cancel-button'))

    expect(screen.queryByTestId('request-detail-delete-form')).not.toBeInTheDocument()
    expect(api.deleteDraft).not.toHaveBeenCalled()
  })

  // @story: SCRUM-30
  // @ac: 3
  it('opening Delete closes an open Edit form', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-edit-button'))
    await userEvent.click(screen.getByTestId('request-detail-edit-button'))
    expect(screen.getByTestId('request-detail-edit-form')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('request-detail-delete-button'))
    expect(screen.queryByTestId('request-detail-edit-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-delete-form')).toBeInTheDocument()
  })
})
