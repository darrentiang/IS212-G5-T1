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

// SCRUM-59: the Organiser asks for a change to their event, or for its withdrawal, after submitting it.
const APPROVED = {
  id: 7,
  name: 'Change Gala',
  purpose: 'Client gala',
  description: 'Gala dinner',
  date: '2027-10-12',
  start_time: '10:00',
  end_time: '14:00',
  attendance: 80,
  equipment_requirements: 'None',
  registration_needs: 'None',
  status: STATUS.REQUEST.APPROVED,
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
  change_requests: [],
}

const request = (overrides = {}) => ({
  id: 4,
  kind: 'Change',
  description: 'Move the event a week later.',
  affects: ['date_time'],
  needs_review: { venue_bookings: true, equipment_reservations: true },
  status: 'Open',
  raised_by: 'org2',
  raised_at: '2026-10-14T09:30:00',
  closed_at: null,
  ...overrides,
})

const ORGANISER = ['requests.view', 'requests.edit', 'changes.raise', 'notifications.view']
const COORDINATOR = ['requests.view', 'requests.decide', 'notifications.view']

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

const BUTTONS = ['request-detail-change-request-button', 'request-detail-withdrawal-request-button']

describe('who is offered the buttons', () => {
  // @story: SCRUM-59
  // @ac: 1
  it.each([STATUS.REQUEST.SUBMITTED, STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING, STATUS.REQUEST.SAFETY_CHECK, STATUS.REQUEST.CONFIRMED])(
    'offers the Organiser both buttons on a %s event',
    async (status) => {
      signInWith(ORGANISER, 'org2')
      api.getRequest.mockResolvedValue({ ...APPROVED, status })
      renderDetail()

      for (const id of BUTTONS) expect(await screen.findByTestId(id)).toBeInTheDocument()
    },
  )

  // @story: SCRUM-59
  // @ac: 8
  it.each([STATUS.REQUEST.DRAFT, STATUS.REQUEST.REJECTED, STATUS.REQUEST.COMPLETED, STATUS.REQUEST.CANCELLED])(
    'offers no button on a %s event',
    async (status) => {
      signInWith(ORGANISER, 'org2')
      api.getRequest.mockResolvedValue({ ...APPROVED, status })
      // A Rejected event opens the Organiser's resubmit form, which reads these lists.
      api.getRequestOptions.mockResolvedValue({ layouts: [], facilities: [], accessibility_features: [] })
      renderDetail()

      await screen.findByTestId('request-detail-name')

      for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    },
  )

  // @story: SCRUM-59
  // @ac: 8
  it('offers no button to an Organiser who did not write the event', async () => {
    signInWith(ORGANISER, 'org1')
    api.getRequest.mockResolvedValue(APPROVED)
    renderDetail()

    await screen.findByTestId('request-detail-name')

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 8
  it('offers no button to an account without the feature', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(APPROVED)
    renderDetail()

    await screen.findByTestId('request-detail-name')

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 5
  it('offers no button while a request is open, and the coordinator still sees it', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue({ ...APPROVED, change_requests: [request()] })
    renderDetail()

    expect(await screen.findByTestId('request-detail-change-row-4')).toBeInTheDocument()

    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 5
  it('offers the buttons again once the earlier request is closed', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue({ ...APPROVED, change_requests: [request({ status: 'Closed' })] })
    renderDetail()

    expect(await screen.findByTestId('request-detail-change-request-button')).toBeInTheDocument()
  })
})

describe('raising a change request', () => {
  // @story: SCRUM-59
  // @ac: 1, 2, 3
  it('sends the description and what it affects, then lists the request Open with what needs reviewing', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    api.raiseChangeRequest.mockResolvedValue({ ...APPROVED, change_requests: [request()] })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-change-request-button'))
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'Move the event a week later.')
    await user.click(screen.getByTestId('request-detail-change-affects-date-time-input'))
    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(api.raiseChangeRequest).toHaveBeenCalledWith('7', {
      kind: 'Change',
      description: 'Move the event a week later.',
      affects: ['date_time'],
    })
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Change request raised')
    expect(screen.getByTestId('request-detail-change-kind-4')).toHaveTextContent('Change request')
    expect(screen.getByTestId('request-detail-change-status-4')).toHaveTextContent('Open')
    expect(screen.getByTestId('request-detail-change-description-4')).toHaveTextContent('Move the event a week later.')
    expect(screen.getByTestId('request-detail-change-affects-4')).toHaveTextContent('Affects: Date or time')
    expect(screen.getByTestId('request-detail-change-review-4')).toHaveTextContent('Venue bookings and Equipment reservations')
    expect(screen.getByTestId('request-detail-change-raised-4')).toHaveTextContent('org2, 14 Oct 2026, 09:30')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Approved')
    expect(screen.queryByTestId('request-detail-change-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 1
  it('shows a message under the field and sends nothing when the description is blank', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-request-button'))
    await user.click(screen.getByTestId('request-detail-change-affects-other-input'))

    await user.click(screen.getByTestId('request-detail-change-send-button'))
    expect(screen.getByTestId('request-detail-change-description-error')).toHaveTextContent('Describe the change.')
    await user.type(screen.getByTestId('request-detail-change-description-input'), '   ')
    await user.click(screen.getByTestId('request-detail-change-send-button'))
    expect(screen.getByTestId('request-detail-change-description-error')).toBeInTheDocument()
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'x')

    expect(screen.queryByTestId('request-detail-change-description-error')).not.toBeInTheDocument()
    expect(api.raiseChangeRequest).not.toHaveBeenCalled()
  })

  // @story: SCRUM-59
  // @ac: 2
  it('shows a message and sends nothing when nothing is ticked, and ticking again takes it away', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-request-button'))
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'Please change something.')

    await user.click(screen.getByTestId('request-detail-change-send-button'))
    expect(screen.getByTestId('request-detail-change-affects-error')).toHaveTextContent('Choose what the change affects.')
    await user.click(screen.getByTestId('request-detail-change-affects-equipment-input'))
    expect(screen.queryByTestId('request-detail-change-affects-error')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('request-detail-change-affects-equipment-input'))
    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(screen.getByTestId('request-detail-change-affects-error')).toBeInTheDocument()
    expect(api.raiseChangeRequest).not.toHaveBeenCalled()
  })

  // @story: SCRUM-59
  // @ac: 2
  it('sends every ticked thing', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    api.raiseChangeRequest.mockResolvedValue(APPROVED)
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-request-button'))
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'Bigger and different.')

    await user.click(screen.getByTestId('request-detail-change-affects-attendance-input'))
    await user.click(screen.getByTestId('request-detail-change-affects-venue-requirements-input'))
    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(api.raiseChangeRequest).toHaveBeenCalledWith('7', {
      kind: 'Change',
      description: 'Bigger and different.',
      affects: ['attendance', 'venue_requirements'],
    })
  })

  // @story: SCRUM-59
  // @ac: 1
  it('closes the form without sending when Cancel is clicked', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-request-button'))

    await user.click(screen.getByTestId('request-detail-change-cancel-button'))

    expect(screen.queryByTestId('request-detail-change-form')).not.toBeInTheDocument()
    expect(api.raiseChangeRequest).not.toHaveBeenCalled()
  })

  // @story: SCRUM-59
  // @ac: 5
  it('shows the refusal and the request as it now stands when one was raised elsewhere', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValueOnce(APPROVED).mockResolvedValueOnce({ ...APPROVED, change_requests: [request()] })
    api.raiseChangeRequest.mockRejectedValue(new Error('A request is already open on this event.'))
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-request-button'))
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'Second request')
    await user.click(screen.getByTestId('request-detail-change-affects-other-input'))

    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('A request is already open on this event.')
    await waitFor(() => expect(screen.getByTestId('request-detail-change-row-4')).toBeInTheDocument())
    expect(screen.queryByTestId('request-detail-change-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 8
  it('shows the reload failure when the request cannot be read again either', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValueOnce(APPROVED).mockRejectedValueOnce(new Error('Could not load.'))
    api.raiseChangeRequest.mockRejectedValue(new Error('A change can be requested only on a Submitted event.'))
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-change-request-button'))
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'x')
    await user.click(screen.getByTestId('request-detail-change-affects-other-input'))

    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Could not load.')
  })
})

describe('raising a withdrawal request', () => {
  // @story: SCRUM-59
  // @ac: 1
  it('sends optional text with nothing affected and lists a withdrawal', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    api.raiseChangeRequest.mockResolvedValue({
      ...APPROVED,
      change_requests: [
        request({ kind: 'Withdrawal', description: 'Client cancelled the plan.', affects: [], needs_review: { venue_bookings: false, equipment_reservations: false } }),
      ],
    })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-withdrawal-request-button'))
    expect(screen.queryByTestId('request-detail-change-affects-other-input')).not.toBeInTheDocument()
    await user.type(screen.getByTestId('request-detail-change-description-input'), 'Client cancelled the plan.')
    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(api.raiseChangeRequest).toHaveBeenCalledWith('7', {
      kind: 'Withdrawal',
      description: 'Client cancelled the plan.',
      affects: [],
    })
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Withdrawal request raised')
    expect(screen.getByTestId('request-detail-change-kind-4')).toHaveTextContent('Withdrawal request')
    expect(screen.getByTestId('request-detail-change-description-4')).toHaveTextContent('Client cancelled the plan.')
    expect(screen.queryByTestId('request-detail-change-affects-4')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-change-review-4')).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 1
  it('sends a withdrawal with no text and shows no description', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    api.raiseChangeRequest.mockResolvedValue({
      ...APPROVED,
      change_requests: [request({ kind: 'Withdrawal', description: null, affects: [] })],
    })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-withdrawal-request-button'))
    await user.click(screen.getByTestId('request-detail-change-send-button'))

    expect(api.raiseChangeRequest).toHaveBeenCalledWith('7', { kind: 'Withdrawal', description: '', affects: [] })
    await screen.findByTestId('request-detail-change-kind-4')
    expect(screen.queryByTestId('request-detail-change-description-4')).not.toBeInTheDocument()
  })
})

describe('the list', () => {
  // @story: SCRUM-59
  // @ac: 2
  it.each([
    [['attendance'], { venue_bookings: true, equipment_reservations: false }, 'Venue bookings'],
    [['equipment'], { venue_bookings: false, equipment_reservations: true }, 'Equipment reservations'],
    [['other'], { venue_bookings: false, equipment_reservations: false }, 'Nothing needs reviewing'],
  ])('says what needs reviewing for %j', async (affects, needsReview, text) => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({ ...APPROVED, change_requests: [request({ affects, needs_review: needsReview })] })
    renderDetail()

    expect(await screen.findByTestId('request-detail-change-review-4')).toHaveTextContent(new RegExp(`^${text}$`))
  })

  // @story: SCRUM-59
  // @ac: 6
  it('shows the coordinator the open request', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({ ...APPROVED, change_requests: [request({ affects: ['venue_requirements', 'other'] })] })
    renderDetail()

    expect(await screen.findByTestId('request-detail-change-status-4')).toHaveTextContent('Open')
    expect(screen.getByTestId('request-detail-change-affects-4')).toHaveTextContent('Affects: Venue requirements, Other')
    for (const id of BUTTONS) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 7
  it('shows a request the event ending closed as Closed without a decision', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue({
      ...APPROVED,
      status: STATUS.REQUEST.CANCELLED,
      change_requests: [request({ status: 'Closed', closed_at: '2026-10-15T10:00:00' })],
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-change-status-4')).toHaveTextContent('Closed')
    expect(screen.getByTestId('request-detail-change-closed-4')).toHaveTextContent('Closed without a decision')
  })

  // @story: SCRUM-59
  // @ac: 3
  it('shows an open request with no note about a decision', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue({ ...APPROVED, change_requests: [request()] })
    renderDetail()

    await screen.findByTestId('request-detail-change-row-4')

    expect(screen.queryByTestId('request-detail-change-closed-4')).not.toBeInTheDocument()
  })

  // @story: SCRUM-59
  // @ac: 3
  it('shows no section when nothing has been raised', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(APPROVED)
    renderDetail()

    await screen.findByTestId('request-detail-name')

    expect(screen.queryByTestId('request-detail-change-requests')).not.toBeInTheDocument()
  })
})
