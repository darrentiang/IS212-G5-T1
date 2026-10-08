import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import RequestNewPage from '../RequestNewPage'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')

// What the API sends for a request with no requirement chosen (SCRUM-42).
const NO_CHOICES = { layout: null, facilities: [], accessibility_features: [] }

const OPTIONS = {
  layouts: ['Classroom', 'Theatre'],
  facilities: ['Projector', 'Sound system', 'Whiteboard'],
  accessibility_features: ['Step-free access', 'Hearing loop'],
}

beforeEach(() => {
  api.getRequestOptions.mockResolvedValue(OPTIONS)
})

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
  equipment_requirements: 'Projector, microphones',
  registration_needs: 'Online registration with capacity cap',
}

async function renderNewPage() {
  render(
    <MemoryRouter initialEntries={['/requests/new']}>
      <Routes>
        <Route path="/requests/new" element={<RequestNewPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
  // The form appears once the option lists are in (SCRUM-42).
  await screen.findByTestId('request-new-submit-button')
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
  it('renders every required field, marked required', async () => {
    await renderNewPage()
    expect(screen.getByTestId('request-new-name-input')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByTestId('request-new-equipment-requirements-input')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByTestId('request-new-registration-needs-input')).toHaveAttribute('aria-required', 'true')
  })

  // @story: SCRUM-28
  // @ac: 3
  it('refuses to submit and names every missing field, sending nothing', async () => {
    await renderNewPage()

    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    expect(await screen.findByTestId('request-new-name-error')).toBeInTheDocument()
    expect(screen.getByTestId('request-new-equipment-requirements-error')).toBeInTheDocument()
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
      ...NO_CHOICES,
      registration_enabled: false,
    })

    await renderNewPage()
    await fillValidForm()
    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    await waitFor(() => {
      expect(api.submitRequest).toHaveBeenCalledWith(expect.objectContaining({ name: VALID.name }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request submitted')
    })
    // The banner comes from the navigation state and can show before the
    // request has loaded; the status shows only once it has.
    expect(await screen.findByTestId('request-detail-status')).toHaveTextContent('Submitted')
  })

  // @story: SCRUM-28
  // @ac: 3
  it('shows the API refusal in the banner and stays on the form', async () => {
    api.submitRequest.mockRejectedValue(
      Object.assign(new Error('Missing required fields: name'), { status: 400 }),
    )

    await renderNewPage()
    await fillValidForm()
    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-new-banner')).toHaveTextContent('Missing required fields: name')
    })
  })

  // @story: SCRUM-30
  // @ac: 9
  it('refuses to save a draft with no name, sending nothing', async () => {
    await renderNewPage()

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
      ...NO_CHOICES,
      registration_enabled: false,
    })

    await renderNewPage()
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
      ...NO_CHOICES,
      registration_enabled: false,
    })

    await renderNewPage()
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

    await renderNewPage()
    await userEvent.type(screen.getByTestId('request-new-name-input'), 'Second Event')
    await userEvent.click(screen.getByTestId('request-new-save-draft-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-new-banner')).toHaveTextContent('already have an open draft')
    })
  })

  // --- SCRUM-42: choosing a required layout, facilities and accessibility features ---

  // @story: SCRUM-42
  // @ac: 1
  it('shows only the title until the option lists are in', async () => {
    let resolveOptions
    api.getRequestOptions.mockReturnValue(
      new Promise((resolve) => {
        resolveOptions = resolve
      }),
    )
    render(
      <MemoryRouter initialEntries={['/requests/new']}>
        <Routes>
          <Route path="/requests/new" element={<RequestNewPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByTestId('request-new-title')).toBeInTheDocument()
    expect(screen.queryByTestId('request-new-submit-button')).not.toBeInTheDocument()
    resolveOptions(OPTIONS)
    expect(await screen.findByTestId('request-new-layout-input')).toBeInTheDocument()
  })

  // @story: SCRUM-42
  // @ac: 1
  it("groups the choices under the brief's headings, in place of the free-text fields", async () => {
    await renderNewPage()

    const venue = screen.getByRole('group', { name: 'Venue requirements' })
    expect(within(venue).getByLabelText('Room layout')).toBe(screen.getByTestId('request-new-layout-input'))
    expect(within(venue).getByRole('group', { name: 'Facilities' })).toContainElement(
      screen.getByTestId('request-new-facilities-projector-input'),
    )
    const accessibility = screen.getByRole('group', { name: 'Accessibility needs' })
    expect(within(accessibility).getByRole('group', { name: 'Accessibility features' })).toContainElement(
      screen.getByTestId('request-new-accessibility-features-hearing-loop-input'),
    )
    expect(screen.queryByTestId('request-new-venue-requirements-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-new-accessibility-needs-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-42
  // @ac: 1
  it('offers None and every layout, and a checkbox per facility and accessibility feature', async () => {
    await renderNewPage()

    const layout = screen.getByTestId('request-new-layout-input')
    expect(layout).toHaveValue('')
    expect([...layout.options].map((option) => option.text)).toEqual(['None', 'Classroom', 'Theatre'])
    expect(screen.getByTestId('request-new-facilities-sound-system-input')).not.toBeChecked()
    expect(screen.getByTestId('request-new-accessibility-features-step-free-access-input')).not.toBeChecked()
  })

  // @story: SCRUM-42
  // @ac: 1
  it('submits the chosen requirements with the request', async () => {
    api.submitRequest.mockResolvedValue({ id: 42 })
    api.getRequest.mockResolvedValue({ id: 42, status: 'Submitted', created_by: 'org1', ...NO_CHOICES })
    await renderNewPage()
    await fillValidForm()

    await userEvent.selectOptions(screen.getByTestId('request-new-layout-input'), 'Theatre')
    await userEvent.click(screen.getByTestId('request-new-facilities-projector-input'))
    await userEvent.click(screen.getByTestId('request-new-facilities-whiteboard-input'))
    await userEvent.click(screen.getByTestId('request-new-facilities-projector-input'))
    await userEvent.click(screen.getByTestId('request-new-facilities-sound-system-input'))
    await userEvent.click(screen.getByTestId('request-new-accessibility-features-hearing-loop-input'))
    await userEvent.click(screen.getByTestId('request-new-submit-button'))

    await waitFor(() => {
      expect(api.submitRequest).toHaveBeenCalledWith({
        ...VALID,
        layout: 'Theatre',
        facilities: ['Whiteboard', 'Sound system'],
        accessibility_features: ['Hearing loop'],
      })
    })
  })

  // @story: SCRUM-42
  // @ac: 1
  it('saves a draft with nothing chosen as no layout and empty lists', async () => {
    api.saveDraft.mockResolvedValue({ id: 7 })
    api.getRequest.mockResolvedValue({ id: 7, status: 'Draft', created_by: 'org1', ...NO_CHOICES })
    await renderNewPage()
    await userEvent.type(screen.getByTestId('request-new-name-input'), 'TC42 None Chosen')

    await userEvent.click(screen.getByTestId('request-new-save-draft-button'))

    await waitFor(() => {
      expect(api.saveDraft).toHaveBeenCalledWith(
        expect.objectContaining({ layout: null, facilities: [], accessibility_features: [] }),
      )
    })
  })

  // @story: SCRUM-42
  // @ac: 1
  it('shows the refusal and still offers the form when the option lists fail to load', async () => {
    api.getRequestOptions.mockRejectedValue(Object.assign(new Error('Something went wrong'), { status: 500 }))

    await renderNewPage()

    expect(screen.getByTestId('request-new-banner')).toHaveTextContent('Something went wrong')
    expect([...screen.getByTestId('request-new-layout-input').options].map((option) => option.text)).toEqual([
      'None',
    ])
  })
})
