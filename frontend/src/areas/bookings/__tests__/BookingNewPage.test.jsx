import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import BookingNewPage from '../BookingNewPage'

vi.mock('../api')

const navigate = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const VENUES = [
  { id: 1, name: 'Seminar Room 1', is_active: true },
  { id: 2, name: 'Auditorium', is_active: true },
  { id: 3, name: 'Old Hall', is_active: false },
]

// SCRUM-42: choosing a venue checks it; by default it fits.
beforeEach(() => {
  api.checkVenue.mockResolvedValue([])
})

afterEach(() => {
  navigate.mockReset()
  vi.restoreAllMocks()
})

async function renderPage(venues = VENUES) {
  api.listVenues.mockResolvedValue(venues)
  render(
    <MemoryRouter initialEntries={['/requests/5/bookings/new']}>
      <Routes>
        <Route path="/requests/:requestId/bookings/new" element={<BookingNewPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByTestId('booking-new-venue-input')).toBeInTheDocument()
  })
}

describe('BookingNewPage', () => {
  // @story: SCRUM-36
  // @ac: 1
  it('ignores the venue list after unmount', async () => {
    let resolveVenues
    api.listVenues.mockReturnValue(
      new Promise((resolve) => {
        resolveVenues = resolve
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/5/bookings/new']}>
        <Routes>
          <Route path="/requests/:requestId/bookings/new" element={<BookingNewPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    resolveVenues(VENUES)
  })


  // @story: SCRUM-36
  // @ac: 1
  it('shows the API refusal when the venue list fails to load', async () => {
    api.listVenues.mockRejectedValue(Object.assign(new Error('Something went wrong'), { status: 500 }))
    render(
      <MemoryRouter initialEntries={['/requests/5/bookings/new']}>
        <Routes>
          <Route path="/requests/:requestId/bookings/new" element={<BookingNewPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('booking-new-banner')).toHaveTextContent('Something went wrong')
    })
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.listVenues.mockRejectedValue(Object.assign(new Error('Something went wrong'), { status: 500 }))
    render(
      <MemoryRouter initialEntries={['/requests/5/bookings/new']}>
        <Routes>
          <Route path="/requests/:requestId/bookings/new" element={<BookingNewPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('booking-new-banner')

    await userEvent.click(screen.getByTestId('booking-new-banner-dismiss'))

    expect(screen.queryByTestId('booking-new-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-36
  // @ac: 1
  it('offers one option per active venue, excluding a retired one', async () => {
    await renderPage()

    const select = screen.getByTestId('booking-new-venue-input')
    const optionNames = Array.from(select.options).map((option) => option.textContent)
    expect(optionNames).toContain('Seminar Room 1')
    expect(optionNames).toContain('Auditorium')
    expect(optionNames).not.toContain('Old Hall')
  })

  // @story: SCRUM-36
  // @ac: 1
  it('refuses to raise without choosing a venue, sending nothing', async () => {
    await renderPage()

    await userEvent.click(screen.getByTestId('booking-new-raise-button'))

    expect(await screen.findByTestId('booking-new-venue-error')).toBeInTheDocument()
    expect(api.raiseBooking).not.toHaveBeenCalled()
  })

  // @story: SCRUM-36
  // @ac: 1, 4, 5
  it('raises a booking request and lands on the venue page with a success banner', async () => {
    api.raiseBooking.mockResolvedValue({ id: 9, status: 'Requested' })
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')
    await userEvent.click(screen.getByTestId('booking-new-raise-button'))

    await waitFor(() => {
      expect(api.raiseBooking).toHaveBeenCalledWith('5', '1')
    })
    expect(navigate).toHaveBeenCalledWith('/venues/1', {
      state: { banner: 'Venue booking requested' },
    })
  })

  // @story: SCRUM-36
  // @ac: 2
  it('shows the API refusal in the banner and stays on the form', async () => {
    api.raiseBooking.mockRejectedValue(
      Object.assign(new Error('A venue booking can be requested only for an Approved or Planning event.'), {
        status: 400,
      }),
    )
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')
    await userEvent.click(screen.getByTestId('booking-new-raise-button'))

    await waitFor(() => {
      expect(screen.getByTestId('booking-new-banner')).toHaveTextContent(
        'A venue booking can be requested only for an Approved or Planning event.',
      )
    })
    expect(navigate).not.toHaveBeenCalled()
  })

  // @story: SCRUM-36
  // @ac: 10
  it('shows the API refusal when the venue turns out to be retired', async () => {
    api.raiseBooking.mockRejectedValue(
      Object.assign(new Error('This venue has been retired and cannot be booked.'), { status: 400 }),
    )
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')
    await userEvent.click(screen.getByTestId('booking-new-raise-button'))

    await waitFor(() => {
      expect(screen.getByTestId('booking-new-banner')).toHaveTextContent('retired')
    })
  })

  // --- SCRUM-42: warnings when the chosen venue appears unsuitable ---

  // @story: SCRUM-42
  // @ac: 2, 3
  it('checks the chosen venue against the event and shows each mismatch', async () => {
    api.checkVenue.mockResolvedValue(ALL_WARNINGS)
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')

    expect(api.checkVenue).toHaveBeenCalledWith('5', '1')
    expect(await screen.findByTestId('booking-new-warnings')).toHaveTextContent(
      'This venue may not suit the event',
    )
    expect(screen.getByTestId('booking-new-warning-capacity')).toHaveTextContent(
      "Expected attendance 100 is above the venue's maximum capacity of 60.",
    )
    expect(screen.getByTestId('booking-new-warning-start-time')).toHaveTextContent(
      "Start time 07:59 is outside the venue's operating hours, 08:00 to 20:00.",
    )
    expect(screen.getByTestId('booking-new-warning-end-time')).toHaveTextContent(
      "End time 20:01 is outside the venue's operating hours, 08:00 to 20:00.",
    )
    expect(screen.getByTestId('booking-new-warning-layout-theatre')).toHaveTextContent(
      'The venue does not record the Theatre layout.',
    )
    expect(screen.getByTestId('booking-new-warning-facility-sound-system')).toHaveTextContent(
      'The venue does not record the facility Sound system.',
    )
    expect(screen.getByTestId('booking-new-warning-accessibility-feature-hearing-loop')).toHaveTextContent(
      'The venue does not record the accessibility feature Hearing loop.',
    )
  })

  // @story: SCRUM-42
  // @ac: 4
  it('shows no warning for a venue that fits, and clears earlier warnings', async () => {
    api.checkVenue.mockResolvedValueOnce([CAPACITY]).mockResolvedValueOnce([])
    await renderPage()
    const select = screen.getByTestId('booking-new-venue-input')

    await userEvent.selectOptions(select, '1')
    expect(await screen.findByTestId('booking-new-warning-capacity')).toBeInTheDocument()
    await userEvent.selectOptions(select, '2')

    await waitFor(() => expect(api.checkVenue).toHaveBeenLastCalledWith('5', '2'))
    expect(screen.queryByTestId('booking-new-warnings')).not.toBeInTheDocument()
  })

  // @story: SCRUM-42
  // @ac: 4
  it('clears the warnings without a check when no venue is chosen', async () => {
    api.checkVenue.mockResolvedValue([CAPACITY])
    await renderPage()
    const select = screen.getByTestId('booking-new-venue-input')
    await userEvent.selectOptions(select, '1')
    await screen.findByTestId('booking-new-warnings')

    await userEvent.selectOptions(select, '')

    expect(screen.queryByTestId('booking-new-warnings')).not.toBeInTheDocument()
    expect(api.checkVenue).toHaveBeenCalledTimes(1)
  })

  // @story: SCRUM-42
  // @ac: 2
  it('shows the API refusal when the check fails', async () => {
    api.checkVenue.mockRejectedValue(Object.assign(new Error('Venue not found.'), { status: 404 }))
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')

    expect(await screen.findByTestId('booking-new-banner')).toHaveTextContent('Venue not found.')
  })

  // @story: SCRUM-42
  // @ac: 4
  it('keeps the warnings of the venue chosen last when the earlier reply arrives last', async () => {
    let resolveFirst
    api.checkVenue
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce([])
    await renderPage()
    const select = screen.getByTestId('booking-new-venue-input')

    await userEvent.selectOptions(select, '1')
    await userEvent.selectOptions(select, '2')
    await waitFor(() => expect(api.checkVenue).toHaveBeenCalledTimes(2))
    resolveFirst([CAPACITY])
    await settle()

    expect(screen.queryByTestId('booking-new-warnings')).not.toBeInTheDocument()
  })

  // @story: SCRUM-42
  // @ac: 2
  it('ignores a check failure for a venue the user has moved away from', async () => {
    let rejectFirst
    api.checkVenue
      .mockReturnValueOnce(
        new Promise((_, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce([])
    await renderPage()
    const select = screen.getByTestId('booking-new-venue-input')

    await userEvent.selectOptions(select, '1')
    await userEvent.selectOptions(select, '2')
    await waitFor(() => expect(api.checkVenue).toHaveBeenCalledTimes(2))
    rejectFirst(Object.assign(new Error('Venue not found.'), { status: 404 }))
    await settle()

    expect(screen.queryByTestId('booking-new-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-42
  // @ac: 5
  it('raises despite the warnings', async () => {
    api.checkVenue.mockResolvedValue([CAPACITY])
    api.raiseBooking.mockResolvedValue({ id: 9 })
    await renderPage()
    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')
    await screen.findByTestId('booking-new-warnings')

    await userEvent.click(screen.getByTestId('booking-new-raise-button'))

    expect(api.raiseBooking).toHaveBeenCalledWith('5', '1')
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/venues/1', { state: { banner: 'Venue booking requested' } }),
    )
  })

  // --- SCRUM-38: warnings when the chosen venue is already held ---

  // @story: SCRUM-38
  // @ac: 7
  it('names each approved booking and block holding the venue, after the mismatches', async () => {
    api.checkVenue.mockResolvedValue([CAPACITY, HELD_BY_BOOKING, HELD_BY_BLOCK])
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')

    expect(await screen.findByTestId('booking-new-warning-approved-booking-31')).toHaveTextContent(
      'The venue already holds an approved booking for TC38 Holder, 10 Dec 2026, 14:00–17:00.',
    )
    expect(screen.getByTestId('booking-new-warning-block-7')).toHaveTextContent(
      'The venue is blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement).',
    )
    const lines = screen.getAllByRole('listitem').map((item) => item.dataset.testid)
    expect(lines).toEqual([
      'booking-new-warning-capacity',
      'booking-new-warning-approved-booking-31',
      'booking-new-warning-block-7',
    ])
  })

  // @story: SCRUM-38
  // @ac: 7
  it('raises despite a venue being held', async () => {
    api.checkVenue.mockResolvedValue([HELD_BY_BOOKING])
    api.raiseBooking.mockResolvedValue({ id: 9 })
    await renderPage()
    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')
    await screen.findByTestId('booking-new-warning-approved-booking-31')

    await userEvent.click(screen.getByTestId('booking-new-raise-button'))

    expect(api.raiseBooking).toHaveBeenCalledWith('5', '1')
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/venues/1', { state: { banner: 'Venue booking requested' } }),
    )
  })

  // --- SCRUM-84: another event's Held hold ---

  // @story: SCRUM-84
  // @ac: 4
  it('names another event\'s Held hold after the approved bookings and before the blocks', async () => {
    api.checkVenue.mockResolvedValue([HELD_BY_BOOKING, HELD_BY_HOLD, HELD_BY_BLOCK])
    await renderPage()

    await userEvent.selectOptions(screen.getByTestId('booking-new-venue-input'), '1')

    expect(await screen.findByTestId('booking-new-warning-hold-12')).toHaveTextContent(
      'The venue is held for Hold Seminar, 05 Dec 2026, 10:00–12:00.',
    )
    const lines = screen.getAllByRole('listitem').map((item) => item.dataset.testid)
    expect(lines).toEqual([
      'booking-new-warning-approved-booking-31',
      'booking-new-warning-hold-12',
      'booking-new-warning-block-7',
    ])
  })
})

const HELD_BY_HOLD = {
  type: 'hold',
  id: 12,
  event_request_name: 'Hold Seminar',
  date: '2026-12-05',
  start_time: '10:00',
  end_time: '12:00',
}

const HELD_BY_BOOKING = {
  type: 'approved_booking',
  id: 31,
  event_request_name: 'TC38 Holder',
  date: '2026-12-10',
  start_time: '14:00',
  end_time: '17:00',
}

const HELD_BY_BLOCK = {
  type: 'block',
  id: 7,
  start: '2026-12-10T13:00',
  end: '2026-12-10T15:00',
  reason: 'Projector replacement',
}

const CAPACITY = { type: 'capacity', attendance: 100, max_capacity: 60 }

const ALL_WARNINGS = [
  CAPACITY,
  { type: 'start_time', start_time: '07:59', opening_time: '08:00', closing_time: '20:00' },
  { type: 'end_time', end_time: '20:01', opening_time: '08:00', closing_time: '20:00' },
  { type: 'layout', name: 'Theatre' },
  { type: 'facility', name: 'Sound system' },
  { type: 'accessibility_feature', name: 'Hearing loop' },
]

// Lets the late reply's callbacks run before the assertion that they changed nothing.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
