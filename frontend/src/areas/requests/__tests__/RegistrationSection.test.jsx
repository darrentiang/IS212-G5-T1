import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useAuth } from '../../../app/auth'
import * as api from '../api'
import RegistrationSection from '../RegistrationSection'
import RequestDetailPage from '../RequestDetailPage'

vi.mock('../api')
vi.mock('../../../app/auth')
// @story: SCRUM-92
// @ac: 1, 2, 3, 4, 5

const OFF = { enabled: false, capacity: null, closes_at: null, can_edit: true }
const ON = {
  enabled: true, capacity: 50, closes_at: '2026-12-06T10:00', can_edit: true,
  registered: 0, places_remaining: 50, attendees: [],
}
const EVENT = {
  id: 92, name: 'Reg Fair', purpose: 'Fair', description: 'A fair', date: '2026-12-06',
  start_time: '10:00', end_time: '12:00', attendance: 50, equipment_requirements: 'None',
  registration_needs: 'Open', layout: null, facilities: [], accessibility_features: [],
  status: 'Confirmed', assigned_coordinator: 'coord1', created_by: 'org1', change_record: [],
  registration: ON,
}
const id = (suffix) => screen.getByTestId(`request-detail-registration-${suffix}`)

function mount(registration = ON) {
  const onSaved = vi.fn()
  const onRefused = vi.fn()
  render(<RegistrationSection event={{ ...EVENT, registration }} onSaved={onSaved} onRefused={onRefused} />)
  return { onSaved, onRefused }
}
afterEach(() => vi.resetAllMocks())

describe('SCRUM-92 registration section', () => {
  it('shows registration on with its capacity and closing time', () => {
    mount(ON)
    expect(id('enabled')).toHaveTextContent('On')
    expect(id('capacity')).toHaveTextContent('50')
    expect(id('closes')).toHaveTextContent('06 Dec 2026, 10:00')
    expect(id('edit-button')).toHaveTextContent('Edit')
  })

  it('shows registration off with no capacity or closing time as None', () => {
    mount(OFF)
    expect(id('enabled')).toHaveTextContent('Off')
    expect(id('capacity')).toHaveTextContent('None')
    expect(id('closes')).toHaveTextContent('None')
  })

  it('is read-only when the API says the account may not edit', () => {
    mount({ ...OFF, can_edit: false })
    expect(id('enabled')).toHaveTextContent('Off')
    expect(screen.queryByTestId('request-detail-registration-edit-button')).not.toBeInTheDocument()
  })

  it('is not shown when the API sends no registration (anyone but the assigned coordinator or the creator)', () => {
    const { container } = render(
      <RegistrationSection event={{ ...EVENT, registration: undefined }} onSaved={vi.fn()} onRefused={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('opens filled with the settings, focuses Registration and sends the entered values', async () => {
    const user = userEvent.setup()
    const { onSaved } = mount(ON)
    await user.click(id('edit-button'))
    expect(id('enabled-input')).toHaveFocus()
    expect(id('enabled-input')).toHaveValue('on')
    expect(id('capacity-input')).toHaveValue(50)
    expect(id('closing-date-input')).toHaveValue('2026-12-06')
    expect(id('closing-time-input')).toHaveValue('10:00')
    await user.clear(id('capacity-input'))
    await user.type(id('capacity-input'), '3')
    const updated = { ...EVENT, registration: { ...ON, capacity: 3 } }
    vi.mocked(api.setRegistration).mockResolvedValue(updated)
    await user.click(id('save-button'))
    expect(api.setRegistration).toHaveBeenCalledExactlyOnceWith(92, {
      enabled: true, capacity: '3', closing_date: '2026-12-06', closing_time: '10:00',
    })
    expect(onSaved).toHaveBeenCalledWith(updated)
    expect(screen.queryByTestId('request-detail-registration-form')).not.toBeInTheDocument()
  })

  it('sends blanks and off as entered', async () => {
    const user = userEvent.setup()
    mount(OFF)
    await user.click(id('edit-button'))
    expect(id('capacity-input')).toHaveValue(null)
    expect(id('closing-date-input')).toHaveValue('')
    vi.mocked(api.setRegistration).mockResolvedValue(EVENT)
    await user.selectOptions(id('enabled-input'), 'off')
    await user.click(id('save-button'))
    expect(api.setRegistration).toHaveBeenCalledWith(92, {
      enabled: false, capacity: '', closing_date: '', closing_time: '',
    })
  })

  it('keeps the form and the entries open on a refusal and passes the message up', async () => {
    const user = userEvent.setup()
    const { onSaved, onRefused } = mount(ON)
    await user.click(id('edit-button'))
    await user.clear(id('capacity-input'))
    await user.type(id('capacity-input'), '2')
    vi.mocked(api.setRegistration).mockRejectedValue(
      new Error('Capacity cannot be less than the 3 people registered.'))
    await user.click(id('save-button'))
    await waitFor(() => expect(onRefused).toHaveBeenCalledWith('Capacity cannot be less than the 3 people registered.'))
    expect(id('capacity-input')).toHaveValue(2)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('closes on Cancel without sending', async () => {
    const user = userEvent.setup()
    mount(ON)
    await user.click(id('edit-button'))
    await user.click(id('cancel-button'))
    expect(screen.queryByTestId('request-detail-registration-form')).not.toBeInTheDocument()
    expect(api.setRegistration).not.toHaveBeenCalled()
  })

  const deferred = () => {
    let resolve, reject
    const promise = new Promise((a, b) => { resolve = a; reject = b })
    return { promise, resolve, reject }
  }

  // A reply that arrives after the section is gone changes nothing and calls nobody.
  it.each(['resolve', 'reject'])('ignores a save that will %s after leaving', async (outcome) => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const onRefused = vi.fn()
    const { unmount } = render(
      <RegistrationSection event={EVENT} onSaved={onSaved} onRefused={onRefused} />,
    )
    await user.click(id('edit-button'))
    const pending = deferred()
    vi.mocked(api.setRegistration).mockReturnValue(pending.promise)
    await user.click(id('save-button'))
    unmount()
    if (outcome === 'resolve') pending.resolve(EVENT)
    else pending.reject(new Error('late'))
    await pending.promise.catch(() => null)
    expect(onSaved).not.toHaveBeenCalled()
    expect(onRefused).not.toHaveBeenCalled()
  })
})

describe('SCRUM-92 registration on Request detail', () => {
  function page() {
    vi.mocked(useAuth).mockReturnValue({
      account: { username: 'coord1' },
      can: (key) => ['registration.manage', 'requests.edit_event'].includes(key),
    })
    vi.mocked(api.listHolds).mockResolvedValue([])
    vi.mocked(api.listBookings).mockResolvedValue([])
    vi.mocked(api.listVenues).mockResolvedValue([])
    render(
      <MemoryRouter initialEntries={['/requests/92']}>
        <Routes><Route path="/requests/:id" element={<RequestDetailPage />} /></Routes>
      </MemoryRouter>,
    )
  }

  it('shows the saved settings and the Registration updated banner', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getRequest).mockResolvedValue({ ...EVENT, registration: OFF })
    page()
    await user.click(await screen.findByTestId('request-detail-registration-edit-button'))
    await user.selectOptions(id('enabled-input'), 'on')
    vi.mocked(api.setRegistration).mockResolvedValue({
      ...EVENT, registration: { ...ON, capacity: 120, closes_at: '2026-12-05T18:00' },
    })
    await user.click(id('save-button'))
    await waitFor(() => expect(id('capacity')).toHaveTextContent('120'))
    expect(id('closes')).toHaveTextContent('05 Dec 2026, 18:00')
    expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Registration updated')
  })

  it('shows a refusal in the banner and reads the request again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getRequest).mockResolvedValue(EVENT)
    page()
    await user.click(await screen.findByTestId('request-detail-registration-edit-button'))
    await user.selectOptions(id('enabled-input'), 'off')
    vi.mocked(api.setRegistration).mockRejectedValue(
      new Error('Registration cannot be turned off while 3 people are registered.'))
    await user.click(id('save-button'))
    await waitFor(() => expect(screen.getByTestId('request-detail-banner')).toHaveTextContent(
      'Registration cannot be turned off while 3 people are registered.'))
    expect(api.getRequest).toHaveBeenCalledTimes(2)
    expect(id('enabled')).toHaveTextContent('On')
    expect(id('form')).toBeInTheDocument()
  })

  it('shows the reload failure when the request cannot be read again', async () => {
    const user = userEvent.setup()
    vi.mocked(api.getRequest).mockResolvedValueOnce(EVENT).mockRejectedValueOnce(new Error('Network down'))
    page()
    await user.click(await screen.findByTestId('request-detail-registration-edit-button'))
    vi.mocked(api.setRegistration).mockRejectedValue(new Error('Capacity must be a whole number of at least 1.'))
    await user.click(id('save-button'))
    await waitFor(() => expect(screen.getByTestId('request-detail-banner')).toHaveTextContent('Network down'))
  })
})

describe('SCRUM-57 registrations on the registration section', () => {
  // @story: SCRUM-57
  // @ac: 1, 2
  const COUNTED = {
    ...ON, capacity: 3, registered: 2, places_remaining: 1,
    attendees: [
      { username: 'att1', registered_at: '2026-11-20T10:00:00Z' },
      { username: 'att57a', registered_at: '2026-11-21T11:30:00Z' },
    ],
  }
  const rows = () => screen.getAllByTestId(/^request-detail-registration-attendee-att/)
    .filter((row) => row.tagName === 'TR')

  it('shows the counts and the registered attendees in the order sent', () => {
    mount(COUNTED)
    expect(id('registered')).toHaveTextContent('2')
    expect(id('capacity')).toHaveTextContent('3')
    expect(id('places-remaining')).toHaveTextContent('1')
    expect(id('attendees')).toBeInTheDocument()
    expect(rows().map((row) => row.dataset.testid)).toEqual([
      'request-detail-registration-attendee-att1', 'request-detail-registration-attendee-att57a',
    ])
    expect(id('attendee-name-att1')).toHaveTextContent('att1')
    expect(id('attendee-registered-at-att1')).toHaveTextContent('20 Nov 2026, 10:00')
    expect(id('attendee-registered-at-att57a')).toHaveTextContent('21 Nov 2026, 11:30')
    expect(screen.queryByTestId('request-detail-registration-not-on')).not.toBeInTheDocument()
  })

  it('shows Registered 0 and a sentence in place of the table when nobody has registered', () => {
    mount({ ...ON, capacity: 3, places_remaining: 3 })
    expect(id('registered')).toHaveTextContent('0')
    expect(id('places-remaining')).toHaveTextContent('3')
    expect(id('attendees-empty')).toHaveTextContent('No one has registered yet.')
    expect(screen.queryByTestId('request-detail-registration-attendees')).not.toBeInTheDocument()
  })

  it('says registration is not on, with no counts or table, while it is off', () => {
    mount({ ...OFF, capacity: 3 })
    expect(id('enabled')).toHaveTextContent('Off')
    expect(id('not-on')).toHaveTextContent('Registration is not on for this event.')
    for (const suffix of ['registered', 'places-remaining', 'attendees', 'attendees-empty']) {
      expect(screen.queryByTestId(`request-detail-registration-${suffix}`)).not.toBeInTheDocument()
    }
  })

  it('shows the Organiser the same read-only, with no Edit', () => {
    mount({ ...COUNTED, can_edit: false })
    expect(id('registered')).toHaveTextContent('2')
    expect(rows()).toHaveLength(2)
    expect(screen.queryByTestId('request-detail-registration-edit-button')).not.toBeInTheDocument()
  })
})
