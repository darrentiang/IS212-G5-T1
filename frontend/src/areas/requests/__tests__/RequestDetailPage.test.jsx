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

function signInWith(features) {
  vi.mocked(auth.useAuth).mockReturnValue({ can: (feature) => features.includes(feature) })
}

const SUBMITTED = {
  id: 1,
  name: 'Annual Dinner',
  purpose: 'Year-end dinner',
  description: 'Dinner for staff and guests',
  date: '2026-12-12',
  start_time: '19:00',
  end_time: '22:30',
  attendance: 150,
  venue_requirements: 'Banquet layout',
  accessibility_needs: 'Step-free access',
  equipment_requirements: 'Sound system',
  registration_needs: 'Guest list supplied',
  status: STATUS.REQUEST.SUBMITTED,
  created_by: 'org1',
  registration_enabled: false,
  submitted_at: '2026-09-01T10:00:00',
  decision: null,
  decision_reason: null,
  decided_at: null,
  decided_by: null,
}

const decided = (decision, reason = null) => ({
  ...SUBMITTED,
  status: decision,
  decision,
  decision_reason: reason,
  decided_at: '2026-09-23T14:05:00',
  decided_by: 'coord1',
})

function renderDetail() {
  render(
    <MemoryRouter initialEntries={['/requests/1']}>
      <Routes>
        <Route path="/requests/:id" element={<RequestDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequestDetailPage', () => {
  // @story: SCRUM-27
  // @ac: 1
  it('shows public fields when the API returns the request', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Annual Dinner',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-name')).toHaveTextContent('Annual Dinner')
    })
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    expect(screen.queryByTestId('request-detail-coordinator-notes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-submit-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 2, 8
  it('shows the refusal banner and no fields when the API refuses', async () => {
    api.getRequest.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent(/permission/i)
    })
    expect(screen.queryByTestId('request-detail-name')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 6
  it('shows coordinator notes when the API includes them', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Annual Dinner',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
      coordinator_notes: 'Internal: venue shortlist pending.',
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-coordinator-notes')).toHaveTextContent('venue shortlist')
    })
  })

  // @story: SCRUM-27
  // @ac: 1
  it('ignores the API result after unmount', async () => {
    let resolveGet
    api.getRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    resolveGet({ id: 1, name: 'Annual Dinner', status: 'Submitted', created_by: 'org1', registration_enabled: false })
  })

  // @story: SCRUM-27
  // @ac: 8
  it('ignores the API error after unmount', async () => {
    let rejectGet
    api.getRequest.mockReturnValue(
      new Promise((resolve, reject) => {
        rejectGet = reject
      }),
    )
    const { unmount } = render(
      <MemoryRouter initialEntries={['/requests/1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    unmount()
    rejectGet(new Error('gone'))
  })

  // @story: SCRUM-28
  // @ac: 2
  it("offers Submit on the owner's Draft request", async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-submit-button')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-28
  // @ac: 2, 4, 6
  it('submits the Draft and shows the new status with a success banner', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.submitDraft.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Submitted',
      created_by: 'org1',
      registration_enabled: false,
    })

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-submit-button'))
    await userEvent.click(screen.getByTestId('request-detail-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-status')).toHaveTextContent('Submitted')
    })
    expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request submitted')
    expect(screen.queryByTestId('request-detail-submit-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-28
  // @ac: 3
  it('shows the API refusal when submitting an already-Submitted request', async () => {
    api.getRequest.mockResolvedValue({
      id: 1,
      name: 'Design Workshop',
      status: 'Draft',
      created_by: 'org1',
      registration_enabled: false,
    })
    api.submitDraft.mockRejectedValue(
      Object.assign(new Error('Only a Draft request can be submitted.'), { status: 400 }),
    )

    renderDetail()
    await waitFor(() => screen.getByTestId('request-detail-submit-button'))
    await userEvent.click(screen.getByTestId('request-detail-submit-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Only a Draft request can be submitted.')
    })
  })

  // @story: SCRUM-29
  // @ac: 2
  it('shows every submitted field formatted, the submission date and time and the organiser', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue(SUBMITTED)

    renderDetail()

    await waitFor(() => screen.getByTestId('request-detail-name'))
    expect(screen.getByTestId('request-detail-purpose')).toHaveTextContent('Year-end dinner')
    expect(screen.getByTestId('request-detail-date')).toHaveTextContent('12 Dec 2026')
    expect(screen.getByTestId('request-detail-start-time')).toHaveTextContent('19:00')
    expect(screen.getByTestId('request-detail-end-time')).toHaveTextContent('22:30')
    expect(screen.getByTestId('request-detail-attendance')).toHaveTextContent('150')
    expect(screen.getByTestId('request-detail-registration-needs')).toHaveTextContent('Guest list supplied')
    expect(screen.getByTestId('request-detail-submitted-at')).toHaveTextContent('01 Sep 2026, 10:00')
    expect(screen.getByTestId('request-detail-created-by')).toHaveTextContent('org1')
    expect(screen.queryByTestId('request-detail-decision')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-approve-button')).toBeInTheDocument()
    expect(screen.getByTestId('request-detail-reject-button')).toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 2
  it('leaves a Draft field empty rather than formatting a missing value', async () => {
    api.getRequest.mockResolvedValue({ ...SUBMITTED, status: STATUS.REQUEST.DRAFT, date: null, start_time: '', submitted_at: null })

    renderDetail()

    await waitFor(() => screen.getByTestId('request-detail-date'))
    expect(screen.getByTestId('request-detail-date')).toBeEmptyDOMElement()
    expect(screen.getByTestId('request-detail-start-time')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('request-detail-submitted-at')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 1
  it('does not offer Approve or Reject without the decide feature', async () => {
    signInWith(['requests.view'])
    api.getRequest.mockResolvedValue(SUBMITTED)

    renderDetail()

    await waitFor(() => screen.getByTestId('request-detail-status'))
    expect(screen.queryByTestId('request-detail-approve-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('request-detail-reject-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 1
  it('does not offer Approve or Reject on a request that is not Submitted', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue({ ...SUBMITTED, status: STATUS.REQUEST.CONFIRMED })

    renderDetail()

    await waitFor(() => screen.getByTestId('request-detail-status'))
    expect(screen.queryByTestId('request-detail-approve-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 3, 5
  it('approves with an optional reason and shows the recorded decision', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue(SUBMITTED)
    api.approveRequest.mockResolvedValue(decided(STATUS.REQUEST.APPROVED, 'Fits the autumn calendar.'))

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-approve-button'))
    expect(screen.getByTestId('request-detail-approve-reason-input')).not.toHaveAttribute('aria-required')
    await userEvent.type(screen.getByTestId('request-detail-approve-reason-input'), 'Fits the autumn calendar.')
    await userEvent.click(screen.getByTestId('request-detail-approve-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request approved')
    })
    expect(api.approveRequest).toHaveBeenCalledWith('1', 'Fits the autumn calendar.')
    expect(screen.getByTestId('request-detail-banner')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent(STATUS.REQUEST.APPROVED)
    expect(screen.getByTestId('request-detail-decision-reason')).toHaveTextContent('Fits the autumn calendar.')
    expect(screen.getByTestId('request-detail-decided-at')).toHaveTextContent('23 Sep 2026, 14:05')
    expect(screen.getByTestId('request-detail-decided-by')).toHaveTextContent('coord1')
    expect(screen.queryByTestId('request-detail-approve-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 3
  it('approves without a reason and shows no reason', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue(SUBMITTED)
    api.approveRequest.mockResolvedValue(decided(STATUS.REQUEST.APPROVED))

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-approve-button'))
    await userEvent.click(screen.getByTestId('request-detail-approve-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-decision')).toHaveTextContent(STATUS.REQUEST.APPROVED)
    })
    expect(api.approveRequest).toHaveBeenCalledWith('1', '')
    expect(screen.queryByTestId('request-detail-decision-reason')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 4
  it('refuses to send a rejection without a reason and shows a message under the field', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue(SUBMITTED)

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-reject-button'))
    expect(screen.getByTestId('request-detail-reject-reason-input')).toHaveAttribute('aria-required', 'true')
    await userEvent.type(screen.getByTestId('request-detail-reject-reason-input'), '   ')
    await userEvent.click(screen.getByTestId('request-detail-reject-confirm-button'))

    expect(screen.getByTestId('request-detail-reject-reason-error')).toHaveTextContent('Reason is required.')
    expect(api.rejectRequest).not.toHaveBeenCalled()
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent(STATUS.REQUEST.SUBMITTED)
  })

  // @story: SCRUM-29
  // @ac: 4, 6
  it('rejects with a reason and shows the decision and reason', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue(SUBMITTED)
    api.rejectRequest.mockResolvedValue(decided(STATUS.REQUEST.REJECTED, 'Venue capacity cannot be met.'))

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-reject-button'))
    await userEvent.type(screen.getByTestId('request-detail-reject-reason-input'), 'Venue capacity cannot be met.')
    await userEvent.click(screen.getByTestId('request-detail-reject-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Request rejected')
    })
    expect(screen.getByTestId('request-detail-status')).toHaveTextContent(STATUS.REQUEST.REJECTED)
    expect(screen.getByTestId('request-detail-decision-reason')).toHaveTextContent('Venue capacity cannot be met.')
  })

  // @story: SCRUM-29
  // @ac: 3, 4
  it('opening one decision form closes the other, and Cancel closes it', async () => {
    signInWith(['requests.decide'])
    api.getRequest.mockResolvedValue(SUBMITTED)

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-reject-button'))
    await userEvent.click(screen.getByTestId('request-detail-approve-button'))
    expect(screen.queryByTestId('request-detail-reject-reason-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('request-detail-approve-reason-input')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('request-detail-approve-cancel-button'))
    expect(screen.queryByTestId('request-detail-approve-reason-input')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 7
  it('shows the refusal and reloads the request with the existing decision when it was already decided', async () => {
    signInWith(['requests.decide'])
    const refusal = 'This request has already been decided (Approved on 23 Sep 2026, 14:05).'
    api.getRequest.mockResolvedValueOnce(SUBMITTED).mockResolvedValueOnce(decided(STATUS.REQUEST.APPROVED))
    api.rejectRequest.mockRejectedValue(Object.assign(new Error(refusal), { status: 409 }))

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-reject-button'))
    await userEvent.type(screen.getByTestId('request-detail-reject-reason-input'), 'Changed my mind.')
    await userEvent.click(screen.getByTestId('request-detail-reject-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-status')).toHaveTextContent(STATUS.REQUEST.APPROVED)
    })
    expect(screen.getByTestId('request-detail-banner')).toHaveTextContent(refusal)
    expect(screen.getByTestId('request-detail-banner')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('request-detail-decided-at')).toHaveTextContent('23 Sep 2026, 14:05')
    expect(screen.queryByTestId('request-detail-reject-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-29
  // @ac: 7
  it('shows the reload error when the request cannot be reloaded after a refusal', async () => {
    signInWith(['requests.decide'])
    api.getRequest
      .mockResolvedValueOnce(SUBMITTED)
      .mockRejectedValueOnce(Object.assign(new Error('Event request not found.'), { status: 404 }))
    api.approveRequest.mockRejectedValue(Object.assign(new Error('Only a Submitted request can be decided.'), { status: 409 }))

    renderDetail()
    await userEvent.click(await screen.findByTestId('request-detail-approve-button'))
    await userEvent.click(screen.getByTestId('request-detail-approve-confirm-button'))

    await waitFor(() => {
      expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Event request not found.')
    })
  })
})
