import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import VenueDetailPage from '../VenueDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

const HALL_A = {
  id: 3,
  name: 'Hall A',
  location: 'Block B Level 3',
  max_capacity: 250,
  opening_time: '08:00',
  closing_time: '22:00',
  facilities: ['Projector', 'Stage lighting'],
  accessibility_features: ['Step-free access', 'Hearing loop'],
}

const OPTIONS = {
  facilities: ['Projector', 'Stage lighting', 'Sound system', 'Whiteboard', 'Wi-Fi'],
  accessibility_features: ['Step-free access', 'Hearing loop', 'Lift access'],
}

function signInWith(features) {
  vi.mocked(auth.useAuth).mockReturnValue({ can: (feature) => features.includes(feature) })
}

// SCRUM-40 made the page read the account and load the venue's blocks; the
// SCRUM-31 tests below see a Venue Staff account and a venue with no blocks.
// SCRUM-75 loads venue options for the update form.
beforeEach(() => {
  signInWith(['venues.view', 'venues.edit'])
  api.listVenueBlocks.mockResolvedValue([])
  api.getVenueOptions.mockResolvedValue(OPTIONS)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderPage(state) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/venues/3', state }]}>
      <Routes>
        <Route path="/venues/:id" element={<VenueDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('VenueDetailPage', () => {
  // @story: SCRUM-31
  // @ac: 4
  it('shows every field recorded for the venue', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A')
    })
    expect(screen.getByTestId('venue-detail-location')).toHaveTextContent('Block B Level 3')
    expect(screen.getByTestId('venue-detail-max-capacity')).toHaveTextContent('250')
    expect(screen.getByTestId('venue-detail-opening-time')).toHaveTextContent('08:00')
    expect(screen.getByTestId('venue-detail-closing-time')).toHaveTextContent('22:00')
    expect(screen.getByTestId('venue-detail-facilities')).toHaveTextContent('Projector, Stage lighting')
    expect(screen.getByTestId('venue-detail-accessibility-features')).toHaveTextContent('Step-free access, Hearing loop')
    expect(api.getVenue).toHaveBeenCalledWith('3')
  })

  // @story: SCRUM-31
  // @ac: 2
  it('says None for the fields the venue does not record', async () => {
    api.getVenue.mockResolvedValue({
      ...HALL_A,
      opening_time: null,
      closing_time: null,
      facilities: [],
      accessibility_features: [],
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-opening-time')).toHaveTextContent('None')
    })
    expect(screen.getByTestId('venue-detail-closing-time')).toHaveTextContent('None')
    expect(screen.getByTestId('venue-detail-facilities')).toHaveTextContent('None')
    expect(screen.getByTestId('venue-detail-accessibility-features')).toHaveTextContent('None')
  })

  // @story: SCRUM-31
  // @ac: 1
  it('shows the success banner of the page the user came from', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage({ banner: 'Venue added' })

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Venue added')
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
  })

  // @story: SCRUM-31
  // @ac: 5
  it('shows the API refusal in the banner and no fields', async () => {
    api.getVenue.mockRejectedValue(Object.assign(new Error('Venue not found.'), { status: 404 }))

    renderPage({ banner: 'Venue added' })

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Venue not found.')
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('venue-detail-fields')).not.toBeInTheDocument()
  })

  // @story: SCRUM-31
  // @ac: 4
  it('keeps the venue the user moved to when the earlier reply arrives last', async () => {
    let resolveFirst
    api.getVenue
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce({ ...HALL_A, id: 4, name: 'Hall B' })
    const router = createMemoryRouter([{ path: '/venues/:id', element: <VenueDetailPage /> }], {
      initialEntries: ['/venues/3'],
    })
    render(<RouterProvider router={router} />)

    await act(() => router.navigate('/venues/4'))
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall B')
    })
    await act(async () => resolveFirst(HALL_A))

    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall B')
  })

  // @story: SCRUM-31
  // @ac: 5
  it('keeps the venue the user moved to when the earlier refusal arrives last', async () => {
    let rejectFirst
    api.getVenue
      .mockReturnValueOnce(
        new Promise((resolve, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce({ ...HALL_A, id: 4, name: 'Hall B' })
    const router = createMemoryRouter([{ path: '/venues/:id', element: <VenueDetailPage /> }], {
      initialEntries: ['/venues/3'],
    })
    render(<RouterProvider router={router} />)

    await act(() => router.navigate('/venues/4'))
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall B')
    })
    await act(async () => rejectFirst(new Error('Venue not found.')))

    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall B')
    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })
})

const BLOCK = {
  id: 7,
  venue_id: 3,
  start: '2026-10-20T09:00',
  end: '2026-10-21T18:00',
  reason: 'Projector replacement',
  created_by: 'venue1',
  created_at: '2026-10-06T02:15:00',
}

const ENTERED = {
  start_date: '2026-10-20',
  start_time: '09:00',
  end_date: '2026-10-21',
  end_time: '18:00',
  reason: 'Projector replacement',
}

async function openBlockForm() {
  await userEvent.click(await screen.findByTestId('venue-detail-block-button'))
}

async function fillBlockForm(values) {
  for (const [field, value] of Object.entries(values)) {
    const input = screen.getByTestId(`venue-detail-block-${field.replaceAll('_', '-')}-input`)
    await userEvent.clear(input)
    if (value !== '') await userEvent.type(input, value)
  }
}

describe('VenueDetailPage blocks', () => {
  // @story: SCRUM-40
  // @ac: 2
  it('lists each block of the venue with its period and reason', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBlocks.mockResolvedValue([
      BLOCK,
      { ...BLOCK, id: 8, start: '2026-11-02T08:00', end: '2026-11-02T12:00', reason: 'Safety inspection' },
    ])

    renderPage()

    // ui-guidelines.md §9: a date-and-time period, both ends in full.
    expect(await screen.findByTestId('venue-detail-block-period-7')).toHaveTextContent(
      '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00',
    )
    expect(screen.getByTestId('venue-detail-block-reason-7')).toHaveTextContent('Projector replacement')
    expect(screen.getByTestId('venue-detail-block-period-8')).toHaveTextContent(
      '02 Nov 2026, 08:00 to 02 Nov 2026, 12:00',
    )
    expect(screen.getByTestId('venue-detail-block-reason-8')).toHaveTextContent('Safety inspection')
    expect(screen.queryByTestId('venue-detail-blocks-empty')).not.toBeInTheDocument()
    expect(api.listVenueBlocks).toHaveBeenCalledWith('3')
  })

  // @story: SCRUM-40
  // @ac: 2
  it('says so when the venue has no blocks', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage()

    expect(await screen.findByTestId('venue-detail-blocks-empty')).toHaveTextContent('This venue has no blocks.')
  })

  // @story: SCRUM-40
  // @ac: 2
  it('shows the API refusal in the banner when the blocks cannot be loaded', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBlocks.mockRejectedValue(Object.assign(new Error('Venue not found.'), { status: 404 }))

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Venue not found.')
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('venue-detail-fields')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-blocks-empty')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 2, 3
  it('lists the blocks but offers no Block venue button without venues.edit', async () => {
    signInWith(['venues.view'])
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBlocks.mockResolvedValue([BLOCK])

    renderPage()

    expect(await screen.findByTestId('venue-detail-block-reason-7')).toHaveTextContent('Projector replacement')
    expect(screen.queryByTestId('venue-detail-block-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 1, 3
  it('opens an inline form with start date, start time, end date, end time and reason, all required', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()

    await openBlockForm()

    for (const [field, type, label] of [
      ['start-date', 'date', 'Start date *'],
      ['start-time', 'time', 'Start time *'],
      ['end-date', 'date', 'End date *'],
      ['end-time', 'time', 'End time *'],
    ]) {
      const input = screen.getByTestId(`venue-detail-block-${field}-input`)
      expect(input).toHaveAttribute('type', type)
      expect(input).toHaveAttribute('aria-required', 'true')
      expect(screen.getByLabelText(label)).toBe(input)
    }
    const reason = screen.getByTestId('venue-detail-block-reason-input')
    expect(reason.tagName).toBe('TEXTAREA')
    expect(reason).toHaveAttribute('aria-required', 'true')
    expect(screen.getByLabelText('Reason *')).toBe(reason)
    expect(screen.getByTestId('venue-detail-block-confirm-button')).toHaveTextContent('Block')
    expect(screen.getByTestId('venue-detail-block-cancel-button')).toHaveTextContent('Cancel')
  })

  // @story: SCRUM-40
  // @ac: 1
  it('shows a message under every empty field and sends nothing', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()
    await openBlockForm()

    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-block-start-date-error')).toHaveTextContent('Start date is required')
    expect(screen.getByTestId('venue-detail-block-start-time-error')).toHaveTextContent('Start time is required')
    expect(screen.getByTestId('venue-detail-block-end-date-error')).toHaveTextContent('End date is required')
    expect(screen.getByTestId('venue-detail-block-end-time-error')).toHaveTextContent('End time is required')
    expect(screen.getByTestId('venue-detail-block-reason-error')).toHaveTextContent('Reason is required')
    expect(api.blockVenue).not.toHaveBeenCalled()
    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 1
  it('shows a message only under the field left empty', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()
    await openBlockForm()

    await fillBlockForm({ ...ENTERED, reason: '' })
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-block-reason-error')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-block-start-date-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-block-end-time-error')).not.toBeInTheDocument()
    expect(api.blockVenue).not.toHaveBeenCalled()
  })

  // @story: SCRUM-40
  // @ac: 1, 2
  it('sends exactly the values entered and lists the new block with a success banner', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.blockVenue.mockResolvedValue(BLOCK)
    renderPage()
    await openBlockForm()

    await fillBlockForm(ENTERED)
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    expect(await screen.findByTestId('venue-detail-block-period-7')).toHaveTextContent(
      '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00',
    )
    expect(api.blockVenue).toHaveBeenCalledWith('3', ENTERED)
    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Venue blocked')
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
    expect(screen.queryByTestId('venue-detail-block-confirm-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-blocks-empty')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 1
  it('treats a reason of spaces only as empty and sends nothing', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()
    await openBlockForm()

    await fillBlockForm({ ...ENTERED, reason: '   ' })
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-block-reason-error')).toHaveTextContent('Reason is required')
    expect(screen.queryByTestId('venue-detail-block-start-date-error')).not.toBeInTheDocument()
    expect(api.blockVenue).not.toHaveBeenCalled()
    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 1
  it('shows the API refusal in the banner, keeps the form open and lists nothing new', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.blockVenue.mockRejectedValue(Object.assign(new Error('End must be after the start.'), { status: 400 }))
    renderPage()
    await openBlockForm()

    await fillBlockForm({ ...ENTERED, end_date: '2026-10-20', end_time: '08:00' })
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('End must be after the start.')
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('venue-detail-block-confirm-button')).toBeEnabled()
    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A')
    expect(screen.getByTestId('venue-detail-blocks-empty')).toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 1
  it('disables the form buttons while the block is being sent', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.blockVenue.mockReturnValue(new Promise(() => {}))
    renderPage()
    await openBlockForm()

    await fillBlockForm(ENTERED)
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-block-confirm-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-cancel-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-button')).toBeDisabled()
  })

  // @story: SCRUM-40
  // @ac: 1
  it('closes the form on Cancel without sending, and reopens it empty', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()
    await openBlockForm()
    await fillBlockForm({ reason: 'Deep clean' })
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    await userEvent.click(screen.getByTestId('venue-detail-block-cancel-button'))

    expect(screen.queryByTestId('venue-detail-block-reason-input')).not.toBeInTheDocument()
    expect(api.blockVenue).not.toHaveBeenCalled()
    await openBlockForm()
    expect(screen.getByTestId('venue-detail-block-reason-input')).toHaveValue('')
    expect(screen.queryByTestId('venue-detail-block-start-date-error')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 1
  it('clears the success banner when the form is opened', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage({ banner: 'Venue added' })
    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Venue added')

    await openBlockForm()

    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-40
  // @ac: 2
  it('lists a new block that starts earlier before the existing ones, in start then id order', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    // Two existing blocks with the same start: the API orders them by id.
    api.listVenueBlocks.mockResolvedValue([BLOCK, { ...BLOCK, id: 8, reason: 'Safety inspection' }])
    api.blockVenue.mockResolvedValue({
      ...BLOCK,
      id: 9,
      start: '2026-10-19T09:00',
      end: '2026-10-19T18:00',
      reason: 'Deep clean',
    })
    renderPage()
    await openBlockForm()

    await fillBlockForm({ ...ENTERED, start_date: '2026-10-19', end_date: '2026-10-19', reason: 'Deep clean' })
    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    await screen.findByTestId('venue-detail-block-row-9')
    const order = screen
      .getAllByTestId(/^venue-detail-block-row-/)
      .map((row) => row.getAttribute('data-testid'))
    expect(order).toEqual(['venue-detail-block-row-9', 'venue-detail-block-row-7', 'venue-detail-block-row-8'])
  })

  // ---------------- SCRUM-75 Update Venue Details ----------------

  async function openUpdateForm() {
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-update-button')).toBeVisible()
    })
    await userEvent.click(screen.getByTestId('venue-detail-update-button'))
    expect(screen.getByTestId('venue-detail-update-name-input')).toBeVisible()
  }

  // @story: SCRUM-75
  // @ac: 6
  it('shows update button when venues.edit is held', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    signInWith(['venues.view', 'venues.edit'])
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-update-button')).toBeVisible()
    })
  })

  // @story: SCRUM-75
  // @ac: 6
  it('hides update button when only venues.view is held', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    signInWith(['venues.view'])
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A')
    })
    expect(screen.queryByTestId('venue-detail-update-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-75
  // @ac: 1
  it('prepopulates all fields and selected options when opening the update form', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()

    await openUpdateForm()

    expect(screen.getByTestId('venue-detail-update-name-input')).toHaveValue('Hall A')
    expect(screen.getByTestId('venue-detail-update-location-input')).toHaveValue('Block B Level 3')
    expect(screen.getByTestId('venue-detail-update-max-capacity-input')).toHaveValue(250)
    expect(screen.getByTestId('venue-detail-update-opening-time-input')).toHaveValue('08:00')
    expect(screen.getByTestId('venue-detail-update-closing-time-input')).toHaveValue('22:00')
    expect(screen.getByTestId('venue-detail-update-facilities-projector-input')).toBeChecked()
    expect(screen.getByTestId('venue-detail-update-facilities-stage-lighting-input')).toBeChecked()
    expect(screen.getByTestId('venue-detail-update-facilities-sound-system-input')).not.toBeChecked()
    expect(screen.getByTestId('venue-detail-update-accessibility-features-step-free-access-input')).toBeChecked()
    expect(screen.getByTestId('venue-detail-update-accessibility-features-hearing-loop-input')).toBeChecked()
    expect(screen.getByTestId('venue-detail-update-accessibility-features-lift-access-input')).not.toBeChecked()

    await userEvent.click(screen.getByTestId('venue-detail-update-accessibility-features-lift-access-input'))
    expect(screen.getByTestId('venue-detail-update-accessibility-features-lift-access-input')).toBeChecked()
  })

  // @story: SCRUM-75
  // @ac: 1
  it('handles missing optional venue values and option lists when opening the update form', async () => {
    api.getVenue.mockResolvedValue({
      ...HALL_A,
      opening_time: undefined,
      closing_time: undefined,
      facilities: undefined,
      accessibility_features: undefined,
    })
    api.getVenueOptions.mockResolvedValue({})
    renderPage()

    await openUpdateForm()

    expect(screen.getByTestId('venue-detail-update-opening-time-input')).toHaveValue('')
    expect(screen.getByTestId('venue-detail-update-closing-time-input')).toHaveValue('')
    expect(screen.queryByTestId('venue-detail-update-facilities-projector-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-update-accessibility-features-step-free-access-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-75
  // @ac: 1
  it('leaves update options unchanged when the options API returns no data', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.getVenueOptions.mockResolvedValue(undefined)
    renderPage()

    await openUpdateForm()

    expect(screen.queryByTestId('venue-detail-update-facilities-projector-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-75
  // @ac: 1
  it('keeps the update form usable when the options API refuses', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.getVenueOptions.mockRejectedValue(new Error('Options unavailable'))
    renderPage()

    await openUpdateForm()

    expect(screen.getByTestId('venue-detail-update-name-input')).toHaveValue('Hall A')
    expect(screen.queryByTestId('venue-detail-update-facilities-projector-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-75
  // @ac: 1, 3, 5
  it('sends complete payload to updateVenue and updates displayed details on success with banner', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    const updatedVenue = {
      ...HALL_A,
      name: 'Hall A Renovated',
      location: 'Block C Level 4',
      max_capacity: 300,
      facilities: ['Projector', 'Sound system'],
    }
    api.updateVenue.mockResolvedValue(updatedVenue)
    renderPage()

    await openUpdateForm()

    const nameInput = screen.getByTestId('venue-detail-update-name-input')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Hall A Renovated')

    const locInput = screen.getByTestId('venue-detail-update-location-input')
    await userEvent.clear(locInput)
    await userEvent.type(locInput, 'Block C Level 4')

    const capInput = screen.getByTestId('venue-detail-update-max-capacity-input')
    await userEvent.clear(capInput)
    await userEvent.type(capInput, '300')

    await userEvent.click(screen.getByTestId('venue-detail-update-facilities-stage-lighting-input'))
    await userEvent.click(screen.getByTestId('venue-detail-update-facilities-sound-system-input'))

    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    await waitFor(() => {
      expect(api.updateVenue).toHaveBeenCalledWith(
        '3',
        expect.objectContaining({
          name: 'Hall A Renovated',
          location: 'Block C Level 4',
          max_capacity: '300',
          facilities: ['Projector', 'Sound system'],
        }),
      )
    })

    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Venue updated')
    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A Renovated')
    expect(screen.getByTestId('venue-detail-location')).toHaveTextContent('Block C Level 4')
    expect(screen.getByTestId('venue-detail-max-capacity')).toHaveTextContent('300')
    expect(screen.queryByTestId('venue-detail-update-name-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-75
  // @ac: 2, 4
  it('shows client-side errors and prevents API call when required fields are empty', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()

    await openUpdateForm()

    await userEvent.clear(screen.getByTestId('venue-detail-update-name-input'))
    await userEvent.clear(screen.getByTestId('venue-detail-update-location-input'))
    await userEvent.clear(screen.getByTestId('venue-detail-update-max-capacity-input'))

    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    expect(screen.getByTestId('venue-detail-update-name-error')).toHaveTextContent('Name is required')
    expect(screen.getByTestId('venue-detail-update-location-error')).toHaveTextContent('Location is required')
    expect(screen.getByTestId('venue-detail-update-max-capacity-error')).toHaveTextContent('Maximum capacity is required')
    expect(api.updateVenue).not.toHaveBeenCalled()
  })

  // @story: SCRUM-75
  // @ac: 2, 4
  it('treats whitespace-only text as empty and displays client-side error', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()

    await openUpdateForm()

    const nameInput = screen.getByTestId('venue-detail-update-name-input')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '   ')

    const locInput = screen.getByTestId('venue-detail-update-location-input')
    await userEvent.clear(locInput)
    await userEvent.type(locInput, '   ')

    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    expect(screen.getByTestId('venue-detail-update-name-error')).toHaveTextContent('Name is required')
    expect(screen.getByTestId('venue-detail-update-location-error')).toHaveTextContent('Location is required')
    expect(api.updateVenue).not.toHaveBeenCalled()
  })

  // @story: SCRUM-75
  // @ac: 1, 2, 5
  it('sends blank times and empty lists when optional fields are cleared', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    const clearedVenue = {
      ...HALL_A,
      opening_time: null,
      closing_time: null,
      facilities: [],
      accessibility_features: [],
    }
    api.updateVenue.mockResolvedValue(clearedVenue)
    renderPage()

    await openUpdateForm()

    await userEvent.clear(screen.getByTestId('venue-detail-update-opening-time-input'))
    await userEvent.clear(screen.getByTestId('venue-detail-update-closing-time-input'))

    await userEvent.click(screen.getByTestId('venue-detail-update-facilities-projector-input'))
    await userEvent.click(screen.getByTestId('venue-detail-update-facilities-stage-lighting-input'))
    await userEvent.click(screen.getByTestId('venue-detail-update-accessibility-features-step-free-access-input'))
    await userEvent.click(screen.getByTestId('venue-detail-update-accessibility-features-hearing-loop-input'))

    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    await waitFor(() => {
      expect(api.updateVenue).toHaveBeenCalledWith(
        '3',
        expect.objectContaining({
          opening_time: '',
          closing_time: '',
          facilities: [],
          accessibility_features: [],
        }),
      )
    })

    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Venue updated')
    expect(screen.getByTestId('venue-detail-opening-time')).toHaveTextContent('None')
    expect(screen.getByTestId('venue-detail-closing-time')).toHaveTextContent('None')
    expect(screen.getByTestId('venue-detail-facilities')).toHaveTextContent('None')
    expect(screen.getByTestId('venue-detail-accessibility-features')).toHaveTextContent('None')
  })

  // @story: SCRUM-75
  // @ac: 4
  it('displays error banner and leaves form open and stored details unchanged on API refusal', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.updateVenue.mockRejectedValue(new Error('Maximum capacity must be a positive whole number.'))
    renderPage()

    await openUpdateForm()

    const capInput = screen.getByTestId('venue-detail-update-max-capacity-input')
    await userEvent.clear(capInput)
    await userEvent.type(capInput, '0')

    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Maximum capacity must be a positive whole number.')
    expect(screen.getByTestId('venue-detail-update-name-input')).toBeVisible()
    expect(screen.getByTestId('venue-detail-max-capacity')).toHaveTextContent('250')
  })

  // @story: SCRUM-75
  // @ac: 1
  it('closes form without calling API on cancel and restores original values on reopen', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    renderPage()

    await openUpdateForm()

    const nameInput = screen.getByTestId('venue-detail-update-name-input')
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Changed But Cancelled')

    await userEvent.click(screen.getByTestId('venue-detail-update-cancel-button'))

    expect(screen.queryByTestId('venue-detail-update-name-input')).not.toBeInTheDocument()
    expect(api.updateVenue).not.toHaveBeenCalled()

    await openUpdateForm()
    expect(screen.getByTestId('venue-detail-update-name-input')).toHaveValue('Hall A')
  })

  // @story: SCRUM-75
  // @ac: 1
  it('disables update controls while saving is pending', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    let resolveUpdate
    api.updateVenue.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve }))
    renderPage()

    await openUpdateForm()

    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    expect(screen.getByTestId('venue-detail-update-save-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-update-cancel-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-update-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-button')).toBeDisabled()

    await act(async () => {
      resolveUpdate(HALL_A)
    })

    await waitFor(() => {
      expect(screen.queryByTestId('venue-detail-update-save-button')).not.toBeInTheDocument()
    })
  })

  // @story: SCRUM-75
  // @ac: 1
  it('keeps SCRUM-40 blocks rendered and usable alongside update form', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBlocks.mockResolvedValue([BLOCK])
    renderPage()

    expect(await screen.findByTestId('venue-detail-block-row-7')).toBeVisible()

    await openUpdateForm()

    expect(screen.getByTestId('venue-detail-block-row-7')).toBeVisible()

    // Opening block form closes update form
    await userEvent.click(screen.getByTestId('venue-detail-block-button'))
    expect(screen.queryByTestId('venue-detail-update-name-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-block-start-date-input')).toBeVisible()
  })
})
