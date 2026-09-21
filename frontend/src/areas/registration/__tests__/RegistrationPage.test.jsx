import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import RegistrationPage from '../RegistrationPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RegistrationPage', () => {
  // @story: SCRUM-27
  // @ac: 6
  it('lists confirmed events without internal notes', async () => {
    api.listOpenEvents.mockResolvedValue([
      { id: 4, name: 'Open House', status: 'Confirmed', registration_enabled: true, purpose: 'Public open house' },
    ])

    render(
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText('Open House')).toBeInTheDocument()
    })
    expect(screen.queryByText(/coordinator notes/i)).not.toBeInTheDocument()
  })
})
