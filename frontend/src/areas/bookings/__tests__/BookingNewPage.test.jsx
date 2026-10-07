import { describe, it, expect, vi, afterEach } from 'vitest'
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
})
