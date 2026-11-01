import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

// SCRUM-60: the assigned Event Coordinator accepts or declines an open change or withdrawal request.
const OPEN = {
  id: 4,
  kind: 'Change',
  description: 'Move the event a week later.',
  affects: ['attendance'],
  needs_review: { venue_bookings: true, equipment_reservations: false },
  status: 'Open',
  raised_by: 'org2',
  raised_at: '2026-10-14T09:30:00',
  closed_at: null,
  decided_by: null,
  decided_at: null,
  decision_reason: null,
}

const EVENT = {
  id: 7,
  name: 'Decide Gala',
  purpose: 'Client gala',
  description: 'Gala dinner',
  date: '2027-10-12',
  start_time: '10:00',
  end_time: '14:00',
  attendance: 80,
  equipment_requirements: 'None',
  registration_needs: 'None',
  status: STATUS.REQUEST.CONFIRMED,
  created_by: 'org2',
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
  clarification_requested: false,
  clarifications: [],
  change_requests: [OPEN],
}

const COORDINATOR = ['requests.view', 'requests.decide', 'changes.decide', 'notifications.view']
const BUTTONS = ['request-detail-change-accept-button', 'request-detail-change-decline-button']

function signInWith(features, username) {
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

const decided = (overrides) => ({
  ...EVENT,
  change_requests: [
    { ...OPEN, decided_by: 'coord1', decided_at: '2026-10-15T10:00:00', closed_at: null, ...overrides },
  ],
})

describe('who is offered Accept and Decline', () => {
  // @story: SCRUM-60
  // @ac: 1
  it.each([STATUS.REQUEST.SUBMITTED, STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING, STATUS.REQUEST.SAFETY_CHECK, STATUS.REQUEST.CONFIRMED])(
    'offers the assigned coordinator both on a %s event',
    async (status) => {
      signInWith(COORDINATOR, 'coord1')
      api.getRequest.mockResolvedValue({ ...EVENT, status })
      renderDetail()

      for (const id of BUTTONS) expect(await screen.findByTestId(id)).toBeInTheDocument()
    },
  )

  // @story: SCRUM-60
  // @ac: 7
  it('offers neither to a coordinator the event is not assigned to', async () => {
    signInWith(COORDINATOR, 'coord2')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    await screen.findByTestId('request-detail-change-row-4')

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-60
  // @ac: 7
  it('offers neither to an account without the feature', async () => {
    signInWith(['requests.view', 'changes.raise'], 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    await screen.findByTestId('request-detail-change-row-4')

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-60
  // @ac: 7
  it.each([['Accepted'], ['Declined'], ['Closed']])('offers neither once the request is %s', async (status) => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(decided({ status }))
    renderDetail()

    await screen.findByTestId('request-detail-change-row-4')

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-60
  // @ac: 7
  it('offers neither on an event that has ended', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.CANCELLED })
    renderDetail()

    await screen.findByTestId('request-detail-change-row-4')

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })
})

describe('accepting', () => {
  // @story: SCRUM-60
  // @ac: 2, 3
  it('sends the ticks as they stand, then shows the request Accepted with who and when', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    api.decideChangeRequest.mockResolvedValue({
      ...decided({ status: 'Accepted' }),
      status: STATUS.REQUEST.PLANNING,
    })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-accept-button'))
    expect(screen.getByTestId('request-detail-decide-review-venue-bookings-input')).toBeChecked()
    expect(screen.getByTestId('request-detail-decide-review-equipment-reservations-input')).not.toBeChecked()
    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(api.decideChangeRequest).toHaveBeenCalledWith('7', 4, {
      decision: 'Accept',
      needs_review: { venue_bookings: true, equipment_reservations: false },
    })
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Change request accepted')
    expect(screen.getByTestId('request-detail-change-status-4')).toHaveTextContent('Accepted')
    expect(screen.getByTestId('request-detail-change-decided-4')).toHaveTextContent('Accepted by coord1, 15 Oct 2026, 10:00')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Planning')
    expect(screen.queryByTestId('request-detail-decide-form')).not.toBeInTheDocument()
    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-60
  // @ac: 2
  it('sends the correction when the coordinator ticks and unticks', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    api.decideChangeRequest.mockResolvedValue(decided({ status: 'Accepted' }))
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-accept-button'))
    await user.click(screen.getByTestId('request-detail-decide-review-venue-bookings-input'))
    await user.click(screen.getByTestId('request-detail-decide-review-equipment-reservations-input'))
    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(api.decideChangeRequest).toHaveBeenCalledWith('7', 4, {
      decision: 'Accept',
      needs_review: { venue_bookings: false, equipment_reservations: true },
    })
  })

  // @story: SCRUM-60
  // @ac: 4
  it('says accepting a withdrawal cancels the event, shows no ticks, and sends no correction', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({
      ...EVENT,
      change_requests: [{ ...OPEN, kind: 'Withdrawal', affects: [], description: null }],
    })
    api.decideChangeRequest.mockResolvedValue({
      ...decided({ status: 'Accepted', kind: 'Withdrawal', affects: [], description: null }),
      status: STATUS.REQUEST.CANCELLED,
    })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-accept-button'))
    expect(screen.getByTestId('request-detail-decide-withdrawal-note')).toHaveTextContent('Accepting cancels the event.')
    expect(screen.queryByTestId('request-detail-decide-review-venue-bookings-input')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(api.decideChangeRequest).toHaveBeenCalledWith('7', 4, { decision: 'Accept' })
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Withdrawal request accepted')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Cancelled')
  })
})

describe('declining', () => {
  // @story: SCRUM-60
  // @ac: 1, 3
  it('sends the reason, then shows the request Declined with the reason', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    api.decideChangeRequest.mockResolvedValue(
      decided({ status: 'Declined', decision_reason: 'The kit is already booked.' }),
    )
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-decline-button'))
    expect(screen.queryByTestId('request-detail-decide-review-venue-bookings-input')).not.toBeInTheDocument()
    await user.type(screen.getByTestId('request-detail-decide-reason-input'), 'The kit is already booked.')
    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(api.decideChangeRequest).toHaveBeenCalledWith('7', 4, {
      decision: 'Decline',
      reason: 'The kit is already booked.',
    })
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Change request declined')
    expect(screen.getByTestId('request-detail-change-decided-4')).toHaveTextContent('Declined by coord1')
    expect(screen.getByTestId('request-detail-change-reason-4')).toHaveTextContent('The kit is already booked.')
  })

  // @story: SCRUM-60
  // @ac: 1
  it('shows a message under the field and sends nothing without a reason, and typing clears it', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-decline-button'))
    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))
    expect(screen.getByTestId('request-detail-decide-reason-error')).toHaveTextContent('Give a reason for declining.')
    await user.type(screen.getByTestId('request-detail-decide-reason-input'), '   ')
    expect(screen.queryByTestId('request-detail-decide-reason-error')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(screen.getByTestId('request-detail-decide-reason-error')).toBeInTheDocument()
    expect(api.decideChangeRequest).not.toHaveBeenCalled()
  })
})

describe('closing and refusals', () => {
  // @story: SCRUM-60
  // @ac: 1
  it('closes the form without sending when Cancel is clicked', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-accept-button'))
    await user.click(screen.getByTestId('request-detail-decide-cancel-button'))

    expect(screen.queryByTestId('request-detail-decide-form')).not.toBeInTheDocument()
    expect(api.decideChangeRequest).not.toHaveBeenCalled()
  })

  // @story: SCRUM-60
  // @ac: 7
  it('shows the refusal and the request as it now stands when it was decided elsewhere', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValueOnce(EVENT).mockResolvedValueOnce(decided({ status: 'Accepted' }))
    api.decideChangeRequest.mockRejectedValue(new Error('Only an open request can be decided.'))
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-decline-button'))
    await user.type(screen.getByTestId('request-detail-decide-reason-input'), 'Changed my mind.')

    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Only an open request can be decided.')
    await waitFor(() => expect(screen.getByTestId('request-detail-change-status-4')).toHaveTextContent('Accepted'))
    expect(screen.queryByTestId('request-detail-decide-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-60
  // @ac: 7
  it('shows the reload failure when the request cannot be read again either', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValueOnce(EVENT).mockRejectedValueOnce(new Error('Could not load.'))
    api.decideChangeRequest.mockRejectedValue(new Error('Only an open request can be decided.'))
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-accept-button'))

    await user.click(screen.getByTestId('request-detail-decide-confirm-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Could not load.')
  })
})
