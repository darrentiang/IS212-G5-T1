import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import { STATUS } from '../../../app/format'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')

afterEach(() => {
  vi.restoreAllMocks()
})

// SCRUM-89 AC3 to AC10 as the Safety Officer's page shows them.
const EVENT = {
  id: 7,
  name: 'Harbour Gala',
  purpose: 'Client gala dinner',
  description: 'Seated gala dinner by the harbour',
  date: '2027-06-10',
  start_time: '18:00',
  end_time: '22:00',
  attendance: 150,
  equipment_requirements: 'None needed',
  registration_needs: 'No registration',
  status: STATUS.REQUEST.SAFETY_CHECK,
  created_by: 'org1',
  layout: 'Banquet',
  facilities: [],
  accessibility_features: ['Step-free access'],
  registration_enabled: false,
  submitted_at: '2026-09-20T09:00:00',
  decision: null,
  decision_reason: null,
  decided_at: null,
  decided_by: null,
  assigned_coordinator: 'coord1',
  assigned_at: '2026-09-21T09:00:00',
  safety_decisions: [],
  safety_check: {
    sent_at: '2026-10-08T09:00:00',
    note_areas: [
      'attendance',
      'capacity_and_layout',
      'emergency_access',
      'accessibility',
      'equipment_placement',
      'crowd_movement',
      'venue_restrictions',
    ],
    venue_bookings: [
      {
        id: 31,
        date: '2027-06-10',
        start_time: '18:00',
        end_time: '22:00',
        venue: {
          id: 2,
          name: 'Auditorium',
          location: 'Block C Level 1',
          max_capacity: 400,
          layouts: ['Banquet', 'Theatre'],
          facilities: ['Projector', 'Sound system'],
          accessibility_features: ['Step-free access', 'Hearing loop'],
        },
      },
    ],
    equipment_requirements: [],
  },
}

function signInWith(features, username = 'safety1') {
  vi.mocked(auth.useAuth).mockReturnValue({
    can: (feature) => features.includes(feature),
    account: { username },
  })
}

function ListStub() {
  const { state } = useLocation()
  return <p data-testid="list-stub">{state?.banner}</p>
}

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/7']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route path="/requests" element={<ListStub />} />
      </Routes>
    </MemoryRouter>,
  )
}

const SAFETY_OFFICER = ['requests.view', 'safety.decide', 'notifications.view']

// @story: SCRUM-89
// @ac: 3
describe('the Safety Officer reviews an event in Safety Check', () => {
  it('shows each Approved booking with the venue capacity, layouts, facilities and accessibility features', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-booking-31-venue')).toHaveTextContent(
      'Auditorium, Block C Level 1',
    )
    expect(screen.getByTestId('request-detail-safety-booking-31-capacity')).toHaveTextContent('400')
    expect(screen.getByTestId('request-detail-safety-booking-31-layouts')).toHaveTextContent('Banquet, Theatre')
    expect(screen.getByTestId('request-detail-safety-booking-31-facilities')).toHaveTextContent(
      'Projector, Sound system',
    )
    expect(screen.getByTestId('request-detail-safety-booking-31-accessibility')).toHaveTextContent(
      'Step-free access, Hearing loop',
    )
    expect(screen.getByTestId('request-detail-safety-sent-at')).toHaveTextContent('08 Oct 2026, 09:00')
    expect(screen.getByTestId('request-detail-fields')).toHaveTextContent('150')
    expect(screen.getByTestId('request-detail-accessibility-features')).toHaveTextContent('Step-free access')
  })

  it('says so when there is no Approved booking or equipment requirement', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue({
      ...EVENT,
      safety_check: { ...EVENT.safety_check, venue_bookings: [] },
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-bookings-empty')).toBeInTheDocument()
    expect(screen.getByTestId('request-detail-safety-equipment-empty')).toBeInTheDocument()
  })

  it('lists each Approved equipment requirement once equipment is recorded', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue({
      ...EVENT,
      safety_check: {
        ...EVENT.safety_check,
        equipment_requirements: [{ id: 1, equipment_type: 'Projector', quantity: 2 }],
      },
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-equipment')).toHaveTextContent('Projector, 2')
  })
})

// @story: SCRUM-89
// @ac: 5
describe('earlier decisions', () => {
  it('shows each earlier decision with its reason, notes, date and Safety Officer', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue({
      ...EVENT,
      safety_decisions: [
        {
          id: 3,
          decision: 'Rejected',
          reason: 'Exits not marked',
          notes: { emergency_access: 'Stage blocks the east exit' },
          areas: [],
          decided_at: '2026-10-05T10:00:00',
          decided_by: 'safety1',
        },
      ],
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-decision-3-decision')).toHaveTextContent('Rejected')
    expect(screen.getByTestId('request-detail-safety-decision-3')).toHaveTextContent('safety1')
    expect(screen.getByTestId('request-detail-safety-decision-3')).toHaveTextContent('05 Oct 2026, 10:00')
    expect(screen.getByTestId('request-detail-safety-decision-3-reason')).toHaveTextContent('Exits not marked')
    expect(screen.getByTestId('request-detail-safety-decision-3-note-emergency-access')).toHaveTextContent(
      'Emergency access: Stage blocks the east exit',
    )
  })

  it('shows the decisions to an Event Coordinator, with no way to decide', async () => {
    signInWith(['requests.view', 'requests.decide', 'notifications.view'], 'coord1')
    const { safety_check: omitted, ...forCoordinator } = EVENT
    api.getRequest.mockResolvedValue({
      ...forCoordinator,
      safety_decisions: [
        {
          id: 3,
          decision: 'Rejected',
          reason: 'Exits not marked',
          notes: {},
          areas: [],
          decided_at: '2026-10-05T10:00:00',
          decided_by: 'safety1',
        },
      ],
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-decision-3-reason')).toHaveTextContent(
      'Exits not marked',
    )
    expect(screen.queryByTestId('request-detail-safety-form')).not.toBeInTheDocument()
    expect(omitted).toBeDefined()
  })

  it('shows nothing about safety when the event has no decision and the account is not reviewing', async () => {
    signInWith(['requests.view'], 'org1')
    const { safety_check: omitted, safety_decisions: none, ...plain } = EVENT
    api.getRequest.mockResolvedValue(plain)
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-safety-check')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-safety-decisions')).not.toBeInTheDocument()
    expect([omitted, none]).toHaveLength(2)
  })
})

// @story: SCRUM-89
// @ac: 4, 5, 6
describe('approving', () => {
  it('sends the notes typed, then returns to the list with the outcome', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.approveSafetyCheck.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.CONFIRMED })
    renderDetail()
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('request-detail-safety-note-emergency-access'), 'Two exits clear')
    await user.type(screen.getByTestId('request-detail-safety-note-crowd-movement'), 'One-way flow')
    await user.click(screen.getByTestId('request-detail-safety-approve-button'))

    await waitFor(() => expect(screen.getByTestId('list-stub')).toBeInTheDocument())
    expect(api.approveSafetyCheck).toHaveBeenCalledWith('7', {
      emergency_access: 'Two exits clear',
      crowd_movement: 'One-way flow',
    })
    expect(screen.getByTestId('list-stub')).toHaveTextContent('Harbour Gala: approved, now Confirmed')
  })

  it('approves with every note left blank', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.approveSafetyCheck.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.CONFIRMED })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-approve-button'))

    await waitFor(() => expect(api.approveSafetyCheck).toHaveBeenCalledWith('7', {}))
  })
})

// @story: SCRUM-89
// @ac: 5, 7
describe('rejecting', () => {
  it('needs a reason before anything is sent', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-reject-button'))
    expect(screen.getByTestId('request-detail-safety-reason-error')).toHaveTextContent('Reason is required.')

    await user.type(screen.getByTestId('request-detail-safety-reason-input'), '   ')
    await user.click(screen.getByTestId('request-detail-safety-reject-button'))
    expect(screen.getByTestId('request-detail-safety-reason-error')).toBeInTheDocument()
    expect(api.rejectSafetyCheck).not.toHaveBeenCalled()
  })

  it('sends the reason and notes, then returns to the list', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.rejectSafetyCheck.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.PLANNING })
    renderDetail()
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('request-detail-safety-reason-input'), 'Exit route blocked')
    await user.type(screen.getByTestId('request-detail-safety-note-venue-restrictions'), 'Stage too deep')
    await user.click(screen.getByTestId('request-detail-safety-reject-button'))

    await waitFor(() => expect(screen.getByTestId('list-stub')).toBeInTheDocument())
    expect(api.rejectSafetyCheck).toHaveBeenCalledWith('7', 'Exit route blocked', {
      venue_restrictions: 'Stage too deep',
    })
    expect(screen.getByTestId('list-stub')).toHaveTextContent('Harbour Gala: rejected, back in Planning')
  })
})

// @story: SCRUM-89
// @ac: 9
describe('a refused decision', () => {
  it('shows the reason and stays on the event', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.approveSafetyCheck.mockRejectedValue(
      new Error('No event in Safety Check was found with that number.'),
    )
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-approve-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent(
      'No event in Safety Check was found with that number.',
    )
    expect(screen.queryByTestId('list-stub')).not.toBeInTheDocument()
  })
})

// @story: SCRUM-89
// @ac: 10
describe('an account that cannot decide', () => {
  it('is offered no approve or reject control', async () => {
    signInWith(['requests.view', 'requests.decide', 'notifications.view'], 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    await screen.findByTestId('request-detail-safety-check')
    expect(screen.queryByTestId('request-detail-safety-approve-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-safety-reject-button')).not.toBeInTheDocument()
  })

  it('offers the Safety Officer no way to edit the event or its arrangements', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    await screen.findByTestId('request-detail-safety-check')
    for (const id of [
      'request-detail-edit-button',
      'request-detail-delete-button',
      'request-detail-submit-button',
      'request-detail-raise-booking-button',
      'request-detail-search-venues-button',
      'request-detail-approve-button',
      'request-detail-reject-button',
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
  })
})

// SCRUM-90 AC1, AC2: the Safety Officer sends the event back with the areas to change.
describe('requesting changes', () => {
  it('needs a reason and at least one area before anything is sent', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-request-changes-button'))
    expect(screen.getByTestId('request-detail-safety-reason-error')).toHaveTextContent('Reason is required.')
    expect(screen.getByTestId('request-detail-safety-area-error')).toHaveTextContent('Choose at least one area.')

    await user.type(screen.getByTestId('request-detail-safety-reason-input'), 'Stage blocks the exit')
    await user.click(screen.getByTestId('request-detail-safety-request-changes-button'))
    expect(screen.queryByTestId('request-detail-safety-reason-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-safety-area-error')).toBeInTheDocument()
    expect(api.requestSafetyChanges).not.toHaveBeenCalled()
  })

  it('sends the reason, the areas ticked and the notes, then returns to the list', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.requestSafetyChanges.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.PLANNING })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-area-technical-arrangements'))
    await user.click(screen.getByTestId('request-detail-safety-area-venue-arrangements'))
    await user.type(screen.getByTestId('request-detail-safety-reason-input'), 'Stage blocks the exit')
    await user.type(screen.getByTestId('request-detail-safety-note-emergency-access'), 'Move the stage back')
    await user.click(screen.getByTestId('request-detail-safety-request-changes-button'))

    await waitFor(() => expect(screen.getByTestId('list-stub')).toBeInTheDocument())
    expect(api.requestSafetyChanges).toHaveBeenCalledWith(
      '7',
      'Stage blocks the exit',
      ['venue_arrangements', 'technical_arrangements'],
      { emergency_access: 'Move the stage back' },
    )
    expect(screen.getByTestId('list-stub')).toHaveTextContent('Harbour Gala: changes requested, back in Planning')
  })

  it('lets a ticked area be unticked again', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.requestSafetyChanges.mockResolvedValue({ ...EVENT, status: STATUS.REQUEST.PLANNING })
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-area-venue-arrangements'))
    await user.click(screen.getByTestId('request-detail-safety-area-technical-arrangements'))
    await user.click(screen.getByTestId('request-detail-safety-area-venue-arrangements'))
    await user.type(screen.getByTestId('request-detail-safety-reason-input'), 'Needs work')
    await user.click(screen.getByTestId('request-detail-safety-request-changes-button'))

    await waitFor(() =>
      expect(api.requestSafetyChanges).toHaveBeenCalledWith('7', 'Needs work', ['technical_arrangements'], {}),
    )
  })

  it('shows a refused request in the banner and stays on the event', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue(EVENT)
    api.requestSafetyChanges.mockRejectedValue(
      new Error('No event in Safety Check was found with that number.'),
    )
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-safety-area-venue-arrangements'))
    await user.type(screen.getByTestId('request-detail-safety-reason-input'), 'Needs work')
    await user.click(screen.getByTestId('request-detail-safety-request-changes-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('No event in Safety Check')
    expect(screen.queryByTestId('list-stub')).not.toBeInTheDocument()
  })

  it('offers an Event Coordinator no way to request changes', async () => {
    signInWith(['requests.view', 'requests.decide', 'notifications.view'], 'coord1')
    api.getRequest.mockResolvedValue(EVENT)
    renderDetail()

    await screen.findByTestId('request-detail-safety-check')
    expect(screen.queryByTestId('request-detail-safety-request-changes-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-safety-area-venue-arrangements')).not.toBeInTheDocument()
  })
})

// SCRUM-90 AC5, AC7: what the coordinator sees, and what stays in the history.
describe('requested changes', () => {
  const PLANNING = {
    ...EVENT,
    status: STATUS.REQUEST.PLANNING,
    safety_check: undefined,
    requested_changes: {
      id: 9,
      decision: 'Changes requested',
      reason: 'Stalls block the fire lane',
      notes: { crowd_movement: 'One way only' },
      areas: ['venue_arrangements', 'technical_arrangements'],
      decided_at: '2026-10-12T10:00:00',
      decided_by: 'safety1',
    },
  }

  it('shows the Event Coordinator the reason, areas and notes while the event is in Planning', async () => {
    signInWith(['requests.view', 'requests.decide', 'notifications.view'], 'coord1')
    api.getRequest.mockResolvedValue(PLANNING)
    renderDetail()

    expect(await screen.findByTestId('request-detail-requested-changes')).toBeInTheDocument()
    expect(screen.getByTestId('request-detail-requested-changes-areas')).toHaveTextContent(
      'Venue arrangements, Technical arrangements',
    )
    expect(screen.getByTestId('request-detail-requested-changes-reason')).toHaveTextContent(
      'Stalls block the fire lane',
    )
    expect(screen.getByTestId('request-detail-requested-changes-note-crowd-movement')).toHaveTextContent(
      'One way only',
    )
    expect(screen.getByTestId('request-detail-requested-changes-by')).toHaveTextContent(
      'safety1, 12 Oct 2026, 10:00',
    )
  })

  it('shows nothing when no changes are outstanding', async () => {
    signInWith(['requests.view', 'requests.decide', 'notifications.view'], 'coord1')
    api.getRequest.mockResolvedValue({ ...PLANNING, requested_changes: null })
    renderDetail()

    await screen.findByTestId('request-detail-fields')
    expect(screen.queryByTestId('request-detail-requested-changes')).not.toBeInTheDocument()
  })

  it('lists a request for changes among the earlier decisions with its areas', async () => {
    signInWith(SAFETY_OFFICER)
    api.getRequest.mockResolvedValue({
      ...EVENT,
      safety_decisions: [
        {
          id: 4,
          decision: 'Changes requested',
          reason: 'Sound desk has no power feed',
          notes: {},
          areas: ['technical_arrangements'],
          decided_at: '2026-10-07T10:00:00',
          decided_by: 'safety1',
        },
      ],
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-safety-decision-4-decision')).toHaveTextContent(
      'Changes requested',
    )
    expect(screen.getByTestId('request-detail-safety-decision-4-areas')).toHaveTextContent(
      'Areas: Technical arrangements',
    )
  })
})
