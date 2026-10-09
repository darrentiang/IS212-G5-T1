import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, RouterProvider, createMemoryRouter } from 'react-router'
import * as api from '../api'
import VenueAvailabilityPage from '../VenueAvailabilityPage'

vi.mock('../api')

const HALL_A = {
  id: 3,
  name: 'Hall A',
  setup_time: 30,
  turnaround_time: 15,
}

// Thursday, 08 Oct 2026, 10:00 local: the week is Mon 05 Oct to Sun 11 Oct.
const NOW = new Date('2026-10-08T10:00:00')

function renderPage(id = '3') {
  render(
    <MemoryRouter initialEntries={[`/venues/${id}/availability`]}>
      <Routes>
        <Route path="/venues/:id/availability" element={<VenueAvailabilityPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // Only Date is faked: waitFor/findBy* poll via setInterval, which must stay real.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  api.getVenue.mockResolvedValue(HALL_A)
  api.listVenueBookings.mockResolvedValue([])
  api.listVenueBlocks.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('VenueAvailabilityPage', () => {
  // @story: SCRUM-39
  // @ac: 1, 6
  it('shows the venue name and defaults to the current week', async () => {
    renderPage()

    expect(await screen.findByTestId('venue-availability-title')).toHaveTextContent('Hall A')
    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('05 Oct 2026 to 11 Oct 2026')
  })

  // @story: SCRUM-39
  // @ac: 1
  it('shows one day group per day of the week, each with its own heading', async () => {
    renderPage()

    await waitFor(() => screen.getByTestId('venue-availability-title'))
    ;['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'].forEach(
      (dateKey) => {
        expect(screen.getByTestId(`venue-availability-day-${dateKey}`)).toBeInTheDocument()
      },
    )
    expect(screen.getByTestId('venue-availability-day-heading-2026-10-08')).toHaveTextContent('08 Oct 2026')
  })

  // @story: SCRUM-39
  // @ac: 1, 5
  it('shows Free on a day with nothing booked or blocked', async () => {
    renderPage()

    expect(await screen.findByTestId('venue-availability-day-empty-2026-10-05')).toHaveTextContent('Free')
  })

  // @story: SCRUM-39
  // @ac: 2, 4
  it("shows an Approved booking under its day with its event name and setup/turnaround-widened period", async () => {
    api.listVenueBookings.mockResolvedValue([
      {
        id: 12,
        status: 'Approved',
        date: '2026-10-08',
        start_time: '10:00',
        end_time: '12:00',
        occupied_start: '2026-10-08T09:30',
        occupied_end: '2026-10-08T12:15',
        event_request_name: 'Tech Fair 2026',
      },
    ])

    renderPage()

    const row = await screen.findByTestId('venue-availability-entry-row-booking-12-2026-10-08')
    expect(row).toBeInTheDocument()
    expect(screen.getByTestId('venue-availability-entry-name-booking-12-2026-10-08')).toHaveTextContent(
      'Tech Fair 2026',
    )
    expect(screen.getByTestId('venue-availability-entry-period-booking-12-2026-10-08')).toHaveTextContent(
      '08 Oct 2026, 09:30 to 08 Oct 2026, 12:15',
    )
    expect(screen.getByTestId('venue-availability-entry-status-booking-12-2026-10-08')).toHaveTextContent('Approved')
    expect(screen.queryByTestId('venue-availability-day-empty-2026-10-08')).not.toBeInTheDocument()
  })

  // @story: SCRUM-39
  // @ac: 3
  it('shows a block under its day with its period and reason', async () => {
    api.listVenueBlocks.mockResolvedValue([
      { id: 7, start: '2026-10-10T13:00', end: '2026-10-10T15:00', reason: 'Maintenance' },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-availability-entry-name-block-7-2026-10-10')).toHaveTextContent(
      'Maintenance',
    )
    expect(screen.getByTestId('venue-availability-entry-status-block-7-2026-10-10')).toHaveTextContent('Block')
  })

  // @story: SCRUM-39
  // @ac: 5
  it('shows a Requested booking as Pending, its own published period unwidened, distinct from Approved', async () => {
    api.listVenueBookings.mockResolvedValue([
      {
        id: 13,
        status: 'Requested',
        date: '2026-10-09',
        start_time: '14:00',
        end_time: '15:00',
        occupied_start: '2026-10-09T13:30',
        occupied_end: '2026-10-09T15:15',
        event_request_name: 'Pending Event',
      },
    ])

    renderPage()

    expect(await screen.findByTestId('venue-availability-entry-status-booking-13-2026-10-09')).toHaveTextContent(
      'Pending',
    )
    // Unwidened: the booking's own 14:00-15:00, not the occupied 13:30-15:15.
    expect(screen.getByTestId('venue-availability-entry-period-booking-13-2026-10-09')).toHaveTextContent(
      '09 Oct 2026, 14:00 to 09 Oct 2026, 15:00',
    )
  })

  // @story: SCRUM-39
  // @ac: 5
  it('never shows a Rejected or a Withdrawn booking, leaving its day Free', async () => {
    api.listVenueBookings.mockResolvedValue([
      {
        id: 14,
        status: 'Rejected',
        date: '2026-10-08',
        start_time: '10:00',
        end_time: '11:00',
        occupied_start: '2026-10-08T10:00',
        occupied_end: '2026-10-08T11:00',
        event_request_name: 'Rejected Event',
      },
      {
        id: 15,
        status: 'Withdrawn',
        date: '2026-10-08',
        start_time: '10:00',
        end_time: '11:00',
        occupied_start: '2026-10-08T10:00',
        occupied_end: '2026-10-08T11:00',
        event_request_name: 'Withdrawn Event',
      },
    ])

    renderPage()

    await waitFor(() => screen.getByTestId('venue-availability-title'))
    expect(screen.queryByTestId('venue-availability-entry-row-booking-14-2026-10-08')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-availability-entry-row-booking-15-2026-10-08')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-availability-day-empty-2026-10-08')).toHaveTextContent('Free')
  })

  // @story: SCRUM-39
  // @ac: 1
  it("Next moves the range forward a week and shows that week's own booking only", async () => {
    api.listVenueBookings.mockResolvedValue([
      {
        id: 16,
        status: 'Approved',
        date: '2026-10-13',
        start_time: '10:00',
        end_time: '11:00',
        occupied_start: '2026-10-13T10:00',
        occupied_end: '2026-10-13T11:00',
        event_request_name: 'Next Week Event',
      },
    ])

    renderPage()
    await waitFor(() => screen.getByTestId('venue-availability-title'))
    expect(screen.queryByTestId('venue-availability-entry-row-booking-16-2026-10-13')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('venue-availability-next-button'))

    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('12 Oct 2026 to 18 Oct 2026')
    expect(screen.getByTestId('venue-availability-entry-row-booking-16-2026-10-13')).toBeInTheDocument()
  })

  // @story: SCRUM-39
  // @ac: 1
  it('Month shows a booking later in the month that the default week view excludes', async () => {
    api.listVenueBookings.mockResolvedValue([
      {
        id: 17,
        status: 'Approved',
        date: '2026-10-25',
        start_time: '10:00',
        end_time: '11:00',
        occupied_start: '2026-10-25T10:00',
        occupied_end: '2026-10-25T11:00',
        event_request_name: 'Late October Event',
      },
    ])

    renderPage()
    await waitFor(() => screen.getByTestId('venue-availability-title'))
    expect(screen.queryByTestId('venue-availability-entry-row-booking-17-2026-10-25')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('venue-availability-month-button'))

    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('01 Oct 2026 to 31 Oct 2026')
    expect(screen.getByTestId('venue-availability-entry-row-booking-17-2026-10-25')).toBeInTheDocument()
  })

  // @story: SCRUM-39
  // @ac: 1
  it('Previous moves the range back a week', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('venue-availability-title'))

    await userEvent.click(screen.getByTestId('venue-availability-prev-button'))

    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('28 Sep 2026 to 04 Oct 2026')
  })

  // @story: SCRUM-39
  // @ac: 1
  it('Week returns from Month to the current week', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('venue-availability-title'))
    await userEvent.click(screen.getByTestId('venue-availability-month-button'))
    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('01 Oct 2026 to 31 Oct 2026')

    await userEvent.click(screen.getByTestId('venue-availability-week-button'))

    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('05 Oct 2026 to 11 Oct 2026')
  })

  // @story: SCRUM-39
  it('breaks a tie between two entries starting at the same moment by id, within the same day', async () => {
    api.listVenueBookings.mockResolvedValue([
      {
        id: 21,
        status: 'Approved',
        date: '2026-10-08',
        start_time: '10:00',
        end_time: '11:00',
        occupied_start: '2026-10-08T10:00',
        occupied_end: '2026-10-08T11:00',
        event_request_name: 'Later Id',
      },
    ])
    api.listVenueBlocks.mockResolvedValue([
      { id: 20, start: '2026-10-08T10:00', end: '2026-10-08T11:00', reason: 'Earlier Id' },
    ])

    renderPage()

    const day = await screen.findByTestId('venue-availability-day-2026-10-08')
    const items = within(day).getAllByRole('listitem')
    // Lower id first when two entries start at the same moment.
    expect(items[0]).toHaveTextContent('Earlier Id')
    expect(items[1]).toHaveTextContent('Later Id')
  })

  // @story: SCRUM-39
  it('computes the current week correctly when today is itself a Sunday', async () => {
    vi.setSystemTime(new Date('2026-10-11T10:00:00'))

    renderPage()

    expect(await screen.findByTestId('venue-availability-range')).toHaveTextContent('05 Oct 2026 to 11 Oct 2026')
  })

  // @story: SCRUM-39
  // @ac: 1
  it('Next moves the range forward a month while in Month view', async () => {
    renderPage()
    await waitFor(() => screen.getByTestId('venue-availability-title'))
    await userEvent.click(screen.getByTestId('venue-availability-month-button'))

    await userEvent.click(screen.getByTestId('venue-availability-next-button'))

    expect(screen.getByTestId('venue-availability-range')).toHaveTextContent('01 Nov 2026 to 30 Nov 2026')
  })

  // @story: SCRUM-39
  it('ignores a rejection that arrives after the page has been left', async () => {
    let rejectFirst
    api.getVenue.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectFirst = reject
      }),
    )
    const router = createMemoryRouter(
      [
        { path: '/venues/:id/availability', element: <VenueAvailabilityPage /> },
        { path: '/venues', element: <p>Venues list</p> },
      ],
      { initialEntries: ['/venues/3/availability'] },
    )
    render(<RouterProvider router={router} />)

    await act(() => router.navigate('/venues'))
    await act(async () => rejectFirst(Object.assign(new Error('Venue not found.'), { status: 404 })))

    expect(screen.queryByTestId('venue-availability-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-39
  it('shows the API error in the banner when loading fails', async () => {
    api.getVenue.mockRejectedValue(Object.assign(new Error('Venue not found.'), { status: 404 }))

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venue-availability-banner')).toHaveTextContent('Venue not found.')
    })
  })

  // @story: SCRUM-39
  it('keeps the venue the user moved to when the earlier reply arrives last', async () => {
    let resolveFirst
    api.getVenue
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce({ ...HALL_A, id: 4, name: 'Hall B' })
    const router = createMemoryRouter([{ path: '/venues/:id/availability', element: <VenueAvailabilityPage /> }], {
      initialEntries: ['/venues/3/availability'],
    })
    render(<RouterProvider router={router} />)

    await act(() => router.navigate('/venues/4/availability'))
    await waitFor(() => {
      expect(screen.getByTestId('venue-availability-title')).toHaveTextContent('Hall B')
    })
    await act(async () => resolveFirst(HALL_A))

    expect(screen.getByTestId('venue-availability-title')).toHaveTextContent('Hall B')
  })
})
