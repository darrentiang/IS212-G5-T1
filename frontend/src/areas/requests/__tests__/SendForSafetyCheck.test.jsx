import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

afterEach(() => {
  vi.restoreAllMocks()
})

// SCRUM-53: the assigned Event Coordinator sends a Planning event for safety check.
const PLANNING = {
  id: 7,
  name: 'Send Gala',
  purpose: 'Client gala',
  description: 'Gala dinner',
  date: '2027-10-12',
  start_time: '10:00',
  end_time: '14:00',
  attendance: 80,
  equipment_requirements: 'None',
  registration_needs: 'None',
  status: STATUS.REQUEST.PLANNING,
  created_by: 'org1',
  layout: null,
  facilities: [],
  accessibility_features: [],
  registration_enabled: false,
  submitted_at: '2026-09-20T09:00:00',
  decision: null,
  decision_reason: null,
  decided_at: null,
  decided_by: null,
  assigned_coordinator: 'coord1',
  assigned_at: '2026-09-21T09:00:00',
  safety_check_at: null,
  safety_decisions: [],
  requested_changes: null,
}

const FEATURES = ['requests.view', 'requests.decide', 'safety.send', 'notifications.view']

function signInWith(features, username = 'coord1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/7']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// @story: SCRUM-53
// @ac: 1, 4
describe('sending an event for safety check', () => {
  it('shows the assigned coordinator the button, sends, and shows the new status and sent time', async () => {
    signInWith(FEATURES)
    api.getRequest.mockResolvedValue(PLANNING)
    api.sendForSafetyCheck.mockResolvedValue({
      ...PLANNING,
      status: STATUS.REQUEST.SAFETY_CHECK,
      safety_check_at: '2026-10-14T09:30:00',
    })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-send-safety-button'))

    expect(api.sendForSafetyCheck).toHaveBeenCalledWith('7')
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Sent for safety check')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Safety Check')
    expect(screen.getByTestId('request-detail-safety-check-at')).toHaveTextContent('14 Oct 2026, 09:30')
    expect(screen.queryByTestId('request-detail-send-safety-button')).not.toBeInTheDocument()
  })

  it('shows the sent time on a Confirmed event too', async () => {
    signInWith(FEATURES)
    api.getRequest.mockResolvedValue({
      ...PLANNING,
      status: STATUS.REQUEST.CONFIRMED,
      safety_check_at: '2026-10-14T09:30:00',
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-check-at')).toHaveTextContent('14 Oct 2026, 09:30')
  })

  it('shows no sent time before the event has been sent', async () => {
    signInWith(FEATURES)
    api.getRequest.mockResolvedValue(PLANNING)
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-safety-check-at')).not.toBeInTheDocument()
  })
})

// @story: SCRUM-53
// @ac: 2, 3
describe('a refused send', () => {
  it('shows what is outstanding and keeps the event in Planning', async () => {
    signInWith(FEATURES)
    api.getRequest.mockResolvedValue(PLANNING)
    api.sendForSafetyCheck.mockRejectedValue(
      new Error(
        'This event cannot be sent for safety check yet. Outstanding: No Approved venue booking; ' +
          'The venue booking request for Seminar Room 1 is awaiting a decision.',
      ),
    )
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-send-safety-button'))

    const banner = await screen.findByTestId('request-detail-banner')
    expect(banner).toHaveTextContent('No Approved venue booking')
    expect(banner).toHaveTextContent('Seminar Room 1 is awaiting a decision')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Planning')
  })

  it('shows the event as it now stands when it was already sent from another tab', async () => {
    signInWith(FEATURES)
    api.getRequest
      .mockResolvedValueOnce(PLANNING)
      .mockResolvedValueOnce({ ...PLANNING, status: STATUS.REQUEST.SAFETY_CHECK, safety_check_at: '2026-10-14T09:30:00' })
    api.sendForSafetyCheck.mockRejectedValue(
      new Error('Only an event in Planning can be sent for safety check; this event is Safety Check.'),
    )
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-send-safety-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('this event is Safety Check')
    expect(await screen.findByTestId('request-detail-status')).toHaveTextContent('Safety Check')
  })

  it('shows the reload failure instead when the event cannot be read again', async () => {
    signInWith(FEATURES)
    api.getRequest.mockResolvedValueOnce(PLANNING).mockRejectedValueOnce(new Error('Event request not found.'))
    api.sendForSafetyCheck.mockRejectedValue(new Error('Event request not found.'))
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-send-safety-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Event request not found.')
  })
})

// @story: SCRUM-53
// @ac: 7
describe('who is offered the button', () => {
  it('does not offer it to an Event Coordinator the event is not assigned to', async () => {
    signInWith(FEATURES, 'coord2')
    api.getRequest.mockResolvedValue(PLANNING)
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-send-safety-button')).not.toBeInTheDocument()
  })

  it('does not offer it to an account without safety.send', async () => {
    signInWith(['requests.view', 'notifications.view'], 'org1')
    api.getRequest.mockResolvedValue({ ...PLANNING, assigned_coordinator: 'org1' })
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-send-safety-button')).not.toBeInTheDocument()
  })

  it('does not offer it once the event is out of Planning', async () => {
    signInWith(FEATURES)
    api.getRequest.mockResolvedValue({ ...PLANNING, status: STATUS.REQUEST.APPROVED })
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-send-safety-button')).not.toBeInTheDocument()
  })
})
