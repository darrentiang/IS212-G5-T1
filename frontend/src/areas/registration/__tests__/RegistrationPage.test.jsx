import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import * as auth from '../../../app/auth'
import RegistrationPage from '../RegistrationPage'

vi.mock('../api')
vi.mock('../../../app/auth')

// An event as the list sends it (SCRUM-54); state is this account's.
const event = (id, state, fields = {}) => ({
  id,
  name: `Event ${id}`,
  purpose: 'Evening concert',
  status: 'Confirmed',
  date: '2026-12-10',
  start_time: '19:00',
  end_time: '21:00',
  venues: 'Seminar Room 1',
  state,
  ...fields,
})

function signInWith(features = ['registration.view', 'registration.register']) {
  vi.mocked(auth.useAuth).mockReturnValue({ can: (feature) => features.includes(feature) })
}

function renderPage() {
  render(
    <MemoryRouter>
      <RegistrationPage />
    </MemoryRouter>,
  )
}

// As in development (main.jsx): StrictMode runs the load effect twice, so two
// list requests are in flight and their replies can land in either order.
function renderStrictPage() {
  render(
    <StrictMode>
      <MemoryRouter>
        <RegistrationPage />
      </MemoryRouter>
    </StrictMode>,
  )
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Each list request gets its own deferred reply, in the order they are made.
function deferListReplies() {
  const replies = []
  api.listOpenEvents.mockImplementation(() => {
    const reply = deferred()
    replies.push(reply)
    return reply.promise
  })
  return replies
}

const action = (id) => screen.getByTestId(`registration-action-${id}`)

beforeEach(() => {
  signInWith()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RegistrationPage', () => {
  // @story: SCRUM-27
  // @ac: 6
  it('lists confirmed events without internal notes', async () => {
    api.listOpenEvents.mockResolvedValue([event(4, 'register', { name: 'Open House', purpose: 'Public open house' })])

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Open House')).toBeInTheDocument()
    })
    expect(screen.queryByText(/coordinator notes/i)).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 8
  it('shows the API refusal in the banner', async () => {
    api.listOpenEvents.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('registration-banner')).toHaveTextContent(/permission/i)
    })
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.listOpenEvents.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )
    renderPage()
    await screen.findByTestId('registration-banner')

    await userEvent.click(screen.getByTestId('registration-banner-dismiss'))

    expect(screen.queryByTestId('registration-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 6
  it('shows the empty message when the API returns no events', async () => {
    api.listOpenEvents.mockResolvedValue([])

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('registration-empty')).toBeInTheDocument()
    })
  })

  // @story: SCRUM-54
  // @ac: 5
  it("shows each event's name, purpose, date and time, venues and status", async () => {
    api.listOpenEvents.mockResolvedValue([event(4, 'register', { name: 'Reg Concert', venues: 'Auditorium, Seminar Room 1' })])

    renderPage()

    expect(await screen.findByTestId('registration-event-4')).toHaveTextContent('Reg Concert')
    expect(screen.getByTestId('registration-purpose-4')).toHaveTextContent('Evening concert')
    expect(screen.getByTestId('registration-period-4')).toHaveTextContent('10 Dec 2026, 19:00–21:00')
    expect(screen.getByTestId('registration-venues-4')).toHaveTextContent('Auditorium, Seminar Room 1')
    expect(screen.getByTestId('registration-status-4')).toHaveTextContent('Confirmed')
  })

  // @story: SCRUM-27
  // @ac: 6
  it('shows the event name as plain text to an account without requests.view', async () => {
    api.listOpenEvents.mockResolvedValue([event(4, 'register', { name: 'Reg Concert' })])

    renderPage()

    const cell = await screen.findByTestId('registration-event-4')
    expect(cell).toHaveTextContent('Reg Concert')
    expect(within(cell).queryByRole('link')).not.toBeInTheDocument()
  })

  // @story: SCRUM-27
  // @ac: 6
  it('links the event name to its request for an account with requests.view', async () => {
    signInWith(['registration.view', 'requests.view'])
    api.listOpenEvents.mockResolvedValue([event(4, 'register', { name: 'Reg Concert' })])

    renderPage()

    const cell = await screen.findByTestId('registration-event-4')
    expect(within(cell).getByRole('link', { name: 'Reg Concert' })).toHaveAttribute('href', '/requests/4')
  })

  // @story: SCRUM-54
  // @ac: 1, 2, 3
  it('the Action cell offers Register, or says Registered, Registration closed or Full', async () => {
    api.listOpenEvents.mockResolvedValue([
      event(1, 'register'),
      event(2, 'registered'),
      event(3, 'closed'),
      event(4, 'full'),
    ])

    renderPage()

    expect(await screen.findByTestId('registration-register-button-1')).toHaveTextContent('Register')
    expect(action(2)).toHaveTextContent('Registered')
    expect(action(3)).toHaveTextContent('Registration closed')
    expect(action(4)).toHaveTextContent('Full')
    for (const id of [2, 3, 4]) {
      expect(within(action(id)).queryByRole('button')).not.toBeInTheDocument()
    }
  })

  // @story: SCRUM-54
  // @ac: 1
  it('shows no Register button to an account without registration.register', async () => {
    signInWith(['registration.view'])
    api.listOpenEvents.mockResolvedValue([event(1, 'register')])

    renderPage()

    await screen.findByTestId('registration-row-1')
    expect(screen.queryByTestId('registration-register-button-1')).not.toBeInTheDocument()
    expect(action(1)).toBeEmptyDOMElement()
  })

  // @story: SCRUM-54
  // @ac: 1, 4
  it('confirms a registration with the event details and reads the list again', async () => {
    api.listOpenEvents
      .mockResolvedValueOnce([event(1, 'register', { name: 'Reg Concert' })])
      .mockResolvedValueOnce([event(1, 'registered', { name: 'Reg Concert' })])
    api.registerForEvent.mockResolvedValue(event(1, 'registered', { name: 'Reg Concert' }))

    renderPage()
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))

    expect(await screen.findByTestId('registration-banner')).toHaveTextContent(
      'Registered for Reg Concert: 10 Dec 2026, 19:00–21:00, Seminar Room 1.',
    )
    expect(screen.getByTestId('registration-banner')).toHaveAttribute('role', 'status')
    expect(api.registerForEvent).toHaveBeenCalledWith(1)
    expect(action(1)).toHaveTextContent('Registered')
    expect(screen.queryByTestId('registration-register-button-1')).not.toBeInTheDocument()
    expect(api.listOpenEvents).toHaveBeenCalledTimes(2)
  })

  // @story: SCRUM-54
  // @ac: 4
  it('names no venues in the confirmation when the event has none', async () => {
    api.listOpenEvents.mockResolvedValue([event(1, 'register', { name: 'Reg Concert', venues: '' })])
    api.registerForEvent.mockResolvedValue(event(1, 'registered', { name: 'Reg Concert', venues: '' }))

    renderPage()
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))

    expect(await screen.findByTestId('registration-banner')).toHaveTextContent(
      /^Registered for Reg Concert: 10 Dec 2026, 19:00–21:00\.$/,
    )
  })

  // @story: SCRUM-54
  // @ac: 2, 6
  it('shows a refusal in the banner and reads the list again', async () => {
    api.listOpenEvents
      .mockResolvedValueOnce([event(1, 'register')])
      .mockResolvedValueOnce([event(1, 'full')])
    api.registerForEvent.mockRejectedValue(Object.assign(new Error('This event is full.'), { status: 409 }))

    renderPage()
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))

    await waitFor(() => expect(action(1)).toHaveTextContent('Full'))
    expect(screen.getByTestId('registration-banner')).toHaveTextContent('This event is full.')
    expect(screen.getByTestId('registration-banner')).toHaveAttribute('role', 'alert')
  })

  // @story: SCRUM-54
  // @ac: 6
  it('shows a refused reload in the banner after registering', async () => {
    api.listOpenEvents
      .mockResolvedValueOnce([event(1, 'register')])
      .mockRejectedValueOnce(Object.assign(new Error('Not logged in'), { status: 401 }))
    api.registerForEvent.mockResolvedValue(event(1, 'registered'))

    renderPage()
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))

    await waitFor(() => expect(screen.getByTestId('registration-banner')).toHaveTextContent('Not logged in'))
    expect(screen.getByTestId('registration-register-button-1')).not.toBeDisabled()
  })

  // @story: SCRUM-54
  // @ac: 1
  it('disables Register while a registration is in flight', async () => {
    api.listOpenEvents.mockResolvedValue([event(1, 'register'), event(2, 'register')])
    const reply = deferred()
    api.registerForEvent.mockReturnValue(reply.promise)

    renderPage()
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))

    expect(screen.getByTestId('registration-register-button-2')).toBeDisabled()
    await act(async () => reply.resolve(event(1, 'registered')))
  })

  // @story: SCRUM-54
  // @ac: 1, 3
  it('a list reply that lands after Register does not put the Register button back', async () => {
    api.registerForEvent.mockResolvedValue(event(1, 'registered'))
    const replies = deferListReplies()

    renderStrictPage()
    await waitFor(() => expect(replies).toHaveLength(2))
    await act(async () => replies[1].resolve([event(1, 'register')]))
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))
    await waitFor(() => expect(replies).toHaveLength(3))
    await act(async () => replies[2].resolve([event(1, 'registered')]))
    await waitFor(() => expect(action(1)).toHaveTextContent('Registered'))

    await act(async () => replies[0].resolve([event(1, 'register')]))

    expect(action(1)).toHaveTextContent('Registered')
    expect(screen.queryByTestId('registration-register-button-1')).not.toBeInTheDocument()
  })

  // @story: SCRUM-54
  // @ac: 6
  it('a refused list reply that lands after Register does not show its message', async () => {
    api.registerForEvent.mockResolvedValue(event(1, 'registered', { name: 'Reg Concert' }))
    const replies = deferListReplies()

    renderStrictPage()
    await waitFor(() => expect(replies).toHaveLength(2))
    await act(async () => replies[1].resolve([event(1, 'register', { name: 'Reg Concert' })]))
    await userEvent.click(await screen.findByTestId('registration-register-button-1'))
    await waitFor(() => expect(replies).toHaveLength(3))
    await act(async () => replies[2].resolve([event(1, 'registered', { name: 'Reg Concert' })]))

    await act(async () => replies[0].reject(Object.assign(new Error('Not logged in'), { status: 401 })))

    expect(screen.getByTestId('registration-banner')).toHaveTextContent(
      'Registered for Reg Concert: 10 Dec 2026, 19:00–21:00, Seminar Room 1.',
    )
  })
})
