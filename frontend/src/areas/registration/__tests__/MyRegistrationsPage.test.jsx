import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import MyRegistrationsPage from '../MyRegistrationsPage'

vi.mock('../api')

afterEach(() => {
  vi.restoreAllMocks()
})

// SCRUM-55: an Attendee lists their own registrations and withdraws one.
const REGISTERED = {
  id: 7,
  event_request_id: 3,
  event_name: 'Withdraw Gala',
  event_status: 'Confirmed',
  date: '2027-12-20',
  start_time: '10:00',
  end_time: '12:00',
  venues: 'Auditorium',
  venue_state: 'confirmed',
  status: 'Registered',
  can_withdraw: true,
}
const WITHDRAWN = { ...REGISTERED, status: 'Withdrawn', can_withdraw: false }

function renderPage() {
  render(
    <MemoryRouter>
      <MyRegistrationsPage />
    </MemoryRouter>,
  )
}

describe('MyRegistrationsPage', () => {
  // @story: SCRUM-55
  // @ac: 1, 4
  it('lists each registration with its event, period and statuses', async () => {
    api.listMyRegistrations.mockResolvedValue([REGISTERED, { ...WITHDRAWN, id: 8, event_name: 'Again Gala' }])
    renderPage()

    expect(await screen.findByTestId('registrations-event-7')).toHaveTextContent('Withdraw Gala')
    expect(screen.getByTestId('registrations-period-7')).toHaveTextContent('20 Dec 2027, 10:00–12:00')
    expect(screen.getByTestId('registrations-event-status-7')).toHaveTextContent('Confirmed')
    expect(screen.getByTestId('registrations-status-7')).toHaveTextContent('Registered')
    expect(screen.getByTestId('registrations-status-8')).toHaveTextContent('Withdrawn')
  })

  // @story: SCRUM-56
  // @ac: 2, 3
  it('shows the venue names, that the venue is not yet confirmed, or a dash for a Cancelled event', async () => {
    api.listMyRegistrations.mockResolvedValue([
      { ...REGISTERED, venues: 'Auditorium, Seminar Room 1' },
      { ...REGISTERED, id: 8, event_status: 'Planning', venues: null, venue_state: 'not_confirmed' },
      { ...REGISTERED, id: 9, event_status: 'Cancelled', venues: null, venue_state: 'none' },
    ])
    renderPage()

    expect(await screen.findByTestId('registrations-venue-7')).toHaveTextContent('Auditorium, Seminar Room 1')
    expect(screen.getByTestId('registrations-venue-8')).toHaveTextContent('Venue not yet confirmed')
    expect(screen.getByTestId('registrations-venue-9')).toHaveTextContent('—')
    expect(screen.getByTestId('registrations-venue-9')).not.toHaveTextContent('Venue not yet confirmed')
  })

  // @story: SCRUM-56
  // @ac: 2
  it('shows a dash for a Confirmed or Completed event with no Approved venue', async () => {
    api.listMyRegistrations.mockResolvedValue([
      { ...REGISTERED, venues: '' },
      { ...REGISTERED, id: 8, event_status: 'Completed', venues: '' },
    ])
    renderPage()

    expect(await screen.findByTestId('registrations-venue-7')).toHaveTextContent(/^—$/)
    expect(screen.getByTestId('registrations-venue-8')).toHaveTextContent(/^—$/)
  })

  // @story: SCRUM-55
  // @ac: 1
  it('offers Withdraw only where the server says it can be withdrawn', async () => {
    api.listMyRegistrations.mockResolvedValue([REGISTERED, { ...REGISTERED, id: 8, can_withdraw: false }])
    renderPage()

    expect(await screen.findByTestId('registrations-withdraw-button-7')).toBeInTheDocument()
    expect(screen.queryByTestId('registrations-withdraw-button-8')).not.toBeInTheDocument()
  })

  // @story: SCRUM-55
  // @ac: 1
  it('withdraws, says so, and shows the registration as Withdrawn', async () => {
    api.listMyRegistrations.mockResolvedValueOnce([REGISTERED]).mockResolvedValueOnce([WITHDRAWN])
    api.withdrawRegistration.mockResolvedValue(WITHDRAWN)
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('registrations-withdraw-button-7'))

    expect(api.withdrawRegistration).toHaveBeenCalledWith(7)
    expect(await screen.findByTestId('registrations-banner')).toHaveTextContent('Withdrawn from Withdraw Gala.')
    await waitFor(() => expect(screen.getByTestId('registrations-status-7')).toHaveTextContent('Withdrawn'))
    expect(screen.queryByTestId('registrations-withdraw-button-7')).not.toBeInTheDocument()
  })

  // @story: SCRUM-55
  // @ac: 3
  it('shows a refusal in the banner and reads the list again', async () => {
    api.listMyRegistrations.mockResolvedValueOnce([REGISTERED]).mockResolvedValueOnce([WITHDRAWN])
    api.withdrawRegistration.mockRejectedValue(new Error('This registration is already withdrawn.'))
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('registrations-withdraw-button-7'))

    expect(await screen.findByTestId('registrations-banner')).toHaveTextContent(
      'This registration is already withdrawn.',
    )
    await waitFor(() => expect(screen.getByTestId('registrations-status-7')).toHaveTextContent('Withdrawn'))
  })

  // @story: SCRUM-55
  // @ac: 1
  it('shows the failure when the list cannot be read again after a withdrawal', async () => {
    api.listMyRegistrations.mockResolvedValueOnce([REGISTERED]).mockRejectedValueOnce(new Error('Could not load.'))
    api.withdrawRegistration.mockResolvedValue(WITHDRAWN)
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('registrations-withdraw-button-7'))

    expect(await screen.findByTestId('registrations-banner')).toHaveTextContent('Could not load.')
  })

  // @story: SCRUM-55
  // @ac: 1
  it('clears the banner from its dismiss control', async () => {
    api.listMyRegistrations.mockResolvedValueOnce([REGISTERED]).mockResolvedValueOnce([WITHDRAWN])
    api.withdrawRegistration.mockResolvedValue(WITHDRAWN)
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('registrations-withdraw-button-7'))

    await user.click(await screen.findByTestId('registrations-banner-dismiss'))

    expect(screen.queryByTestId('registrations-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-55
  // @ac: 5
  it('says there are no registrations when the Attendee has none', async () => {
    api.listMyRegistrations.mockResolvedValue([])
    renderPage()

    expect(await screen.findByTestId('registrations-empty')).toHaveTextContent('You have no registrations.')
  })

  // @story: SCRUM-55
  // @ac: 5
  it('shows the refusal in the banner when the list is not allowed', async () => {
    api.listMyRegistrations.mockRejectedValue(new Error('You do not have permission to perform this action.'))
    renderPage()

    expect(await screen.findByTestId('registrations-banner')).toHaveTextContent('You do not have permission')
  })
})
