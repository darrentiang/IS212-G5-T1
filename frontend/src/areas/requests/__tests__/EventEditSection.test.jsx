import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuth } from '../../../app/auth'
import * as api from '../api'
import EventEditSection from '../EventEditSection'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')
// @story: SCRUM-47
// @ac: 1, 2, 3, 5, 7

const EVENT = {
  id: 47, name: 'SCRUM-47 event', purpose: 'Original purpose', description: 'Original description',
  date: '2026-11-15', start_time: '10:00', end_time: '12:00', attendance: 40,
  equipment_requirements: '2 projectors', registration_needs: 'None needed',
  layout: 'Theatre', facilities: ['Projector'], accessibility_features: [],
  status: 'Planning', assigned_coordinator: 'coord1', created_by: 'org1', change_record: [],
}
const OPTIONS = {
  layouts: ['Classroom', 'Theatre'],
  facilities: ['Projector', 'Wi-Fi'],
  accessibility_features: ['Step-free access', 'Hearing loop'],
}
const id = (suffix) => screen.getByTestId(`request-detail-event-edit-${suffix}`)

function auth(user = 'coord1', features = ['requests.edit_event']) {
  vi.mocked(useAuth).mockReturnValue({ account: { username: user }, can: (key) => features.includes(key) })
}
function mount(event = EVENT) {
  auth()
  const onEdited = vi.fn()
  return { ...render(<EventEditSection event={event} onEdited={onEdited} />), onEdited }
}
async function open(user) {
  vi.mocked(api.getEditOptions).mockResolvedValue(OPTIONS)
  await user.click(id('button'))
  await screen.findByTestId('request-detail-event-edit-form')
}
afterEach(() => vi.resetAllMocks())

describe('SCRUM-47 edit event', () => {
  it.each(['Submitted', 'Approved', 'Planning', 'Safety Check', 'Confirmed'])('offers Edit event in %s', (status) => {
    mount({ ...EVENT, status })
    expect(id('button')).toHaveTextContent('Edit event')
  })

  it.each([
    ['org1', [], EVENT],
    ['lead1', [], EVENT],
    ['coord2', ['requests.edit_event'], EVENT],
    ['coord1', ['requests.edit_event'], { ...EVENT, status: 'Completed' }],
    ['coord1', ['requests.edit_event'], { ...EVENT, status: 'Draft' }],
  ])('offers no Edit event to %s', (user, features, event) => {
    auth(user, features)
    render(<EventEditSection event={event} onEdited={vi.fn()} />)
    expect(screen.queryByTestId('request-detail-event-edit-button')).not.toBeInTheDocument()
  })

  it('renders nothing without an auth context or a change record to show', () => {
    vi.mocked(useAuth).mockReturnValue(undefined)
    const { container } = render(<EventEditSection event={{ ...EVENT, change_record: undefined }} onEdited={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens filled with the event, focuses the name and sends every field', async () => {
    const user = userEvent.setup()
    const { onEdited } = mount()
    await open(user)
    expect(id('name-input')).toHaveFocus()
    expect(id('date-input')).toHaveValue('2026-11-15')
    expect(id('layout-input')).toHaveValue('Theatre')
    expect(id('facilities-projector-input')).toBeChecked()
    await user.clear(id('name-input'))
    await user.type(id('name-input'), 'SCRUM-47 Renamed')
    await user.selectOptions(id('layout-input'), '')
    await user.click(id('facilities-wi-fi-input'))
    await user.click(id('facilities-projector-input'))
    await user.click(id('accessibility-features-hearing-loop-input'))
    const updated = { ...EVENT, name: 'SCRUM-47 Renamed' }
    vi.mocked(api.editEvent).mockResolvedValue(updated)
    await user.click(id('confirm-button'))
    expect(api.editEvent).toHaveBeenCalledExactlyOnceWith(47, expect.objectContaining({
      name: 'SCRUM-47 Renamed', layout: null, facilities: ['Wi-Fi'],
      accessibility_features: ['Hearing loop'], attendance: 40,
    }))
    expect(onEdited).toHaveBeenCalledWith(updated)
    expect(screen.queryByTestId('request-detail-event-edit-form')).not.toBeInTheDocument()
  })

  it('keeps the form and entries with the API refusal', async () => {
    const user = userEvent.setup()
    const { onEdited } = mount({ ...EVENT, status: 'Confirmed' })
    await open(user)
    await user.clear(id('attendance-input'))
    await user.type(id('attendance-input'), '55')
    vi.mocked(api.editEvent).mockRejectedValue(new Error(
      'A significant change to an event in Safety Check or Confirmed needs an accepted change request.'))
    await user.click(id('confirm-button'))
    expect(await screen.findByTestId('request-detail-event-edit-error')).toHaveTextContent('accepted change request')
    expect(id('attendance-input')).toHaveValue(55)
    expect(onEdited).not.toHaveBeenCalled()
  })

  it('starts an event with no layout at None', async () => {
    const user = userEvent.setup()
    mount({ ...EVENT, layout: null })
    await open(user)
    expect(id('layout-input')).toHaveValue('')
  })

  const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => { resolve = a; reject = b })
    return { promise, resolve, reject }
  }

  // A reply that arrives after the section is gone (the user left the event)
  // changes nothing and calls nobody.
  it.each(['resolve', 'reject'])('ignores the lists when they %s after leaving', async (outcome) => {
    const user = userEvent.setup()
    const { unmount } = mount()
    const pending = deferred()
    vi.mocked(api.getEditOptions).mockReturnValue(pending.promise)
    await user.click(id('button'))
    unmount()
    if (outcome === 'resolve') pending.resolve(OPTIONS)
    else pending.reject(new Error('late'))
    await pending.promise.catch(() => null)
    expect(api.getEditOptions).toHaveBeenCalledTimes(1)
  })

  it.each(['resolve', 'reject'])('ignores a save that will %s after leaving', async (outcome) => {
    const user = userEvent.setup()
    const { unmount, onEdited } = mount()
    await open(user)
    const pending = deferred()
    vi.mocked(api.editEvent).mockReturnValue(pending.promise)
    await user.click(id('confirm-button'))
    unmount()
    if (outcome === 'resolve') pending.resolve(EVENT)
    else pending.reject(new Error('late'))
    await pending.promise.catch(() => null)
    expect(onEdited).not.toHaveBeenCalled()
  })

  it('closes on Cancel without sending', async () => {
    const user = userEvent.setup()
    mount()
    await open(user)
    await user.click(id('cancel-button'))
    expect(screen.queryByTestId('request-detail-event-edit-form')).not.toBeInTheDocument()
    expect(api.editEvent).not.toHaveBeenCalled()
  })

  it('shows the error when the lists cannot be loaded', async () => {
    const user = userEvent.setup()
    mount()
    vi.mocked(api.getEditOptions).mockRejectedValue(new Error('You do not have permission to perform this action.'))
    await user.click(id('button'))
    expect(await screen.findByTestId('request-detail-event-edit-error')).toHaveTextContent('permission')
    expect(screen.queryByTestId('request-detail-event-edit-form')).not.toBeInTheDocument()
  })

  it('shows each significant change with its old and new value, who and when', () => {
    mount({ ...EVENT, change_record: [
      { id: 1, field: 'date', old_value: '2026-11-15', new_value: '2026-11-22', changed_by: 'coord1', changed_at: '2026-10-26T02:00:00Z' },
      { id: 2, field: 'layout', old_value: 'Theatre', new_value: null, changed_by: 'coord1', changed_at: '2026-10-26T02:00:00Z' },
    ] })
    const rows = screen.getAllByTestId('request-detail-change-record-entry')
    expect(rows[0]).toHaveTextContent('Date: 15 Nov 2026 → 22 Nov 2026, by coord1 at 26 Oct 2026, 02:00 UTC')
    expect(rows[1]).toHaveTextContent('Room layout: Theatre → None')
    expect(rows[0]).toHaveAttribute('data-field', 'date')
  })

  it('says when no significant change is recorded', () => {
    mount()
    expect(screen.getByTestId('request-detail-change-record-empty')).toHaveTextContent('No significant changes recorded.')
  })

  it('shows no change record to an account that is not the assigned coordinator', () => {
    auth('lead1', [])
    render(<EventEditSection event={EVENT} onEdited={vi.fn()} />)
    expect(screen.queryByTestId('request-detail-change-record')).not.toBeInTheDocument()
  })

  it('on Request detail, shows the saved event and the Event updated banner', async () => {
    const user = userEvent.setup()
    auth()
    vi.mocked(api.getRequest).mockResolvedValue(EVENT)
    vi.mocked(api.listHolds).mockResolvedValue([])
    vi.mocked(api.listBookings).mockResolvedValue([])
    vi.mocked(api.listVenues).mockResolvedValue([])
    render(
      <MemoryRouter initialEntries={['/requests/47']}>
        <Routes><Route path="/requests/:id" element={<RequestDetailPage />} /></Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('request-detail-event-edit-button')
    await open(user)
    vi.mocked(api.editEvent).mockResolvedValue({ ...EVENT, name: 'SCRUM-47 Renamed' })
    await user.click(id('confirm-button'))
    await waitFor(() => expect(screen.getByTestId('request-detail-name')).toHaveTextContent('SCRUM-47 Renamed'))
    expect(screen.getByText('Event updated')).toBeInTheDocument()
  })
})
