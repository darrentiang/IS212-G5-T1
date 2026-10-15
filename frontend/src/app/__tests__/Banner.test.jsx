import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Banner from '../Banner'

// A page in miniature: an action sets the banner, the next action clears it,
// as every page does (ui-guidelines.md §4).
function Page() {
  const [banner, setBanner] = useState(null)
  const [success, setSuccess] = useState(null)
  return (
    <>
      <Banner
        page="demo"
        error={banner}
        success={success}
        onDismiss={() => {
          setBanner(null)
          setSuccess(null)
        }}
      />
      <button type="button" onClick={() => setSuccess('Saved')}>save</button>
      <button type="button" onClick={() => setBanner('Refused')}>refuse</button>
      <button
        type="button"
        onClick={() => {
          setBanner(null)
          setSuccess(null)
        }}
      >
        next
      </button>
    </>
  )
}

describe('Banner', () => {
  // @story: chore-ui-feedback
  // @ac: banner-visible
  it('renders nothing when there is no message', () => {
    const { container } = render(<Banner page="demo" error={null} success={null} onDismiss={() => {}} />)

    expect(container).toBeEmptyDOMElement()
  })

  // @story: chore-ui-feedback
  // @ac: banner-visible
  it('shows an error as an assertive alert under the page test id, its text word for word', () => {
    render(<Banner page="demo" error="Refused." success={null} onDismiss={() => {}} />)

    const banner = screen.getByTestId('demo-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveAttribute('aria-live', 'assertive')
    expect(banner).toHaveAttribute('aria-atomic', 'true')
    expect(banner).toHaveTextContent(/^Refused\.$/)
    expect(banner.parentElement).toHaveClass('banner', 'banner-error')
  })

  // @story: chore-ui-feedback
  // @ac: banner-visible
  it('shows a success as a polite status', () => {
    render(<Banner page="demo" error={null} success="Saved" onDismiss={() => {}} />)

    const banner = screen.getByTestId('demo-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(banner.parentElement).toHaveClass('banner', 'banner-success')
  })

  // @story: chore-ui-feedback
  // @ac: banner-visible
  it('shows the error, not the success, when the page holds both', () => {
    render(<Banner page="demo" error="Refused." success="Saved" onDismiss={() => {}} />)

    expect(screen.getAllByTestId('demo-banner')).toHaveLength(1)
    expect(screen.getByTestId('demo-banner')).toHaveTextContent('Refused.')
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('calls onDismiss from its labelled dismiss control', async () => {
    const onDismiss = vi.fn()
    render(<Banner page="demo" error="Refused." success={null} onDismiss={onDismiss} />)

    await userEvent.click(screen.getByTestId('demo-banner-dismiss'))

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Dismiss message' })).toBe(screen.getByTestId('demo-banner-dismiss'))
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('stays until dismissed or the next action, with no timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<Page />)
      await userEvent.click(screen.getByText('save'))
      vi.advanceTimersByTime(60_000)
      expect(screen.getByTestId('demo-banner')).toHaveTextContent('Saved')

      await userEvent.click(screen.getByTestId('demo-banner-dismiss'))
      expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()

      await userEvent.click(screen.getByText('refuse'))
      expect(screen.getByTestId('demo-banner')).toHaveTextContent('Refused')
      await userEvent.click(screen.getByText('next'))
      expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
