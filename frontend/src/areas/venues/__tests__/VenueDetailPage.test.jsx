import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  // SCRUM-80: durations in whole minutes; 0 means never recorded.
  setup_time: 0,
  turnaround_time: 0,
  facilities: ['Projector', 'Stage lighting'],
  accessibility_features: ['Step-free access', 'Hearing loop'],
  layouts: ['Classroom'],
}

// SCRUM-80: a venue whose two times have been recorded.
const RECORDED_TIMES = { ...HALL_A, setup_time: 30, turnaround_time: 15 }

const OPTIONS = {
  facilities: ['Projector', 'Stage lighting', 'Sound system', 'Whiteboard', 'Wi-Fi'],
  accessibility_features: ['Step-free access', 'Hearing loop', 'Lift access'],
  layouts: ['Classroom', 'Theatre', 'Boardroom', 'Banquet', 'Exhibition'],
}

function signInWith(features, username = 'venue1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

// SCRUM-40 made the page read the account and load the venue's blocks; the
// SCRUM-31 tests below see a Venue Staff account and a venue with no blocks.
// SCRUM-75 loads venue options for the update form.
beforeEach(() => {
  signInWith(['venues.view', 'venues.edit'])
  api.listVenueBlocks.mockResolvedValue([])
  api.listVenueBookings.mockResolvedValue([])
  // SCRUM-41: asked for on load with venues.edit, and again after a duration save.
  api.listVenueClashes.mockResolvedValue([])
  api.getVenueOptions.mockResolvedValue(OPTIONS)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function venuePage(state) {
  return (
    <MemoryRouter initialEntries={[{ pathname: '/venues/3', state }]}>
      <Routes>
        <Route path="/venues/:id" element={<VenueDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderPage(state) {
  return render(venuePage(state))
}

describe('VenueDetailPage', () => {
  // @story: SCRUM-39
  // @ac: 1, 6
  it('links to the venue\'s availability calendar', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage()

    const link = await screen.findByTestId('venue-detail-availability-link')
    expect(link).toHaveAttribute('href', '/venues/3/availability')
  })

  // @story: SCRUM-32
  // @ac: 4, 5
  it('shows recorded layouts and an explicit empty state', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, layouts: [] })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('None')
    })
    expect(screen.getByTestId('venue-detail-layouts-button')).toBeVisible()
  })

  // @story: SCRUM-32
  // @ac: 1, 4
  it('saves the selected layouts and updates the displayed set', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.updateVenueLayouts.mockResolvedValue({ ...HALL_A, layouts: ['Classroom', 'Theatre'] })

    renderPage()

    await waitFor(() => expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('Classroom'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-button'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-theatre-input'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-save-button'))

    await waitFor(() => expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('Classroom, Theatre'))
    expect(api.updateVenueLayouts).toHaveBeenCalledWith('3', { layouts: ['Classroom', 'Theatre'] })
  })

  // @story: SCRUM-32
  // @ac: 1, 2
  it('removes an existing layout and can cancel without saving', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.updateVenueLayouts.mockResolvedValue({ ...HALL_A, layouts: [] })

    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-layouts-button'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-classroom-input'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-save-button'))

    await waitFor(() => expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('None'))
    expect(api.updateVenueLayouts).toHaveBeenCalledWith('3', { layouts: [] })

    await userEvent.click(screen.getByTestId('venue-detail-layouts-button'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-cancel-button'))
    expect(screen.queryByTestId('venue-detail-layouts-save-button')).not.toBeInTheDocument()
    expect(api.updateVenueLayouts).toHaveBeenCalledTimes(1)
  })

  // @story: SCRUM-32
  // @ac: 4, 5
  it('opens an empty layout selection when the response omits layouts', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, layouts: undefined })

    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-layouts-button'))

    expect(screen.getByTestId('venue-detail-layouts-classroom-input')).not.toBeChecked()
    await userEvent.click(screen.getByTestId('venue-detail-layouts-cancel-button'))
  })

  // @story: SCRUM-32
  // @ac: 1, 4, 6
  it('shows the options refusal and keeps layout selection unavailable when options fail', async () => {
    const message = 'Venue options unavailable.'
    api.getVenue.mockResolvedValue(HALL_A)
    api.getVenueOptions.mockRejectedValue(new Error(message))

    renderPage()

    await waitFor(() => expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(message))
    expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('Classroom')
    expect(screen.queryByTestId('venue-detail-layouts-button')).not.toBeInTheDocument()
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.getVenueOptions.mockRejectedValue(new Error('Venue options unavailable.'))
    renderPage()
    await screen.findByTestId('venue-detail-banner')

    await userEvent.click(screen.getByTestId('venue-detail-banner-dismiss'))

    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-32
  // @ac: 6
  it('ignores an options refusal after permissions make the page view-only', async () => {
    let rejectOptions
    api.getVenue.mockResolvedValue(HALL_A)
    api.getVenueOptions.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectOptions = reject
      }),
    )

    const rendered = renderPage()
    await waitFor(() => expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A'))

    signInWith(['venues.view'])
    rendered.rerender(venuePage())

    await act(async () => {
      rejectOptions(new Error('Late options refusal'))
    })

    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A')
    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-32
  // @ac: 6
  it('does not offer layout changes without venues.edit', async () => {
    signInWith(['venues.view'])
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage()

    await waitFor(() => expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('Classroom'))
    expect(screen.queryByTestId('venue-detail-layouts-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-32
  // @ac: 3, 6
  it('keeps the layout form open and shows API refusals', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.updateVenueLayouts.mockRejectedValue(new Error('A layout cannot be selected more than once.'))

    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-layouts-button'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-theatre-input'))
    await userEvent.click(screen.getByTestId('venue-detail-layouts-save-button'))

    await waitFor(() => expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('A layout cannot be selected more than once.'))
    expect(screen.getByTestId('venue-detail-layouts-save-button')).toBeVisible()
    expect(screen.getByTestId('venue-detail-layouts-theatre-input')).toBeChecked()
  })

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

// SCRUM-79: one block in each phase, as the API derives it.
const UPCOMING_BLOCK = {
  ...BLOCK,
  id: 11,
  start: '2026-10-20T09:00',
  end: '2026-10-20T18:00',
  reason: 'Deep clean',
  phase: 'upcoming',
}
const IN_PROGRESS_BLOCK = {
  ...BLOCK,
  id: 12,
  start: '2026-10-06T09:00',
  end: '2026-10-07T18:00',
  reason: 'Lift repair',
  phase: 'in_progress',
}
const ENDED_BLOCK = {
  ...BLOCK,
  id: 13,
  start: '2026-10-05T09:00',
  end: '2026-10-05T18:00',
  reason: 'Inspection',
  phase: 'ended',
}

async function openEndForm(blockId = 12) {
  await userEvent.click(await screen.findByTestId(`venue-detail-block-end-button-${blockId}`))
}

async function fillEndForm(values) {
  for (const [field, value] of Object.entries(values)) {
    const input = screen.getByTestId(`venue-detail-end-block-${field.replaceAll('_', '-')}-input`)
    await userEvent.clear(input)
    if (value !== '') await userEvent.type(input, value)
  }
}

describe('VenueDetailPage ending or removing a block', () => {
  beforeEach(() => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBlocks.mockResolvedValue([ENDED_BLOCK, IN_PROGRESS_BLOCK, UPCOMING_BLOCK])
  })

  // @story: SCRUM-79
  // @ac: 1, 2, 3
  it('offers Remove only on an upcoming block, End early only on one in progress, and nothing on an ended one', async () => {
    renderPage()

    expect(await screen.findByTestId('venue-detail-block-remove-button-11')).toHaveTextContent('Remove')
    expect(screen.queryByTestId('venue-detail-block-end-button-11')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-block-end-button-12')).toHaveTextContent('End early')
    expect(screen.queryByTestId('venue-detail-block-remove-button-12')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-block-row-13')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-block-remove-button-13')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-block-end-button-13')).not.toBeInTheDocument()
  })

  // @story: SCRUM-79
  // @ac: 5
  it('lists every block but offers neither action, nor an Actions column, without venues.edit', async () => {
    signInWith(['venues.view'])

    renderPage()

    expect(await screen.findByTestId('venue-detail-block-row-11')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-block-row-12')).toBeInTheDocument()
    expect(screen.queryByTestId(/^venue-detail-block-(remove|end)-button-/)).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument()
  })

  // @story: SCRUM-79
  // @ac: 1, 4
  it('removes the block at once, drops its row and says Block removed', async () => {
    api.removeVenueBlock.mockResolvedValue(null)
    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-block-remove-button-11'))

    await waitFor(() => {
      expect(screen.queryByTestId('venue-detail-block-row-11')).not.toBeInTheDocument()
    })
    expect(api.removeVenueBlock).toHaveBeenCalledWith('3', 11)
    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Block removed')
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('venue-detail-block-row-12')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-block-row-13')).toBeInTheDocument()
  })

  // @story: SCRUM-79
  // @ac: 3
  it('shows the API refusal to remove in the banner and keeps the block listed', async () => {
    const message = 'A block that has started cannot be removed; end it early instead.'
    api.removeVenueBlock.mockRejectedValue(Object.assign(new Error(message), { status: 400 }))
    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-block-remove-button-11'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(message)
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('venue-detail-block-row-11')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-block-remove-button-11')).toBeEnabled()
  })

  // @story: SCRUM-79
  // @ac: 1
  it('disables the actions while a removal is being sent', async () => {
    api.removeVenueBlock.mockReturnValue(new Promise(() => {}))
    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-block-remove-button-11'))

    expect(screen.getByTestId('venue-detail-block-remove-button-11')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-end-button-12')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-button')).toBeDisabled()
  })

  // @story: SCRUM-79
  // @ac: 2
  it('opens an inline form for the block with a new end date and new end time, both required', async () => {
    renderPage()

    await openEndForm()

    for (const [field, type, label] of [
      ['end-date', 'date', 'New end date *'],
      ['end-time', 'time', 'New end time *'],
    ]) {
      const input = screen.getByTestId(`venue-detail-end-block-${field}-input`)
      expect(input).toHaveAttribute('type', type)
      expect(input).toHaveAttribute('aria-required', 'true')
      expect(input).toHaveValue('')
      expect(screen.getByLabelText(label)).toBe(input)
    }
    expect(screen.getByTestId('venue-detail-end-block-confirm-button')).toHaveTextContent('End')
    expect(screen.getByTestId('venue-detail-end-block-cancel-button')).toHaveTextContent('Cancel')
  })

  // @story: SCRUM-79
  // @ac: 2
  // The form names the block it ends, now that it opens below that block's row (SCRUM-37).
  it("names the block's period and reason in the end-block form", async () => {
    renderPage()

    await openEndForm()

    expect(screen.getByTestId('venue-detail-end-block-confirm-button').closest('form')).toHaveTextContent(
      '06 Oct 2026, 09:00 to 07 Oct 2026, 18:00: Lift repair',
    )
  })

  // @story: SCRUM-79
  // @ac: 3
  it('shows a message under each empty or blank field and sends nothing', async () => {
    renderPage()
    await openEndForm()

    await fillEndForm({ end_time: '   ' })
    await userEvent.click(screen.getByTestId('venue-detail-end-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-end-block-end-date-error')).toHaveTextContent('New end date is required')
    expect(screen.getByTestId('venue-detail-end-block-end-time-error')).toHaveTextContent('New end time is required')
    expect(api.endVenueBlock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-79
  // @ac: 3
  it('shows a message only under the field left empty', async () => {
    renderPage()
    await openEndForm()

    await fillEndForm({ end_date: '2026-10-07' })
    await userEvent.click(screen.getByTestId('venue-detail-end-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-end-block-end-time-error')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-end-block-end-date-error')).not.toBeInTheDocument()
    expect(api.endVenueBlock).not.toHaveBeenCalled()
  })

  // @story: SCRUM-79
  // @ac: 2
  it('closes the form on Cancel without sending, and reopens it empty', async () => {
    renderPage()
    await openEndForm()
    await fillEndForm({ end_date: '2026-10-07' })
    await userEvent.click(screen.getByTestId('venue-detail-end-block-confirm-button'))

    await userEvent.click(screen.getByTestId('venue-detail-end-block-cancel-button'))

    expect(screen.queryByTestId('venue-detail-end-block-end-date-input')).not.toBeInTheDocument()
    expect(api.endVenueBlock).not.toHaveBeenCalled()
    await openEndForm()
    expect(screen.getByTestId('venue-detail-end-block-end-date-input')).toHaveValue('')
    expect(screen.queryByTestId('venue-detail-end-block-end-time-error')).not.toBeInTheDocument()
  })

  // @story: SCRUM-79
  // @ac: 2, 4
  it('sends the new end entered, shows the shortened block in its place and says Block ended', async () => {
    api.endVenueBlock.mockResolvedValue({ ...IN_PROGRESS_BLOCK, end: '2026-10-06T17:30' })
    renderPage()
    await openEndForm()

    await fillEndForm({ end_date: '2026-10-06', end_time: '17:30' })
    await userEvent.click(screen.getByTestId('venue-detail-end-block-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-block-period-12')).toHaveTextContent(
        '06 Oct 2026, 09:00 to 06 Oct 2026, 17:30',
      )
    })
    expect(api.endVenueBlock).toHaveBeenCalledWith('3', 12, { end_date: '2026-10-06', end_time: '17:30' })
    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Block ended')
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
    expect(screen.queryByTestId('venue-detail-end-block-confirm-button')).not.toBeInTheDocument()
    const order = screen
      .getAllByTestId(/^venue-detail-block-row-/)
      .map((row) => row.getAttribute('data-testid'))
    expect(order).toEqual(['venue-detail-block-row-13', 'venue-detail-block-row-12', 'venue-detail-block-row-11'])
  })

  // @story: SCRUM-79
  // @ac: 3
  it('shows the API refusal to end in the banner, keeps the form open and the block unchanged', async () => {
    const message = "New end must be before the block's current end."
    api.endVenueBlock.mockRejectedValue(Object.assign(new Error(message), { status: 400 }))
    renderPage()
    await openEndForm()

    await fillEndForm({ end_date: '2026-10-07', end_time: '18:00' })
    await userEvent.click(screen.getByTestId('venue-detail-end-block-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(message)
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('venue-detail-end-block-confirm-button')).toBeEnabled()
    expect(screen.getByTestId('venue-detail-block-period-12')).toHaveTextContent(
      '06 Oct 2026, 09:00 to 07 Oct 2026, 18:00',
    )
  })

  // @story: SCRUM-79
  // @ac: 2
  it('disables the form buttons while the new end is being sent', async () => {
    api.endVenueBlock.mockReturnValue(new Promise(() => {}))
    renderPage()
    await openEndForm()

    await fillEndForm({ end_date: '2026-10-06', end_time: '17:30' })
    await userEvent.click(screen.getByTestId('venue-detail-end-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-end-block-confirm-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-end-block-cancel-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-remove-button-11')).toBeDisabled()
  })

  // @story: SCRUM-79
  // @ac: 2
  it('keeps one inline form open at a time: End early closes Block venue, and Block venue closes End early', async () => {
    renderPage()

    await openBlockForm()
    await openEndForm()

    expect(screen.getByTestId('venue-detail-end-block-end-date-input')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-block-reason-input')).not.toBeInTheDocument()

    await openBlockForm()

    expect(screen.getByTestId('venue-detail-block-reason-input')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-end-block-end-date-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-79
  // @ac: 2
  it('keeps one of the three inline forms open: opening Update venue, Block venue or End early closes the other two', async () => {
    // One input that only each form has, and the button that opens it.
    const FORMS = {
      update: { input: 'venue-detail-update-name-input', open: () => userEvent.click(screen.getByTestId('venue-detail-update-button')) },
      block: { input: 'venue-detail-block-reason-input', open: () => openBlockForm() },
      end: { input: 'venue-detail-end-block-end-date-input', open: () => openEndForm() },
    }
    const openForms = () =>
      Object.entries(FORMS)
        .filter(([, form]) => screen.queryByTestId(form.input))
        .map(([name]) => name)
    renderPage()
    await screen.findByTestId('venue-detail-block-end-button-12')

    // Every ordered pair once: update→block, block→end, end→update,
    // update→end, end→block, block→update.
    for (const name of ['update', 'block', 'end', 'update', 'end', 'block', 'update']) {
      await FORMS[name].open()
      expect(openForms()).toEqual([name])
    }
  })

  // @story: SCRUM-79
  // @ac: 2
  it('clears the banner when the End early form is opened', async () => {
    renderPage({ banner: 'Venue added' })
    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Venue added')

    await openEndForm()

    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })
})

// ---------------- SCRUM-80 Setup and turnaround time ----------------

async function openTimesForm() {
  await userEvent.click(await screen.findByTestId('venue-detail-times-button'))
  expect(screen.getByTestId('venue-detail-times-setup-time-input')).toBeVisible()
}

async function fillTimesForm({ setup_time, turnaround_time }) {
  const setup = screen.getByTestId('venue-detail-times-setup-time-input')
  const turnaround = screen.getByTestId('venue-detail-times-turnaround-time-input')
  await userEvent.clear(setup)
  if (setup_time !== '') await userEvent.type(setup, setup_time)
  await userEvent.clear(turnaround)
  if (turnaround_time !== '') await userEvent.type(turnaround, turnaround_time)
}

describe('VenueDetailPage setup and turnaround times', () => {
  // @story: SCRUM-80
  // @ac: 4
  it('shows zero minutes for each time a venue has never recorded, before and after a reload', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    const first = renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^0 minutes$/)
    })
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^0 minutes$/)
    first.unmount()

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^0 minutes$/)
    })
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^0 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 5
  it('shows both recorded times in the venue details', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    })
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 5
  it('reads one recorded minute as a singular minute', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, setup_time: 1, turnaround_time: 1 })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^1 minute$/)
    })
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^1 minute$/)
  })

  // @story: SCRUM-80
  // @ac: 5, 6
  it('offers Edit times to a Venue Staff account and shows both times', async () => {
    signInWith(['venues.view', 'venues.edit'])
    api.getVenue.mockResolvedValue(RECORDED_TIMES)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-times-button')).toBeVisible()
    })
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 5, 6
  it('shows both times but offers no way to change them without venues.edit', async () => {
    signInWith(['venues.view'])
    api.getVenue.mockResolvedValue(RECORDED_TIMES)

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    })
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
    expect(screen.queryByTestId('venue-detail-times-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-80
  // @ac: 1, 4
  it('opens the times form pre-filled with the recorded values and the blank-field hint', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)

    renderPage()
    await openTimesForm()

    expect(screen.getByTestId('venue-detail-times-setup-time-input')).toHaveValue(30)
    expect(screen.getByTestId('venue-detail-times-turnaround-time-input')).toHaveValue(15)
    expect(screen.getByTestId('venue-detail-times-hint')).toHaveTextContent('Leave blank for 0 minutes.')
    expect(screen.getByLabelText('Setup time (minutes)')).toBe(
      screen.getByTestId('venue-detail-times-setup-time-input'),
    )
    expect(screen.getByLabelText('Turnaround time (minutes)')).toBe(
      screen.getByTestId('venue-detail-times-turnaround-time-input'),
    )
    expect(screen.getByTestId('venue-detail-times-save-button')).toHaveTextContent('Save')
    expect(screen.getByTestId('venue-detail-times-cancel-button')).toHaveTextContent('Cancel')
  })

  // @story: SCRUM-80
  // @ac: 1, 4
  it('opens the times form with zero for a venue that never recorded either time', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage()
    await openTimesForm()

    expect(screen.getByTestId('venue-detail-times-setup-time-input')).toHaveValue(0)
    expect(screen.getByTestId('venue-detail-times-turnaround-time-input')).toHaveValue(0)
  })

  // @story: SCRUM-80
  // @ac: 1, 5
  it('saves both times and shows the saved values with a success banner', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, setup_time: 45, turnaround_time: 20 })

    renderPage()
    await openTimesForm()
    await fillTimesForm({ setup_time: '45', turnaround_time: '20' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(api.updateVenueTimes).toHaveBeenCalledWith('3', { setup_time: '45', turnaround_time: '20' })
    })
    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Times updated')
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^45 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^20 minutes$/)
    expect(screen.queryByTestId('venue-detail-times-setup-time-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-80
  // @ac: 1, 5
  it('changes only the setup time and keeps the recorded turnaround time', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, setup_time: 45 })

    renderPage()
    await openTimesForm()

    const setup = screen.getByTestId('venue-detail-times-setup-time-input')
    await userEvent.clear(setup)
    await userEvent.type(setup, '45')
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(api.updateVenueTimes).toHaveBeenCalledWith('3', { setup_time: '45', turnaround_time: 15 })
    })
    expect(await screen.findByTestId('venue-detail-setup-time')).toHaveTextContent(/^45 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 2, 5
  it('saves a cleared setup time as zero while keeping the turnaround time', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, setup_time: 0 })

    renderPage()
    await openTimesForm()

    await userEvent.clear(screen.getByTestId('venue-detail-times-setup-time-input'))
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(api.updateVenueTimes).toHaveBeenCalledWith('3', { setup_time: '', turnaround_time: 15 })
    })
    expect(await screen.findByTestId('venue-detail-setup-time')).toHaveTextContent(/^0 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 2, 5
  it('saves a cleared turnaround time as zero while keeping the setup time', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, turnaround_time: 0 })

    renderPage()
    await openTimesForm()

    await userEvent.clear(screen.getByTestId('venue-detail-times-turnaround-time-input'))
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(api.updateVenueTimes).toHaveBeenCalledWith('3', { setup_time: 30, turnaround_time: '' })
    })
    expect(await screen.findByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^0 minutes$/)
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 3
  it('shows the refusal naming the invalid field, keeps the form open and both stored times', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockRejectedValue(
      Object.assign(new Error('Setup time must be a non-negative whole number.'), { status: 400 }),
    )

    renderPage()
    await openTimesForm()
    await fillTimesForm({ setup_time: '0.5', turnaround_time: '20' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
        'Setup time must be a non-negative whole number.',
      )
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('venue-detail-times-setup-time-input')).toBeVisible()
    // jest-dom reads a number input's value as a number; the page still sends a string.
    expect(screen.getByTestId('venue-detail-times-setup-time-input')).toHaveValue(0.5)
    expect(screen.getByTestId('venue-detail-times-turnaround-time-input')).toHaveValue(20)
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 3
  it('shows the turnaround refusal and leaves both stored times unchanged', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockRejectedValue(
      Object.assign(new Error('Turnaround time must be a non-negative whole number.'), { status: 400 }),
    )

    renderPage()
    await openTimesForm()
    await fillTimesForm({ setup_time: '45', turnaround_time: '-1' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
        'Turnaround time must be a non-negative whole number.',
      )
    })
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 6
  it('shows the permission refusal and leaves both stored times unchanged', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    renderPage()
    await openTimesForm()
    await fillTimesForm({ setup_time: '45', turnaround_time: '20' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
        'You do not have permission to perform this action.',
      )
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 6
  it('shows the refusal when permissions change while the save is pending, and keeps the venue', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    let rejectSave
    api.updateVenueTimes.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectSave = reject
      }),
    )

    const rendered = renderPage()
    await openTimesForm()
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    signInWith(['venues.view'])
    rendered.rerender(venuePage())

    await act(async () => {
      rejectSave(Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }))
    })

    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
      'You do not have permission to perform this action.',
    )
    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A')
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-80
  // @ac: 1
  it('disables the times controls while the save is pending', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockReturnValue(new Promise(() => {}))

    renderPage()
    await openTimesForm()
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    expect(screen.getByTestId('venue-detail-times-save-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-times-cancel-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-update-button')).toBeDisabled()
    expect(screen.getByTestId('venue-detail-block-button')).toBeDisabled()
  })

  // @story: SCRUM-80
  // @ac: 1
  it('closes the times form on Cancel without sending and reopens with the stored values', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)

    renderPage()
    await openTimesForm()

    await fillTimesForm({ setup_time: '99', turnaround_time: '88' })
    await userEvent.click(screen.getByTestId('venue-detail-times-cancel-button'))

    expect(screen.queryByTestId('venue-detail-times-setup-time-input')).not.toBeInTheDocument()
    expect(api.updateVenueTimes).not.toHaveBeenCalled()

    await openTimesForm()
    expect(screen.getByTestId('venue-detail-times-setup-time-input')).toHaveValue(30)
    expect(screen.getByTestId('venue-detail-times-turnaround-time-input')).toHaveValue(15)
  })

  // @story: SCRUM-80
  // @ac: 1
  it('keeps one inline form open at a time: Edit times closes Update venue and Block venue', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    renderPage()
    await screen.findByTestId('venue-detail-times-button')

    await userEvent.click(screen.getByTestId('venue-detail-update-button'))
    expect(screen.getByTestId('venue-detail-update-name-input')).toBeInTheDocument()

    await openTimesForm()
    expect(screen.queryByTestId('venue-detail-update-name-input')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('venue-detail-block-button'))
    expect(screen.getByTestId('venue-detail-block-reason-input')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-times-setup-time-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-80
  // @ac: 1
  it('clears the banner when the times form is opened', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    renderPage({ banner: 'Venue added' })
    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Venue added')

    await openTimesForm()

    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-80
  // @ac: 5
  it('leaves the other venue details untouched when the times are saved', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, setup_time: 45, turnaround_time: 20 })

    renderPage()
    await openTimesForm()
    await fillTimesForm({ setup_time: '45', turnaround_time: '20' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^45 minutes$/)
    })
    expect(screen.getByTestId('venue-detail-name')).toHaveTextContent('Hall A')
    expect(screen.getByTestId('venue-detail-location')).toHaveTextContent('Block B Level 3')
    expect(screen.getByTestId('venue-detail-max-capacity')).toHaveTextContent('250')
    expect(screen.getByTestId('venue-detail-layouts-value')).toHaveTextContent('Classroom')
  })
})

describe('VenueDetailPage booking requests', () => {
  // @story: SCRUM-36
  // @ac: 4, 5
  it('lists each booking request with its event, period and status', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBookings.mockResolvedValue([
      {
        id: 12,
        event_request_id: 1,
        event_request_name: 'Tech Fair 2026',
        status: 'Requested',
        date: '2026-11-20',
        start_time: '09:00',
        end_time: '17:00',
      },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-booking-event-12')).toHaveTextContent('Tech Fair 2026')
    expect(screen.getByTestId('venue-detail-booking-period-12')).toHaveTextContent(
      '20 Nov 2026, 09:00–17:00',
    )
    expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Requested')
    expect(screen.queryByTestId('venue-detail-bookings-empty')).not.toBeInTheDocument()
    expect(api.listVenueBookings).toHaveBeenCalledWith('3')
  })

  // @story: SCRUM-36
  // @ac: 4
  it('says so when the venue has no booking requests', async () => {
    api.getVenue.mockResolvedValue(HALL_A)

    renderPage()

    expect(await screen.findByTestId('venue-detail-bookings-empty')).toHaveTextContent(
      'This venue has no booking requests.',
    )
  })

  // @story: SCRUM-37
  // @ac: 1
  it("shows attendance and the event's layout and facilities", async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBookings.mockResolvedValue([
      {
        id: 12,
        event_request_name: 'Tech Fair 2026',
        status: 'Requested',
        date: '2026-11-20',
        start_time: '09:00',
        end_time: '17:00',
        attendance: 75,
        layout: 'Theatre',
        facilities: ['Projector', 'Whiteboard'],
      },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-booking-attendance-12')).toHaveTextContent('75')
    expect(screen.getByTestId('venue-detail-booking-layout-12')).toHaveTextContent('Theatre')
    expect(screen.getByTestId('venue-detail-booking-facilities-12')).toHaveTextContent('Projector, Whiteboard')
    expect(screen.queryByTestId('venue-detail-booking-venue-requirements-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-37
  // @ac: 1
  it('shows None for a layout or facilities the event did not choose', async () => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBookings.mockResolvedValue([
      {
        id: 12,
        event_request_name: 'Tech Fair 2026',
        status: 'Requested',
        date: '2026-11-20',
        start_time: '09:00',
        end_time: '17:00',
        attendance: 75,
        layout: null,
        facilities: [],
      },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-booking-layout-12')).toHaveTextContent('None')
    expect(screen.getByTestId('venue-detail-booking-facilities-12')).toHaveTextContent('None')
  })
})

const REQUESTED_BOOKING = {
  id: 12,
  event_request_id: 4,
  event_request_name: 'Tech Fair 2026',
  status: 'Requested',
  date: '2026-11-20',
  start_time: '09:00',
  end_time: '17:00',
  // SCRUM-41: the API sends the occupied period with every booking row,
  // derived from the venue's durations.
  occupied_start: '2026-11-20T08:30',
  occupied_end: '2026-11-20T17:15',
  attendance: 75,
  layout: 'Theatre',
  facilities: ['Projector', 'Whiteboard'],
  raised_by: 'coord1',
}

describe('VenueDetailPage deciding a booking request', () => {
  beforeEach(() => {
    signInWith(['venues.view', 'bookings.decide'])
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBookings.mockResolvedValue([REQUESTED_BOOKING])
  })

  // @story: SCRUM-37
  // @ac: 6
  it('offers no Approve or Reject without bookings.decide', async () => {
    signInWith(['venues.view'])

    renderPage()

    await waitFor(() => screen.getByTestId('venue-detail-booking-row-12'))
    expect(screen.queryByTestId('venue-detail-booking-approve-button-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-booking-reject-button-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-37
  // @ac: 7
  it('offers no Approve or Reject once a booking is decided', async () => {
    api.listVenueBookings.mockResolvedValue([
      { ...REQUESTED_BOOKING, status: 'Approved', decision: 'Approved', decided_by: 'venue1', decided_at: '2026-10-08T08:00:00+00:00' },
    ])

    renderPage()

    await waitFor(() => screen.getByTestId('venue-detail-booking-row-12'))
    expect(screen.queryByTestId('venue-detail-booking-approve-button-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-booking-reject-button-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-37
  // @ac: 2, 4, 9
  it('approves a booking request with the API response, no reason required', async () => {
    api.approveBooking.mockResolvedValue({
      ...REQUESTED_BOOKING,
      status: 'Approved',
      decision: 'Approved',
      decided_by: 'venue1',
      decided_at: '2026-10-08T08:00:00+00:00',
    })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

    await waitFor(() => {
      expect(api.approveBooking).toHaveBeenCalledWith('3', 12, '')
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Booking approved')
    expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Approved')
    expect(screen.getByTestId('venue-detail-booking-decision-12')).toHaveTextContent('Approved by venue1')
  })

  // @story: SCRUM-37
  // @ac: 3, 5
  it('rejects a booking request with a reason', async () => {
    api.rejectBooking.mockResolvedValue({
      ...REQUESTED_BOOKING,
      status: 'Rejected',
      decision: 'Rejected',
      decision_reason: 'Venue under maintenance',
      decided_by: 'venue1',
      decided_at: '2026-10-08T08:00:00+00:00',
    })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-reject-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-reject-button-12'))
    await userEvent.type(screen.getByTestId('venue-detail-decide-reason-input'), 'Venue under maintenance')
    await userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

    await waitFor(() => {
      expect(api.rejectBooking).toHaveBeenCalledWith('3', 12, 'Venue under maintenance')
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Booking rejected')
    expect(screen.getByTestId('venue-detail-booking-decision-12')).toHaveTextContent(
      'Rejected by venue1',
    )
    expect(screen.getByTestId('venue-detail-booking-decision-12')).toHaveTextContent(
      'Venue under maintenance',
    )
  })

  // @story: SCRUM-37
  // @ac: 8
  it('refuses to reject without a reason, sending nothing', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-reject-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-reject-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

    expect(await screen.findByTestId('venue-detail-decide-reason-error')).toBeInTheDocument()
    expect(api.rejectBooking).not.toHaveBeenCalled()
  })

  // @story: SCRUM-37
  // @ac: 10
  it('leaves another booking row unchanged after deciding one', async () => {
    api.listVenueBookings.mockResolvedValue([
      REQUESTED_BOOKING,
      { ...REQUESTED_BOOKING, id: 13, event_request_name: 'Second Event' },
    ])
    api.approveBooking.mockResolvedValue({
      ...REQUESTED_BOOKING,
      status: 'Approved',
      decision: 'Approved',
      decided_by: 'venue1',
      decided_at: '2026-10-08T08:00:00+00:00',
    })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Approved')
    })
    expect(screen.getByTestId('venue-detail-booking-status-13')).toHaveTextContent('Requested')
  })

  // @story: SCRUM-37
  it('closes the decide form on Cancel without deciding', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-decide-cancel-button'))

    expect(screen.queryByTestId('venue-detail-decide-confirm-button')).not.toBeInTheDocument()
    expect(api.approveBooking).not.toHaveBeenCalled()
  })

  // @story: SCRUM-37
  it('shows the API refusal in the banner when deciding fails', async () => {
    api.approveBooking.mockRejectedValue(
      Object.assign(new Error('This booking request has already been decided (Approved).'), { status: 409 }),
    )

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
        'This booking request has already been decided (Approved).',
      )
    })
  })

  // @story: SCRUM-37
  // @ac: 3
  it('opening Reject on a booking closes an open Block venue form', async () => {
    signInWith(['venues.view', 'venues.edit', 'bookings.decide'])
    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-block-button'))
    await userEvent.click(screen.getByTestId('venue-detail-block-button'))
    expect(screen.getByTestId('venue-detail-block-confirm-button')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('venue-detail-booking-reject-button-12'))
    expect(screen.queryByTestId('venue-detail-block-confirm-button')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-decide-confirm-button')).toBeInTheDocument()
  })
})

describe('VenueDetailPage withdrawing a booking request', () => {
  beforeEach(() => {
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBookings.mockResolvedValue([REQUESTED_BOOKING])
  })

  // @story: SCRUM-77
  // @ac: 1
  it('offers Withdraw on a Requested booking the signed-in Coordinator raised', async () => {
    signInWith(['venues.view', 'bookings.edit'], 'coord1')

    renderPage()

    expect(await screen.findByTestId('venue-detail-booking-withdraw-button-12')).toBeInTheDocument()
  })

  // @story: SCRUM-77
  // @ac: 4
  it('offers no Withdraw on a booking raised by a different Coordinator', async () => {
    signInWith(['venues.view', 'bookings.edit'], 'coord2')

    renderPage()

    await waitFor(() => screen.getByTestId('venue-detail-booking-row-12'))
    expect(screen.queryByTestId('venue-detail-booking-withdraw-button-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-77
  it('offers no Withdraw without bookings.edit', async () => {
    signInWith(['venues.view'], 'coord1')

    renderPage()

    await waitFor(() => screen.getByTestId('venue-detail-booking-row-12'))
    expect(screen.queryByTestId('venue-detail-booking-withdraw-button-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-77
  // @ac: 2
  it('offers no Withdraw once the booking is no longer Requested', async () => {
    api.listVenueBookings.mockResolvedValue([{ ...REQUESTED_BOOKING, status: 'Approved' }])
    signInWith(['venues.view', 'bookings.edit'], 'coord1')

    renderPage()

    await waitFor(() => screen.getByTestId('venue-detail-booking-row-12'))
    expect(screen.queryByTestId('venue-detail-booking-withdraw-button-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-77
  // @ac: 1
  it('withdraws a booking at once, no confirmation, with the API response', async () => {
    signInWith(['venues.view', 'bookings.edit'], 'coord1')
    api.withdrawBooking.mockResolvedValue({ ...REQUESTED_BOOKING, status: 'Withdrawn' })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-withdraw-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-withdraw-button-12'))

    await waitFor(() => {
      expect(api.withdrawBooking).toHaveBeenCalledWith('3', 12)
    })
    expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Booking withdrawn')
    expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Withdrawn')
  })

  // @story: SCRUM-77
  it('shows the API refusal in the banner when withdrawing fails', async () => {
    signInWith(['venues.view', 'bookings.edit'], 'coord1')
    api.withdrawBooking.mockRejectedValue(
      Object.assign(new Error('This booking request has already been decided (Approved).'), { status: 409 }),
    )

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-withdraw-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-withdraw-button-12'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
        'This booking request has already been decided (Approved).',
      )
    })
  })

  // @story: SCRUM-77
  // @ac: 5
  it('leaves another booking row unchanged after withdrawing one', async () => {
    api.listVenueBookings.mockResolvedValue([
      REQUESTED_BOOKING,
      { ...REQUESTED_BOOKING, id: 13, event_request_name: 'Second Event' },
    ])
    signInWith(['venues.view', 'bookings.edit'], 'coord1')
    api.withdrawBooking.mockResolvedValue({ ...REQUESTED_BOOKING, status: 'Withdrawn' })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-withdraw-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-withdraw-button-12'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Withdrawn')
    })
    expect(screen.getByTestId('venue-detail-booking-status-13')).toHaveTextContent('Requested')
  })
})

// ---------------- SCRUM-41 Occupied periods and current clashes ----------------

// Hall A records 30 minutes of setup and 15 of turnaround (RECORDED_TIMES), so
// an event on 15 Dec 2026 10:00–12:00 occupies 09:30–12:15. The fixtures are
// what the API sends: the published period never rewritten, the occupied one
// derived beside it.
const APPROVED_A = {
  id: 12,
  event_request_id: 4,
  event_request_name: 'Tech Fair 2026',
  status: 'Approved',
  date: '2026-12-15',
  start_time: '10:00',
  end_time: '12:00',
  occupied_start: '2026-12-15T09:30',
  occupied_end: '2026-12-15T12:15',
}

const APPROVED_B = {
  id: 13,
  event_request_id: 5,
  event_request_name: 'Alumni Dinner',
  status: 'Approved',
  date: '2026-12-15',
  start_time: '12:30',
  end_time: '13:30',
  occupied_start: '2026-12-15T12:00',
  occupied_end: '2026-12-15T13:45',
}

// The clash list is the lean payload (api.js): event, occupied period and the
// published one beside it.
const CLASH_A = {
  id: 12,
  event_request_id: 4,
  event_request_name: 'Tech Fair 2026',
  occupied_start: '2026-12-15T09:30',
  occupied_end: '2026-12-15T12:15',
  date: '2026-12-15',
  start_time: '10:00',
  end_time: '12:00',
}

const CLASH_B = {
  id: 13,
  event_request_id: 5,
  event_request_name: 'Alumni Dinner',
  occupied_start: '2026-12-15T12:00',
  occupied_end: '2026-12-15T13:45',
  date: '2026-12-15',
  start_time: '12:30',
  end_time: '13:30',
}

describe('VenueDetailPage occupied periods', () => {
  // @story: SCRUM-41
  // @ac: 1, 5
  it('shows a clamped occupied period exactly as the API sends it', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    // The extreme-duration read the API answers with: an enormous setup time
    // pushes the occupied start to the first date Python represents, and the
    // page must render that value, not crash on it.
    api.listVenueBookings.mockResolvedValue([
      { ...APPROVED_A, occupied_start: '0001-01-01T00:00', occupied_end: '2026-12-15T12:15' },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-occupied-row-12')).toBeVisible()
    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '01 Jan 0001, 00:00 to 15 Dec 2026, 12:15',
    )
    // The published period beside it never moves (AC1).
    expect(screen.getByTestId('venue-detail-booking-period-12')).toHaveTextContent(
      '15 Dec 2026, 10:00–12:00',
    )
  })

  // @story: SCRUM-41
  // @ac: 1, 2
  it('lists each approved booking with its occupied period, earliest first', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([APPROVED_B, APPROVED_A])

    renderPage()

    expect(await screen.findByTestId('venue-detail-occupied-row-12')).toBeVisible()
    expect(screen.getByTestId('venue-detail-occupied-event-12')).toHaveTextContent('Tech Fair 2026')
    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
    )
    expect(screen.getByTestId('venue-detail-occupied-period-13')).toHaveTextContent(
      '15 Dec 2026, 12:00 to 15 Dec 2026, 13:45',
    )
    // Earliest occupied period first, whatever order the API sent.
    const rows = screen.getAllByTestId(/^venue-detail-occupied-row-/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'venue-detail-occupied-row-12',
      'venue-detail-occupied-row-13',
    ])
    expect(screen.queryByTestId('venue-detail-occupied-empty')).not.toBeInTheDocument()
    expect(api.listVenueBookings).toHaveBeenCalledWith('3')
  })

  // @story: SCRUM-41
  // @ac: 1
  it('shows both dates when setup rolls the occupied period into the previous date', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([
      {
        ...APPROVED_A,
        start_time: '00:15',
        end_time: '01:15',
        occupied_start: '2026-12-14T23:45',
        occupied_end: '2026-12-15T01:30',
      },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '14 Dec 2026, 23:45 to 15 Dec 2026, 01:30',
    )
  })

  // @story: SCRUM-41
  // @ac: 1
  it('shows both dates when turnaround rolls the occupied period into the next date', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, setup_time: 30, turnaround_time: 30 })
    api.listVenueBookings.mockResolvedValue([
      {
        ...APPROVED_A,
        start_time: '23:00',
        end_time: '23:45',
        occupied_start: '2026-12-15T22:30',
        occupied_end: '2026-12-16T00:15',
      },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 22:30 to 16 Dec 2026, 00:15',
    )
  })

  // @story: SCRUM-41
  // @ac: 2
  it('orders bookings that share an occupied start by id', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([
      { ...APPROVED_B, id: 13, occupied_start: '2026-12-15T09:30' },
      { ...APPROVED_A, id: 12 },
    ])

    renderPage()

    await waitFor(() => screen.getByTestId('venue-detail-occupied-row-12'))
    const rows = screen.getAllByTestId(/^venue-detail-occupied-row-/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'venue-detail-occupied-row-12',
      'venue-detail-occupied-row-13',
    ])
  })

  // @story: SCRUM-41
  // @ac: 2
  it('says the venue has no approved bookings, and only that, when the list is empty', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([
      { ...APPROVED_A, status: 'Requested' },
      { ...APPROVED_B, status: 'Rejected' },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-detail-occupied-empty')).toHaveTextContent(
      'This venue has no approved bookings.',
    )
    expect(screen.getByTestId('venue-detail-occupied-empty')).not.toHaveTextContent('no blocks')
    expect(screen.getByTestId('venue-detail-occupied-empty')).not.toHaveTextContent('free')
  })

  // @story: SCRUM-41
  // @ac: 1
  it('keeps the published period on the booking row beside the occupied one', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([APPROVED_A])

    renderPage()

    expect(await screen.findByTestId('venue-detail-booking-period-12')).toHaveTextContent(
      '15 Dec 2026, 10:00–12:00',
    )
    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
    )
  })

  // @story: SCRUM-41
  // @ac: 2
  it('links the event name to its request with requests.view', async () => {
    signInWith(['venues.view', 'requests.view'])
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([APPROVED_A])

    renderPage()

    const event = await screen.findByTestId('venue-detail-occupied-event-12')
    expect(event.querySelector('a')).toHaveAttribute('href', '/requests/4')
    expect(event).toHaveTextContent('Tech Fair 2026')
  })

  // @story: SCRUM-41
  // @ac: 2
  it('shows the event name as plain text without requests.view', async () => {
    signInWith(['venues.view'])
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([APPROVED_A])

    renderPage()

    const event = await screen.findByTestId('venue-detail-occupied-event-12')
    expect(event.querySelector('a')).toBeNull()
    expect(event).toHaveTextContent('Tech Fair 2026')
  })

  // @story: SCRUM-41
  // @ac: 1
  it('brings a newly approved booking into the list with its occupied period', async () => {
    signInWith(['venues.view', 'bookings.decide'])
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([{ ...REQUESTED_BOOKING, ...APPROVED_A, status: 'Requested' }])
    api.approveBooking.mockResolvedValue({
      ...REQUESTED_BOOKING,
      ...APPROVED_A,
      decision: 'Approved',
      decided_by: 'venue1',
      decided_at: '2026-10-08T08:00:00+00:00',
    })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-booking-approve-button-12'))
    await userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
        '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
      )
    })
    expect(screen.getByTestId('venue-detail-occupied-event-12')).toHaveTextContent('Tech Fair 2026')
    expect(api.listVenueClashes).not.toHaveBeenCalled()
  })
})

describe('VenueDetailPage current clashes', () => {
  // @story: SCRUM-41
  // @ac: 5
  it('lists every booking of a clashing chain once, earliest first', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    const clashingC = {
      ...CLASH_B,
      id: 14,
      event_request_id: 6,
      event_request_name: 'Career Fair',
      occupied_start: '2026-12-15T13:30',
      occupied_end: '2026-12-15T15:15',
      date: '2026-12-15',
      start_time: '14:00',
      end_time: '15:00',
    }
    api.listVenueClashes.mockResolvedValue([clashingC, CLASH_B, CLASH_A])

    renderPage()

    expect(await screen.findByTestId('venue-detail-clash-row-12')).toBeVisible()
    const rows = screen.getAllByTestId(/^venue-detail-clash-row-/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'venue-detail-clash-row-12',
      'venue-detail-clash-row-13',
      'venue-detail-clash-row-14',
    ])
    expect(screen.getByTestId('venue-detail-clash-event-13')).toHaveTextContent('Alumni Dinner')
    expect(screen.getByTestId('venue-detail-clash-period-13')).toHaveTextContent(
      '15 Dec 2026, 12:00 to 15 Dec 2026, 13:45',
    )
    expect(screen.queryByTestId('venue-detail-clashes-empty')).not.toBeInTheDocument()
    expect(api.listVenueClashes).toHaveBeenCalledWith('3')
  })

  // @story: SCRUM-41
  // @ac: 5
  it('says so when nothing currently clashes', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([APPROVED_A])

    renderPage()

    expect(await screen.findByTestId('venue-detail-clashes-empty')).toHaveTextContent(
      'No approved bookings currently clash.',
    )
  })

  // @story: SCRUM-41
  // @ac: 5
  it('shows the section only to an account with venues.edit, and never asks for the list without it', async () => {
    signInWith(['venues.view', 'requests.view'])
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValue([APPROVED_A])

    renderPage()

    expect(await screen.findByTestId('venue-detail-occupied-row-12')).toBeVisible()
    expect(screen.queryByTestId('venue-detail-clashes-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-clash-row-12')).not.toBeInTheDocument()
    expect(api.listVenueClashes).not.toHaveBeenCalled()
  })

  // @story: SCRUM-41
  // @ac: 5
  it('links a clashing event name to its request with requests.view and shows plain text without it', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueClashes.mockResolvedValue([CLASH_A])

    signInWith(['venues.view', 'venues.edit', 'requests.view'])
    const first = renderPage()
    const linked = await screen.findByTestId('venue-detail-clash-event-12')
    expect(linked.querySelector('a')).toHaveAttribute('href', '/requests/4')
    first.unmount()

    signInWith(['venues.view', 'venues.edit'])
    renderPage()
    const event = await screen.findByTestId('venue-detail-clash-event-12')
    expect(event.querySelector('a')).toBeNull()
    expect(event).toHaveTextContent('Tech Fair 2026')
  })

  // @story: SCRUM-41
  // @ac: 5
  it('reloads the occupied periods and the clashes after a duration save exposes a clash', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, setup_time: 0, turnaround_time: 0 })
    // Before the save the three bookings' occupied periods are their published
    // ones and nothing clashes; after it (30/15) A and B do.
    api.listVenueBookings
      .mockResolvedValueOnce([
        { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:00' },
        { ...APPROVED_B, occupied_start: '2026-12-15T12:30', occupied_end: '2026-12-15T13:30' },
      ])
      .mockResolvedValue([APPROVED_A, APPROVED_B])
    api.listVenueClashes.mockResolvedValueOnce([]).mockResolvedValue([CLASH_A, CLASH_B])
    api.updateVenueTimes.mockResolvedValue({ ...HALL_A, setup_time: 30, turnaround_time: 15 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
        '15 Dec 2026, 10:00 to 15 Dec 2026, 12:00',
      )
    })
    expect(screen.getByTestId('venue-detail-clashes-empty')).toBeVisible()

    await openTimesForm()
    await fillTimesForm({ setup_time: '30', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-clash-row-12')).toBeVisible()
    })
    expect(screen.getByTestId('venue-detail-clash-row-13')).toBeVisible()
    expect(screen.queryByTestId('venue-detail-clashes-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
    )
    // Nothing about the bookings themselves changed (AC5).
    expect(screen.getByTestId('venue-detail-booking-period-12')).toHaveTextContent(
      '15 Dec 2026, 10:00–12:00',
    )
    expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Approved')
    expect(api.listVenueBookings).toHaveBeenCalledTimes(2)
    expect(api.listVenueClashes).toHaveBeenCalledTimes(2)
  })

  // @story: SCRUM-41
  // @ac: 5
  it('drops the clashes a reduced duration resolves, without changing the bookings', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings.mockResolvedValueOnce([APPROVED_A, APPROVED_B]).mockResolvedValue([
      { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:15' },
      { ...APPROVED_B, occupied_start: '2026-12-15T12:30', occupied_end: '2026-12-15T13:45' },
    ])
    api.listVenueClashes.mockResolvedValueOnce([CLASH_A, CLASH_B]).mockResolvedValue([])
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, setup_time: 0, turnaround_time: 15 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-clash-row-12')).toBeVisible()
    })
    expect(screen.getByTestId('venue-detail-clash-row-13')).toBeVisible()

    await openTimesForm()
    await fillTimesForm({ setup_time: '0', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-clashes-empty')).toHaveTextContent(
        'No approved bookings currently clash.',
      )
    })
    expect(screen.queryByTestId('venue-detail-clash-row-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-clash-row-13')).not.toBeInTheDocument()
    // Both bookings keep their dates, event times and status (AC5).
    expect(screen.getByTestId('venue-detail-booking-period-12')).toHaveTextContent(
      '15 Dec 2026, 10:00–12:00',
    )
    expect(screen.getByTestId('venue-detail-booking-period-13')).toHaveTextContent(
      '15 Dec 2026, 12:30–13:30',
    )
    expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Approved')
    expect(screen.getByTestId('venue-detail-booking-status-13')).toHaveTextContent('Approved')
    expect(screen.getByTestId('venue-detail-turnaround-time')).toHaveTextContent(/^15 minutes$/)
  })

  // @story: SCRUM-41
  // @ac: 5
  it('shows the API refusal in the banner when the clash list cannot be loaded', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueClashes.mockRejectedValue(new Error('Clash list unavailable.'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Clash list unavailable.')
    })
  })
})

describe('VenueDetailPage reloading the lists after a duration save', () => {
  // @story: SCRUM-41
  // @ac: 5
  it('acknowledges the save and marks the occupied and request lists unavailable when the bookings reload refuses', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, setup_time: 0, turnaround_time: 0 })
    // Mount shows the periods the old durations give; the reload after the
    // save refuses, so those rows must not stay on the page as current.
    api.listVenueBookings
      .mockResolvedValueOnce([
        { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:00' },
      ])
      .mockRejectedValueOnce(new Error('Bookings unavailable.'))
    api.listVenueClashes.mockResolvedValueOnce([]).mockResolvedValue([CLASH_A])
    api.updateVenueTimes.mockResolvedValue({ ...HALL_A, setup_time: 30, turnaround_time: 15 })

    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
        '15 Dec 2026, 10:00 to 15 Dec 2026, 12:00',
      )
    })

    await openTimesForm()
    await fillTimesForm({ setup_time: '30', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    // The save is acknowledged as a success — this is not a save refusal.
    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Times updated')
    expect(screen.getByTestId('venue-detail-banner')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^30 minutes$/)
    // The save landed, so the form closes even though a refresh refused.
    expect(screen.queryByTestId('venue-detail-times-setup-time-input')).not.toBeInTheDocument()

    // The lists that fetch feeds are unavailable, not their old results.
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-unavailable')).toBeVisible()
    })
    expect(screen.queryByTestId('venue-detail-occupied-row-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-occupied-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-bookings-unavailable')).toBeVisible()
    expect(screen.queryByTestId('venue-detail-booking-row-12')).not.toBeInTheDocument()

    // The list the other fetch feeds is reloaded and current.
    expect(screen.getByTestId('venue-detail-clash-row-12')).toBeVisible()
    expect(api.listVenueBookings).toHaveBeenCalledTimes(2)
    expect(api.listVenueClashes).toHaveBeenCalledTimes(2)
  })

  // @story: SCRUM-41
  // @ac: 5
  it('acknowledges the save and marks the clash list unavailable when the clashes reload refuses', async () => {
    api.getVenue.mockResolvedValue(RECORDED_TIMES)
    api.listVenueBookings
      .mockResolvedValueOnce([
        { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:00' },
      ])
      .mockResolvedValue([APPROVED_A])
    // Mount shows the clashes the old durations made; the reload refuses, so
    // neither those rows nor the empty state may stand in for a current read.
    api.listVenueClashes
      .mockResolvedValueOnce([CLASH_A, CLASH_B])
      .mockRejectedValue(new Error('Clashes unavailable.'))
    api.updateVenueTimes.mockResolvedValue({ ...RECORDED_TIMES, setup_time: 0, turnaround_time: 15 })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('venue-detail-clash-row-12')).toBeVisible())
    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 10:00 to 15 Dec 2026, 12:00',
    )

    await openTimesForm()
    await fillTimesForm({ setup_time: '0', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Times updated')
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-clashes-unavailable')).toBeVisible()
    })
    expect(screen.queryByTestId('venue-detail-clash-row-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-clash-row-13')).not.toBeInTheDocument()
    // The refusal must not read as "nothing clashes".
    expect(screen.queryByTestId('venue-detail-clashes-empty')).not.toBeInTheDocument()
    // The bookings list did reload: its new occupied period is showing.
    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
    )
    expect(screen.getByTestId('venue-detail-booking-row-12')).toBeVisible()
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^0 minutes$/)
  })

  // @story: SCRUM-41
  // @ac: 5
  it('recovers an unavailable list through its Reload control', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, setup_time: 0, turnaround_time: 0 })
    api.listVenueBookings
      .mockResolvedValueOnce([
        { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:00' },
      ])
      .mockRejectedValueOnce(new Error('Bookings unavailable.'))
      .mockResolvedValue([APPROVED_A])
    api.updateVenueTimes.mockResolvedValue({ ...HALL_A, setup_time: 30, turnaround_time: 15 })

    renderPage()
    await waitFor(() => screen.getByTestId('venue-detail-occupied-row-12'))

    await openTimesForm()
    await fillTimesForm({ setup_time: '30', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-unavailable')).toBeVisible()
    })

    await userEvent.click(screen.getByTestId('venue-detail-occupied-reload-button'))

    // The recovery path reads the list again and it comes back current.
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
        '15 Dec 2026, 09:30 to 15 Dec 2026, 12:15',
      )
    })
    expect(screen.queryByTestId('venue-detail-occupied-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-detail-bookings-unavailable')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-booking-row-12')).toBeVisible()
    expect(api.listVenueBookings).toHaveBeenCalledTimes(3)
  })

  // @story: SCRUM-41
  // @ac: 5
  it('keeps the latest save\'s lists when an earlier save\'s refresh finishes late', async () => {
    api.getVenue.mockResolvedValue({ ...HALL_A, setup_time: 0, turnaround_time: 0 })
    // The first save's refresh is held open until the second save's refresh
    // has landed, reproducing two saves whose refreshes finish out of order.
    let releaseFirstRefresh
    const firstRefresh = new Promise((resolve) => {
      releaseFirstRefresh = resolve
    })
    api.listVenueBookings
      // Mount: no buffers yet (0/0).
      .mockResolvedValueOnce([
        { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:00' },
      ])
      // Save 1 (30/15) refresh: the buffered periods, delivered late.
      .mockReturnValueOnce(firstRefresh)
      // Save 2 (0/15) refresh: turnaround only, delivered first.
      .mockResolvedValueOnce([
        { ...APPROVED_A, occupied_start: '2026-12-15T10:00', occupied_end: '2026-12-15T12:15' },
      ])
    api.listVenueClashes.mockResolvedValue([])
    api.updateVenueTimes
      .mockResolvedValueOnce({ ...HALL_A, setup_time: 30, turnaround_time: 15 })
      .mockResolvedValueOnce({ ...HALL_A, setup_time: 0, turnaround_time: 15 })

    renderPage()
    await waitFor(() => expect(screen.getByTestId('venue-detail-occupied-row-12')).toBeVisible())

    // Save 1: 30 setup / 15 turnaround; its refresh stays in flight.
    await openTimesForm()
    await fillTimesForm({ setup_time: '30', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))
    await waitFor(() => expect(api.listVenueBookings).toHaveBeenCalledTimes(2))

    // Save 2 while save 1's refresh is still running: the form is available
    // again as soon as the save is acknowledged.
    await openTimesForm()
    await fillTimesForm({ setup_time: '0', turnaround_time: '15' })
    await userEvent.click(screen.getByTestId('venue-detail-times-save-button'))
    await waitFor(() => expect(api.listVenueBookings).toHaveBeenCalledTimes(3))
    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
        '15 Dec 2026, 10:00 to 15 Dec 2026, 12:15',
      )
    })
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^0 minutes$/)

    // The first save's refresh now lands late, carrying the 30-minute-buffer
    // periods. It must not overwrite the newer save's lists.
    await act(async () => {
      releaseFirstRefresh([
        { ...APPROVED_A, occupied_start: '2026-12-15T09:30', occupied_end: '2026-12-15T12:15' },
      ])
    })

    expect(screen.getByTestId('venue-detail-occupied-period-12')).toHaveTextContent(
      '15 Dec 2026, 10:00 to 15 Dec 2026, 12:15',
    )
    expect(screen.queryByTestId('venue-detail-occupied-period-12')).not.toHaveTextContent('09:30')
    expect(screen.getByTestId('venue-detail-setup-time')).toHaveTextContent(/^0 minutes$/)
    expect(api.listVenueBookings).toHaveBeenCalledTimes(3)
  })
})

// SCRUM-78: Venue Staff may suggest another venue or period when they reject.
describe('VenueDetailPage suggesting an alternative when rejecting', () => {
  const VENUES = [
    { id: 3, name: 'Hall A', is_active: true },
    { id: 4, name: 'Auditorium', is_active: true },
    { id: 5, name: 'Old Hall', is_active: false },
  ]
  const rejected = (extra = {}) => ({
    ...REQUESTED_BOOKING,
    status: 'Rejected',
    decision: 'Rejected',
    decision_reason: 'Hall A is taken that day.',
    decided_by: 'venue1',
    decided_at: '2026-10-08T08:00:00+00:00',
    suggested_venue_id: null,
    suggested_venue: null,
    suggested_date: null,
    suggested_start_time: null,
    suggested_end_time: null,
    ...extra,
  })

  beforeEach(() => {
    signInWith(['venues.view', 'bookings.decide'])
    api.getVenue.mockResolvedValue(HALL_A)
    api.listVenueBookings.mockResolvedValue([REQUESTED_BOOKING])
    api.listVenues.mockResolvedValue(VENUES)
  })

  async function openReject() {
    renderPage()
    await userEvent.click(await screen.findByTestId('venue-detail-booking-reject-button-12'))
    await screen.findByTestId('venue-detail-decide-suggested-venue-input')
  }

  const reason = (text = 'Hall A is taken that day.') =>
    userEvent.type(screen.getByTestId('venue-detail-decide-reason-input'), text)
  const setField = (name, value) =>
    fireEvent.change(screen.getByTestId(`venue-detail-decide-${name}-input`), { target: { value } })
  const confirm = () => userEvent.click(screen.getByTestId('venue-detail-decide-confirm-button'))

  // @story: SCRUM-78
  // @ac: 1
  it('offers the suggestion fields on Reject, with None and the active venues only', async () => {
    await openReject()

    const options = [...screen.getByTestId('venue-detail-decide-suggested-venue-input').options].map(
      (option) => option.textContent,
    )
    expect(options).toEqual(['None', 'Hall A', 'Auditorium'])
    expect(screen.getByTestId('venue-detail-decide-suggested-date-input')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-decide-suggested-start-time-input')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-decide-suggested-end-time-input')).toBeInTheDocument()
  })

  // @story: SCRUM-78
  // @ac: 1
  it('offers no suggestion on Approve', async () => {
    renderPage()
    await userEvent.click(await screen.findByTestId('venue-detail-booking-approve-button-12'))

    await screen.findByTestId('venue-detail-decide-reason-input')
    expect(screen.queryByTestId('venue-detail-decide-suggested-venue-input')).not.toBeInTheDocument()
    expect(api.listVenues).not.toHaveBeenCalled()
  })

  // @story: SCRUM-78
  // @ac: 1, 3
  it('rejects with a suggested venue only and shows it beside the reason', async () => {
    api.rejectBooking.mockResolvedValue(rejected({ suggested_venue_id: 4, suggested_venue: 'Auditorium' }))
    await openReject()

    await reason()
    await userEvent.selectOptions(screen.getByTestId('venue-detail-decide-suggested-venue-input'), 'Auditorium')
    await confirm()

    await waitFor(() => {
      expect(api.rejectBooking).toHaveBeenCalledWith('3', 12, 'Hall A is taken that day.', {
        suggested_venue_id: 4,
      })
    })
    expect(screen.getByTestId('venue-detail-booking-decision-12')).toHaveTextContent('Hall A is taken that day.')
    expect(screen.getByTestId('venue-detail-booking-suggested-venue-12')).toHaveTextContent('Auditorium')
    expect(screen.queryByTestId('venue-detail-booking-suggested-period-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-78
  // @ac: 1, 3
  it('rejects with a suggested period only and shows it beside the reason', async () => {
    api.rejectBooking.mockResolvedValue(
      rejected({ suggested_date: '2026-11-21', suggested_start_time: '09:00', suggested_end_time: '12:00' }),
    )
    await openReject()

    await reason()
    setField('suggested-date', '2026-11-21')
    setField('suggested-start-time', '09:00')
    setField('suggested-end-time', '12:00')
    await confirm()

    await waitFor(() => {
      expect(api.rejectBooking).toHaveBeenCalledWith('3', 12, 'Hall A is taken that day.', {
        suggested_date: '2026-11-21',
        suggested_start_time: '09:00',
        suggested_end_time: '12:00',
      })
    })
    expect(screen.getByTestId('venue-detail-booking-suggested-period-12')).toHaveTextContent(
      '21 Nov 2026, 09:00–12:00',
    )
    expect(screen.queryByTestId('venue-detail-booking-suggested-venue-12')).not.toBeInTheDocument()
  })

  // @story: SCRUM-78
  // @ac: 1
  it('rejects with both a suggested venue and a suggested period', async () => {
    api.rejectBooking.mockResolvedValue(
      rejected({
        suggested_venue_id: 4,
        suggested_venue: 'Auditorium',
        suggested_date: '2026-11-21',
        suggested_start_time: '10:00',
        suggested_end_time: '13:00',
      }),
    )
    await openReject()

    await reason()
    await userEvent.selectOptions(screen.getByTestId('venue-detail-decide-suggested-venue-input'), 'Auditorium')
    setField('suggested-date', '2026-11-21')
    setField('suggested-start-time', '10:00')
    setField('suggested-end-time', '13:00')
    await confirm()

    await waitFor(() => {
      expect(api.rejectBooking).toHaveBeenCalledWith('3', 12, 'Hall A is taken that day.', {
        suggested_venue_id: 4,
        suggested_date: '2026-11-21',
        suggested_start_time: '10:00',
        suggested_end_time: '13:00',
      })
    })
    expect(screen.getByTestId('venue-detail-booking-suggested-venue-12')).toHaveTextContent('Auditorium')
    expect(screen.getByTestId('venue-detail-booking-suggested-period-12')).toHaveTextContent(
      '21 Nov 2026, 10:00–13:00',
    )
  })

  // @story: SCRUM-78
  // @ac: 1
  it('sends a plain rejection when nothing is suggested, and shows no suggestion', async () => {
    api.rejectBooking.mockResolvedValue(rejected())
    await openReject()

    await reason()
    await confirm()

    await waitFor(() => {
      expect(api.rejectBooking).toHaveBeenCalledWith('3', 12, 'Hall A is taken that day.')
    })
    expect(screen.getByTestId('venue-detail-booking-suggestion-12')).toBeEmptyDOMElement()
  })

  // @story: SCRUM-78
  // @ac: 2
  it('shows a message under each empty part of a started period and sends nothing', async () => {
    await openReject()

    await reason()
    setField('suggested-date', '2026-11-21')
    await confirm()

    expect(screen.getByTestId('venue-detail-decide-suggested-start-time-error')).toHaveTextContent(
      'Suggested start time is required.',
    )
    expect(screen.getByTestId('venue-detail-decide-suggested-end-time-error')).toHaveTextContent(
      'Suggested end time is required.',
    )
    expect(screen.queryByTestId('venue-detail-decide-suggested-date-error')).not.toBeInTheDocument()
    expect(api.rejectBooking).not.toHaveBeenCalled()
  })

  // @story: SCRUM-78
  // @ac: 1, 2
  it('shows the missing reason and the incomplete period together', async () => {
    await openReject()

    setField('suggested-end-time', '12:00')
    await confirm()

    expect(screen.getByTestId('venue-detail-decide-reason-error')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-decide-suggested-date-error')).toBeInTheDocument()
    expect(api.rejectBooking).not.toHaveBeenCalled()
  })

  // @story: SCRUM-78
  // @ac: 2
  it('shows the API refusal in the banner and keeps the form and its entries', async () => {
    api.rejectBooking.mockRejectedValue(
      Object.assign(new Error('The suggested start time must be before the end time.'), { status: 400 }),
    )
    await openReject()

    await reason()
    setField('suggested-date', '2026-11-21')
    setField('suggested-start-time', '12:00')
    setField('suggested-end-time', '12:00')
    await confirm()

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent(
        'The suggested start time must be before the end time.',
      )
    })
    expect(screen.getByTestId('venue-detail-decide-suggested-start-time-input')).toHaveValue('12:00')
    expect(screen.getByTestId('venue-detail-booking-status-12')).toHaveTextContent('Requested')
  })

  // @story: SCRUM-78
  // @ac: 1
  it('starts the suggestion empty each time, and loads the venues only once', async () => {
    await openReject()
    setField('suggested-date', '2026-11-21')
    await userEvent.click(screen.getByTestId('venue-detail-decide-cancel-button'))

    await userEvent.click(screen.getByTestId('venue-detail-booking-reject-button-12'))

    expect(screen.getByTestId('venue-detail-decide-suggested-date-input')).toHaveValue('')
    expect(api.listVenues).toHaveBeenCalledTimes(1)
  })

  // @story: SCRUM-78
  // @ac: 1
  it('shows the venues error in the banner when they cannot be loaded', async () => {
    api.listVenues.mockRejectedValue(Object.assign(new Error('Something went wrong'), { status: 500 }))
    renderPage()
    await userEvent.click(await screen.findByTestId('venue-detail-booking-reject-button-12'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-detail-banner')).toHaveTextContent('Something went wrong')
    })
  })

  // @story: SCRUM-78
  // @ac: 3
  it('shows an Event Coordinator the suggestion beside the reason', async () => {
    signInWith(['venues.view', 'bookings.edit'], 'coord1')
    api.listVenueBookings.mockResolvedValue([
      rejected({
        suggested_venue_id: 4,
        suggested_venue: 'Auditorium',
        suggested_date: '2026-11-21',
        suggested_start_time: '10:00',
        suggested_end_time: '13:00',
      }),
    ])

    renderPage()

    await screen.findByTestId('venue-detail-booking-suggested-venue-12')
    expect(screen.getByTestId('venue-detail-booking-decision-12')).toHaveTextContent('Hall A is taken that day.')
    expect(screen.getByTestId('venue-detail-booking-suggested-venue-12')).toHaveTextContent('Auditorium')
    expect(screen.getByTestId('venue-detail-booking-suggested-period-12')).toHaveTextContent(
      '21 Nov 2026, 10:00–13:00',
    )
    expect(screen.queryByTestId('venue-detail-booking-reject-button-12')).not.toBeInTheDocument()
  })
})

// Feedback at the point of action (ui-guidelines.md §13): every inline form is
// brought into view with its first field focused, and a failed required-field
// check focuses the field it names.
describe('VenueDetailPage feedback at the point of action', () => {
  const lastScrolled = () => Element.prototype.scrollIntoView.mock.contexts.at(-1)
  // The form that was brought into view holds the focused field.
  const expectRevealed = (fieldTestId) => {
    const field = screen.getByTestId(fieldTestId)
    expect(field).toHaveFocus()
    expect(lastScrolled().tagName).toBe('FORM')
    expect(lastScrolled()).toContainElement(field)
  }

  beforeEach(() => {
    api.getVenue.mockResolvedValue(HALL_A)
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens Select layouts with its first checkbox focused', async () => {
    renderPage()
    await userEvent.click(await screen.findByTestId('venue-detail-layouts-button'))

    expect(lastScrolled().tagName).toBe('FORM')
    expect(document.activeElement).toHaveAttribute('type', 'checkbox')
    expect(lastScrolled()).toContainElement(document.activeElement)
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens Edit times with the setup time focused', async () => {
    renderPage()
    await openTimesForm()

    expectRevealed('venue-detail-times-setup-time-input')
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens Update venue with the name focused, and focuses the first field a refused save names', async () => {
    renderPage()
    await userEvent.click(await screen.findByTestId('venue-detail-update-button'))
    expectRevealed('venue-detail-update-name-input')

    await userEvent.clear(screen.getByTestId('venue-detail-update-location-input'))
    await userEvent.click(screen.getByTestId('venue-detail-update-save-button'))

    expect(screen.getByTestId('venue-detail-update-location-input')).toHaveFocus()
    expect(lastScrolled()).toContainElement(screen.getByTestId('venue-detail-update-location-error'))
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens Block venue with the start date focused, and focuses it again when the empty form is refused', async () => {
    renderPage()
    await openBlockForm()
    expectRevealed('venue-detail-block-start-date-input')

    await userEvent.click(screen.getByTestId('venue-detail-block-confirm-button'))

    expect(screen.getByTestId('venue-detail-block-start-date-input')).toHaveFocus()
    expect(lastScrolled()).toContainElement(screen.getByTestId('venue-detail-block-start-date-error'))
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens the End early row with the new end date focused', async () => {
    api.listVenueBlocks.mockResolvedValue([ENDED_BLOCK, IN_PROGRESS_BLOCK, UPCOMING_BLOCK])
    renderPage()
    await openEndForm()

    expectRevealed('venue-detail-end-block-end-date-input')
  })

  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('opens the decide row with its reason focused, and reveals it again when switching Approve to Reject', async () => {
    signInWith(['venues.view', 'bookings.decide'])
    api.listVenueBookings.mockResolvedValue([REQUESTED_BOOKING])
    api.listVenues.mockResolvedValue([])
    renderPage()

    await userEvent.click(await screen.findByTestId('venue-detail-booking-approve-button-12'))
    expectRevealed('venue-detail-decide-reason-input')
    const opened = Element.prototype.scrollIntoView.mock.calls.length

    await userEvent.click(screen.getByTestId('venue-detail-booking-reject-button-12'))
    await screen.findByTestId('venue-detail-decide-suggested-venue-input')
    expect(Element.prototype.scrollIntoView.mock.calls.length).toBeGreaterThan(opened)
    expectRevealed('venue-detail-decide-reason-input')
  })
})
