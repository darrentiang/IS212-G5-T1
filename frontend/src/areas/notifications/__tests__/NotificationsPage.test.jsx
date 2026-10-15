import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import NotificationsPage from '../NotificationsPage'

vi.mock('../api')
vi.mock('../../../app/auth')

const UNREAD = {
  id: 1,
  event_request_id: 5,
  event_request_name: 'Annual Dinner',
  message: 'Your request was submitted.',
  created_at: '2026-10-11T09:15:00+00:00',
  read: false,
}

const READ = {
  id: 2,
  event_request_id: 6,
  event_request_name: 'Open House',
  message: 'Your request was approved.',
  created_at: '2026-10-10T08:00:00+00:00',
  read: true,
}

const HIDDEN_EVENT = {
  id: 3,
  event_request_id: null,
  event_request_name: null,
  message: 'A note was recorded.',
  created_at: '2026-10-09T08:00:00+00:00',
  read: false,
}

function signInWith(refreshUnreadCount = vi.fn()) {
  vi.mocked(auth.useAuth).mockReturnValue({ refreshUnreadCount })
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/requests/:id" element={<p data-testid="request-detail-stub">request page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NotificationsPage', () => {
  // @story: SCRUM-58
  // @ac: 2
  it('lists notifications newest first, each with its created time, message and read state', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([UNREAD, READ])

    renderPage()

    const rows = await screen.findAllByRole('row')
    // Header row first, then UNREAD (newer) above READ.
    expect(rows[1]).toHaveTextContent('Your request was submitted.')
    expect(rows[2]).toHaveTextContent('Your request was approved.')
    expect(screen.getByTestId('notifications-status-1')).toHaveTextContent('Unread')
    expect(screen.getByTestId('notifications-status-2')).toHaveTextContent('Read')
    expect(screen.getByTestId('notifications-created-at-1')).toHaveTextContent('11 Oct 2026, 09:15')
  })

  // @story: SCRUM-58
  // @ac: 7
  it('shows a message instead of a list when there are no notifications', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([])

    renderPage()

    expect(await screen.findByTestId('notifications-empty')).toHaveTextContent('No notifications yet.')
    expect(screen.queryByTestId('notifications-mark-all-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-58
  // @ac: 6
  it("links a notification's event when the account may view it", async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([UNREAD])

    renderPage()

    const link = await screen.findByTestId('notifications-event-1')
    expect(link).toHaveTextContent('Annual Dinner')
    expect(link).toHaveAttribute('href', '/requests/5')
  })

  // @story: SCRUM-58
  // @ac: 6
  it('shows an Open button with no event name when the account may not view the event', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([HIDDEN_EVENT])

    renderPage()

    expect(await screen.findByTestId('notifications-open-button-3')).toHaveTextContent('Open')
    expect(screen.queryByTestId('notifications-event-3')).not.toBeInTheDocument()
    expect(screen.queryByText('Annual Dinner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-58
  // @ac: 4
  it('marks an unread notification read, then navigates, when its event link is opened', async () => {
    const refreshUnreadCount = vi.fn()
    signInWith(refreshUnreadCount)
    api.listNotifications.mockResolvedValue([UNREAD])
    api.markNotificationRead.mockResolvedValue({ ...UNREAD, read: true })

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-event-1'))

    await waitFor(() => {
      expect(api.markNotificationRead).toHaveBeenCalledWith(1)
    })
    expect(refreshUnreadCount).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('request-detail-stub')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-58
  // @ac: 4
  it('marks read when the Open button is clicked, with no event to navigate to', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([HIDDEN_EVENT])
    api.markNotificationRead.mockResolvedValue({ ...HIDDEN_EVENT, read: true })

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-open-button-3'))

    await waitFor(() => {
      expect(screen.getByTestId('notifications-status-3')).toHaveTextContent('Read')
    })
  })

  // @story: SCRUM-58
  // @ac: 4
  it('marking one notification read leaves the others in the list unchanged', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([HIDDEN_EVENT, READ])
    api.markNotificationRead.mockResolvedValue({ ...HIDDEN_EVENT, read: true })

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-open-button-3'))

    await waitFor(() => {
      expect(screen.getByTestId('notifications-status-3')).toHaveTextContent('Read')
    })
    expect(screen.getByTestId('notifications-status-2')).toHaveTextContent('Read')
    expect(screen.getByTestId('notifications-message-2')).toHaveTextContent('Your request was approved.')
  })

  // @story: SCRUM-58
  // @ac: 4
  it('opening an already-read notification still navigates, but calls the API nothing', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([READ])

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-event-2'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-stub')).toBeInTheDocument()
    })
    expect(api.markNotificationRead).not.toHaveBeenCalled()
  })

  // @story: SCRUM-58
  // @ac: 4
  it('opening an already-read notification with no event does nothing at all', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([{ ...HIDDEN_EVENT, read: true }])

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-open-button-3'))

    expect(api.markNotificationRead).not.toHaveBeenCalled()
    expect(screen.getByTestId('notifications-status-3')).toHaveTextContent('Read')
  })

  // @story: SCRUM-58
  // @ac: 5
  it('marks every notification read with Mark all as read, and refreshes the nav count', async () => {
    const refreshUnreadCount = vi.fn()
    signInWith(refreshUnreadCount)
    api.listNotifications.mockResolvedValue([UNREAD, HIDDEN_EVENT])
    api.markAllNotificationsRead.mockResolvedValue({ unread_count: 0 })

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-mark-all-button'))

    await waitFor(() => {
      expect(screen.getByTestId('notifications-status-1')).toHaveTextContent('Read')
    })
    expect(screen.getByTestId('notifications-status-3')).toHaveTextContent('Read')
    expect(refreshUnreadCount).toHaveBeenCalled()
  })

  // @story: SCRUM-58
  it('shows the API refusal in the banner when the list fails to load', async () => {
    signInWith()
    api.listNotifications.mockRejectedValue(new Error('Not logged in'))

    renderPage()

    expect(await screen.findByTestId('notifications-banner')).toHaveTextContent('Not logged in')
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    signInWith()
    api.listNotifications.mockRejectedValue(new Error('Not logged in'))
    renderPage()
    await screen.findByTestId('notifications-banner')

    await userEvent.click(screen.getByTestId('notifications-banner-dismiss'))

    expect(screen.queryByTestId('notifications-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-58
  it('shows the API refusal in the banner when marking read fails', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([UNREAD])
    api.markNotificationRead.mockRejectedValue(new Error('Notification not found.'))

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-event-1'))

    expect(await screen.findByTestId('notifications-banner')).toHaveTextContent('Notification not found.')
  })

  // @story: SCRUM-58
  it('shows the API refusal in the banner when mark-all-read fails', async () => {
    signInWith()
    api.listNotifications.mockResolvedValue([UNREAD])
    api.markAllNotificationsRead.mockRejectedValue(new Error('refused'))

    renderPage()
    await userEvent.click(await screen.findByTestId('notifications-mark-all-button'))

    expect(await screen.findByTestId('notifications-banner')).toHaveTextContent('refused')
  })
})
