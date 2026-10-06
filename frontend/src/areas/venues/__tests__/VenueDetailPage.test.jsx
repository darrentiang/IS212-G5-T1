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

function signInWith(features) {
  vi.mocked(auth.useAuth).mockReturnValue({ can: (feature) => features.includes(feature) })
}

// SCRUM-40 made the page read the account and load the venue's blocks; the
// SCRUM-31 tests below see a Venue Staff account and a venue with no blocks.
beforeEach(() => {
  signInWith(['venues.view', 'venues.edit'])
  api.listVenueBlocks.mockResolvedValue([])
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
    // The form names the block being ended, its period per ui-guidelines.md §9.
    expect(screen.getByText('06 Oct 2026, 09:00 to 07 Oct 2026, 18:00: Lift repair')).toBeInTheDocument()
    expect(screen.getByTestId('venue-detail-end-block-confirm-button')).toHaveTextContent('End')
    expect(screen.getByTestId('venue-detail-end-block-cancel-button')).toHaveTextContent('Cancel')
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
  it('clears the banner when the End early form is opened', async () => {
    renderPage({ banner: 'Venue added' })
    expect(await screen.findByTestId('venue-detail-banner')).toHaveTextContent('Venue added')

    await openEndForm()

    expect(screen.queryByTestId('venue-detail-banner')).not.toBeInTheDocument()
  })
})
