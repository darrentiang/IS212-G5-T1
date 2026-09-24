import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router'
import * as api from '../api'
import VenueDetailPage from '../VenueDetailPage'

vi.mock('../api')

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
