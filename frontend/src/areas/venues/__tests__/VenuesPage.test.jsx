import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import VenuesPage from '../VenuesPage'

vi.mock('../api')

// The page asks the shared account context whether this account may add a
// venue; the API is still the authority (ADR-002).
let features = ['venues.view', 'venues.edit']
vi.mock('../../../app/auth', () => ({
  useAuth: () => ({ can: (feature) => features.includes(feature) }),
}))

const SEMINAR_ROOM = {
  id: 1,
  name: 'Seminar Room 1',
  location: 'Block A Level 2',
  max_capacity: 60,
  opening_time: '08:00',
  closing_time: '20:00',
  facilities: ['Projector'],
  accessibility_features: ['Step-free access'],
}

afterEach(() => {
  features = ['venues.view', 'venues.edit']
  vi.restoreAllMocks()
})

function renderPage() {
  render(
    <MemoryRouter>
      <VenuesPage />
    </MemoryRouter>,
  )
}

describe('VenuesPage', () => {
  // @story: SCRUM-31
  // @ac: 4
  it('lists the venues the API returns', async () => {
    api.listVenues.mockResolvedValue([SEMINAR_ROOM])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Seminar Room 1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('venues-row-1')).toHaveTextContent('Block A Level 2')
    expect(screen.getByTestId('venues-row-1')).toHaveTextContent('60')
  })

  // @story: SCRUM-31
  // @ac: 1
  it('offers Add venue to an account with venues.edit', async () => {
    api.listVenues.mockResolvedValue([SEMINAR_ROOM])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venues-add-button')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-31
  // @ac: 5
  it('offers no Add venue to an account without venues.edit', async () => {
    features = ['venues.view']
    api.listVenues.mockResolvedValue([SEMINAR_ROOM])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Seminar Room 1')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('venues-add-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-31
  // @ac: 4
  it('says so when there is no venue to show', async () => {
    api.listVenues.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venues-empty')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-31
  // @ac: 5
  it('shows the API refusal in the banner', async () => {
    api.listVenues.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('venues-banner')).toHaveTextContent(/permission/i)
    })
    expect(screen.getByTestId('venues-banner')).toHaveAttribute('role', 'alert')
  })
})
