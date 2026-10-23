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

// SCRUM-45: the assigned coordinator asks the Organiser for clarification of a Submitted
// request; the Organiser answers.
const SUBMITTED = {
  id: 7,
  name: 'Clarify Gala',
  purpose: 'Client gala',
  description: 'Gala dinner',
  date: '2027-10-12',
  start_time: '10:00',
  end_time: '14:00',
  attendance: 80,
  equipment_requirements: 'None',
  registration_needs: 'None',
  status: STATUS.REQUEST.SUBMITTED,
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
}

const QUESTION = {
  id: 3,
  message: 'Please give the guest list size.',
  requested_by: 'coord1',
  requested_at: '2026-10-14T09:30:00',
  reply: null,
  replied_by: null,
  replied_at: null,
  open: true,
}
const ANSWERED = {
  ...QUESTION,
  id: 2,
  message: 'Which room?',
  reply: 'The Seminar Room.',
  replied_by: 'org2',
  replied_at: '2026-10-14T10:00:00',
  open: false,
}
const OPEN = { ...SUBMITTED, clarification_requested: true, clarifications: [QUESTION] }

const COORDINATOR = ['requests.view', 'requests.decide', 'notifications.view']
const ORGANISER = ['requests.view', 'requests.edit', 'clarifications.reply', 'notifications.view']

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

describe('asking', () => {
  // @story: SCRUM-45
  // @ac: 1, 2
  it('lets the assigned coordinator ask, then shows the flag, the message and the banner', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(SUBMITTED)
    api.requestClarification.mockResolvedValue(OPEN)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-clarification-button'))
    await user.type(screen.getByTestId('request-detail-clarification-message-input'), 'Please give the guest list size.')
    await user.click(screen.getByTestId('request-detail-clarification-send-button'))

    expect(api.requestClarification).toHaveBeenCalledWith('7', 'Please give the guest list size.')
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Clarification requested')
    expect(screen.getByTestId('request-detail-clarification-flag')).toHaveTextContent('Clarification requested')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    expect(screen.getByTestId('request-detail-clarification-message-3')).toHaveTextContent('Please give the guest list size.')
    expect(screen.getByTestId('request-detail-clarification-by-3')).toHaveTextContent('coord1, 14 Oct 2026, 09:30')
    expect(screen.queryByTestId('request-detail-clarification-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 1
  it('shows a message under the field and sends nothing when the message is blank', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(SUBMITTED)
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-clarification-button'))

    await user.click(screen.getByTestId('request-detail-clarification-send-button'))
    expect(screen.getByTestId('request-detail-clarification-message-error')).toHaveTextContent(
      'Say what is missing or unclear.',
    )
    await user.type(screen.getByTestId('request-detail-clarification-message-input'), '   ')
    await user.click(screen.getByTestId('request-detail-clarification-send-button'))
    expect(screen.getByTestId('request-detail-clarification-message-error')).toBeInTheDocument()
    await user.type(screen.getByTestId('request-detail-clarification-message-input'), 'x')

    expect(screen.queryByTestId('request-detail-clarification-message-error')).not.toBeInTheDocument()
    expect(api.requestClarification).not.toHaveBeenCalled()
  })

  // @story: SCRUM-45
  // @ac: 1
  it('closes the form without sending when Cancel is clicked', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(SUBMITTED)
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-clarification-button'))

    await user.click(screen.getByTestId('request-detail-clarification-cancel-button'))

    expect(screen.queryByTestId('request-detail-clarification-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-clarification-button')).toBeInTheDocument()
    expect(api.requestClarification).not.toHaveBeenCalled()
  })

  // @story: SCRUM-45
  // @ac: 4
  it('shows the refusal and the request as it now stands when one was opened elsewhere', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValueOnce(SUBMITTED).mockResolvedValueOnce(OPEN)
    api.requestClarification.mockRejectedValue(new Error('A clarification is already open on this request.'))
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-clarification-button'))
    await user.type(screen.getByTestId('request-detail-clarification-message-input'), 'Second question')

    await user.click(screen.getByTestId('request-detail-clarification-send-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent(
      'A clarification is already open on this request.',
    )
    await waitFor(() => expect(screen.getByTestId('request-detail-clarification-flag')).toBeInTheDocument())
    expect(screen.getByTestId('request-detail-clarification-message-3')).toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 7
  it('shows the first refusal when the request cannot be read again either', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValueOnce(SUBMITTED).mockRejectedValueOnce(new Error('Could not load.'))
    api.requestClarification.mockRejectedValue(new Error('Only a Submitted request can have clarification requested.'))
    renderDetail()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('request-detail-clarification-button'))
    await user.type(screen.getByTestId('request-detail-clarification-message-input'), 'Any news?')

    await user.click(screen.getByTestId('request-detail-clarification-send-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Could not load.')
  })
})

describe('who is offered what', () => {
  // @story: SCRUM-45
  // @ac: 7
  it('offers no Ask to a coordinator the request is not assigned to', async () => {
    signInWith(COORDINATOR, 'coord2')
    api.getRequest.mockResolvedValue(SUBMITTED)
    renderDetail()

    await screen.findByTestId('request-detail-name')

    expect(screen.queryByTestId('request-detail-clarification-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarifications')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 7
  it.each([STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING])('offers no Ask on a %s request', async (status) => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({ ...SUBMITTED, status })
    renderDetail()

    await screen.findByTestId('request-detail-name')

    expect(screen.queryByTestId('request-detail-clarification-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 4
  it('offers no second Ask while one is open, and no reply to the coordinator', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue(OPEN)
    renderDetail()

    await screen.findByTestId('request-detail-clarification-message-3')

    expect(screen.queryByTestId('request-detail-clarification-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-reply-form')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-clarification-flag')).toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 7
  it('offers no reply to an Organiser who did not write the request', async () => {
    signInWith(ORGANISER, 'org1')
    api.getRequest.mockResolvedValue(OPEN)
    renderDetail()

    await screen.findByTestId('request-detail-clarification-message-3')

    expect(screen.queryByTestId('request-detail-clarification-reply-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 2
  it('shows the Organiser the flag and the message but no Ask', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue({ ...OPEN, clarifications: [QUESTION] })
    renderDetail()

    expect(await screen.findByTestId('request-detail-clarification-flag')).toBeInTheDocument()
    expect(screen.getByTestId('request-detail-clarification-message-3')).toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-button')).not.toBeInTheDocument()
  })
})

describe('replying', () => {
  // @story: SCRUM-45
  // @ac: 3
  it('lets the Organiser reply, then shows the reply and clears the flag', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(OPEN)
    api.replyToClarification.mockResolvedValue({
      ...SUBMITTED,
      clarifications: [{ ...QUESTION, reply: 'Forty guests.', replied_by: 'org2', replied_at: '2026-10-14T10:00:00', open: false }],
    })
    renderDetail()
    const user = userEvent.setup()

    await user.type(await screen.findByTestId('request-detail-clarification-reply-input'), 'Forty guests.')
    await user.click(screen.getByTestId('request-detail-clarification-reply-button'))

    expect(api.replyToClarification).toHaveBeenCalledWith('7', 'Forty guests.')
    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('Reply sent')
    expect(screen.getByTestId('request-detail-clarification-reply-3')).toHaveTextContent('Forty guests.')
    expect(screen.getByTestId('request-detail-clarification-reply-by-3')).toHaveTextContent('org2, 14 Oct 2026, 10:00')
    expect(screen.queryByTestId('request-detail-clarification-flag')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-reply-form')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 3
  it('shows a message under the field and sends nothing when the reply is blank', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(OPEN)
    renderDetail()
    const user = userEvent.setup()

    await user.click(await screen.findByTestId('request-detail-clarification-reply-button'))
    expect(screen.getByTestId('request-detail-clarification-reply-error')).toHaveTextContent('Write a reply.')
    await user.type(screen.getByTestId('request-detail-clarification-reply-input'), 'x')

    expect(screen.queryByTestId('request-detail-clarification-reply-error')).not.toBeInTheDocument()
    expect(api.replyToClarification).not.toHaveBeenCalled()
  })

  // @story: SCRUM-45
  // @ac: 4
  it('shows the refusal and the request as it now stands when the wait was ended elsewhere', async () => {
    signInWith(ORGANISER, 'org2')
    const approved = {
      ...SUBMITTED,
      status: STATUS.REQUEST.APPROVED,
      clarifications: [{ ...QUESTION, open: false }],
    }
    api.getRequest.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(approved)
    api.replyToClarification.mockRejectedValue(new Error('No clarification is open on this request.'))
    renderDetail()
    const user = userEvent.setup()
    await user.type(await screen.findByTestId('request-detail-clarification-reply-input'), 'Too late?')

    await user.click(screen.getByTestId('request-detail-clarification-reply-button'))

    expect(await screen.findByTestId('request-detail-banner')).toHaveTextContent('No clarification is open on this request.')
    await waitFor(() => expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Approved'))
    expect(screen.queryByTestId('request-detail-clarification-reply-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-reply-3')).not.toBeInTheDocument()
  })
})

describe('the history', () => {
  // @story: SCRUM-45
  // @ac: 5
  it('lists every clarification and reply, oldest first, with who and when', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({ ...OPEN, clarifications: [ANSWERED, QUESTION] })
    renderDetail()

    await screen.findByTestId('request-detail-clarification-row-2')

    const rows = screen.getAllByTestId(/^request-detail-clarification-row-/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'request-detail-clarification-row-2',
      'request-detail-clarification-row-3',
    ])
    expect(screen.getByTestId('request-detail-clarification-reply-2')).toHaveTextContent('The Seminar Room.')
    expect(screen.queryByTestId('request-detail-clarification-reply-3')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 6
  it('keeps a clarification a decision ended, with no reply and no flag', async () => {
    signInWith(COORDINATOR, 'coord1')
    api.getRequest.mockResolvedValue({
      ...SUBMITTED,
      status: STATUS.REQUEST.APPROVED,
      clarifications: [{ ...QUESTION, open: false }],
    })
    renderDetail()

    expect(await screen.findByTestId('request-detail-clarification-message-3')).toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-reply-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-clarification-flag')).not.toBeInTheDocument()
  })

  // @story: SCRUM-45
  // @ac: 2
  it('shows no section when nothing has been asked', async () => {
    signInWith(ORGANISER, 'org2')
    api.getRequest.mockResolvedValue(SUBMITTED)
    renderDetail()

    await screen.findByTestId('request-detail-name')

    expect(screen.queryByTestId('request-detail-clarifications')).not.toBeInTheDocument()
  })
})
