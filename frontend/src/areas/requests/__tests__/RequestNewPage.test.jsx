import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import RequestNewPage from '../RequestNewPage'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

const VALID = {
  name: 'Tech Fair 2026',
  purpose: 'Career networking',
  description: 'Annual tech career fair',
  date: '2026-11-20',
  start_time: '09:00',
  end_time: '17:00',
  attendance: '200',
  venue_requirements: 'Large hall with stage',
  accessibility_needs: 'Wheelchair access',
  equipment_requirements: 'Projector, microphones',
  registration_needs: 'Online registration with capacity cap',
}

function renderNewPage() {
  render(
    <MemoryRouter initialEntries={['/requests/new']}>
      <Routes>
        <Route path="/requests/new" element={<RequestNewPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillValidForm() {
  for (const [field, value] of Object.entries(VALID)) {
    const input = screen.getByTestId(`request-new-${field.replaceAll('_', '-')}-input`)
    await userEvent.clear(input)
    await userEvent.type(input, value)
  }
}

describe('RequestNewPage', () => {
  // @story: SCRUM-28
  // @ac: 1
  it('renders every required field, marked required', () => {
    renderNewPage()
    expect(screen.getByTestId('request-new-name-input')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByTestId('request-new-venue-requirements-input')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByTestId('request-new-registration-needs-input')).toHaveAttribute('aria-required', 'true')
  })

  // @story: SCRUM-28
  // @ac: 3
  it('refuses to submit and names every missing field, sending nothing', async () => {
    renderNewPage()

    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    expect(await screen.findByTestId('request-new-name-error')).toBeInTheDocument()
    expect(screen.getByTestId('request-new-venue-requirements-error')).toBeInTheDocument()
    expect(api.submitRequest).not.toHaveBeenCalled()
  })

  // @story: SCRUM-28
  // @ac: 1, 2, 4, 6
  it('submits a complete form and lands on the new request with a success banner', async () => {
    api.submitRequest.mockResolvedValue({ id: 42, status: 'Submitted' })
    api.getRequest.mockResolvedValue({
      id: 42,
      name: VALID.name,
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderNewPage()
    await fillValidForm()
    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    await waitFor(() => {
      expect(api.submitRequest).toHaveBeenCalledWith(expect.objectContaining({ name: VALID.name }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request submitted')
    })
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
  })

  // @story: SCRUM-28
  // @ac: 3
  it('shows the API refusal in the banner and stays on the form', async () => {
    api.submitRequest.mockRejectedValue(
      Object.assign(new Error('Missing required fields: name'), { status: 400 }),
    )

    renderNewPage()
    await fillValidForm()
    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-new-banner')).toHaveTextContent('Missing required fields: name')
    })
  })

  // @story: SCRUM-30
  // @ac: 9
  it('refuses to save a draft with no name, sending nothing', async () => {
    renderNewPage()

    await userEvent.click(screen.getByTestId('request-new-save-draft-button'))

    expect(await screen.findByTestId('request-new-name-error')).toBeInTheDocument()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  // @story: SCRUM-30
  // @ac: 1, 9
  it('saves a draft with only a name and lands on it with a success banner', async () => {
    api.saveDraft.mockResolvedValue({ id: 43, status: 'Draft', name: 'Tech Fair 2026' })
    api.getRequest.mockResolvedValue({
      id: 43,
      name: 'Tech Fair 2026',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderNewPage()
    await userEvent.type(screen.getByTestId('request-new-name-input'), 'Tech Fair 2026')
    await userEvent.click(screen.getByTestId('request-new-save-draft-button'))

    await waitFor(() => {
      expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ name: 'Tech Fair 2026' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Draft saved')
    })
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Draft')
  })

  // @story: SCRUM-30
  // @ac: 6
  it('saves a draft with an invalid attendance value without a field error', async () => {
    api.saveDraft.mockResolvedValue({ id: 44, status: 'Draft', name: 'Tech Fair 2026' })
    api.getRequest.mockResolvedValue({
      id: 44,
      name: 'Tech Fair 2026',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderNewPage()
    await userEvent.type(screen.getByTestId('request-new-name-input'), 'Tech Fair 2026')
    await userEvent.type(screen.getByTestId('request-new-attendance-input'), '-5')
    await userEvent.click(screen.getByTestId('request-new-save-draft-button'))

    await waitFor(() => {
      expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ attendance: '-5' }))
    })
    expect(screen.queryByTestId('request-new-attendance-error')).not.toBeInTheDocument()
  })

  // @story: SCRUM-30
  // @ac: 7
  it('shows the API refusal when a draft is already open', async () => {
    api.saveDraft.mockRejectedValue(
      Object.assign(new Error('You already have an open draft. Submit or delete it before starting another.'), {
        status: 400,
      }),
    )

    renderNewPage()
    await userEvent.type(screen.getByTestId('request-new-name-input'), 'Second Event')
    await userEvent.click(screen.getByTestId('request-new-save-draft-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-new-banner')).toHaveTextContent('already have an open draft')
    })
  })
})
