// @tc: TC-INFRA-04
// @story: INFRA
// @ac: 1
// @type: Happy
// @scenario: Ping button calls API and displays result
// @preconditions: API mock returns {message: "pong"}
// @steps: 1. Render App 2. Click "Ping Backend" 3. Wait for result
// @test_data: mock response {message: "pong"}
// @expected: "Backend says: pong" is displayed
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Ping button', () => {
  it('calls API and displays pong result', async () => {
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'pong' }),
    })

    render(<App />)
    await userEvent.click(screen.getByText('Ping Backend'))

    await waitFor(() => {
      expect(screen.getByText(/Backend says: pong/)).toBeInTheDocument()
    })
    expect(mockFetch).toHaveBeenCalledWith('/api/ping')
  })
})
