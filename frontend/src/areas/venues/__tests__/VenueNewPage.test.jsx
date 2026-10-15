import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import * as api from '../api'
import VenueNewPage from '../VenueNewPage'

vi.mock('../api')

const navigate = vi.fn()
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const OPTIONS = {
  facilities: ['Projector', 'Stage lighting'],
  accessibility_features: ['Step-free access', 'Hearing loop'],
}

afterEach(() => {
  navigate.mockReset()
  vi.restoreAllMocks()
})

async function renderForm(options = OPTIONS) {
  api.getVenueOptions.mockResolvedValue(options)
  render(
    <MemoryRouter>
      <VenueNewPage />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(screen.getByTestId('venue-new-name-input')).toBeInTheDocument()
  })
}

describe('VenueNewPage', () => {
  // @story: SCRUM-31
  // @ac: 1
  it('offers one checkbox per option in each fixed list', async () => {
    await renderForm()

    expect(screen.getByTestId('venue-new-facilities-projector-input')).toBeInTheDocument()
    expect(screen.getByTestId('venue-new-facilities-stage-lighting-input')).toBeInTheDocument()
    expect(
      screen.getByTestId('venue-new-accessibility-features-step-free-access-input'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('venue-new-opening-time-input')).toBeInTheDocument()
    expect(screen.getByTestId('venue-new-closing-time-input')).toBeInTheDocument()
  })

  // @story: SCRUM-31
  // @ac: 1
  it('sends only the facilities left ticked', async () => {
    await renderForm()
    api.createVenue.mockResolvedValue({ id: 7 })

    await userEvent.type(screen.getByTestId('venue-new-name-input'), 'Hall A')
    await userEvent.type(screen.getByTestId('venue-new-location-input'), 'Block B Level 3')
    await userEvent.type(screen.getByTestId('venue-new-max-capacity-input'), '250')
    // Ticked, then unticked again: the venue is saved without it.
    await userEvent.click(screen.getByTestId('venue-new-facilities-stage-lighting-input'))
    await userEvent.click(screen.getByTestId('venue-new-facilities-stage-lighting-input'))
    await userEvent.click(screen.getByTestId('venue-new-facilities-projector-input'))
    await userEvent.click(screen.getByTestId('venue-new-save-button'))

    await waitFor(() => {
      expect(api.createVenue).toHaveBeenCalledWith(
        expect.objectContaining({ facilities: ['Projector'], accessibility_features: [] }),
      )
    })
    expect(navigate).toHaveBeenCalledWith('/venues/7', { state: { banner: 'Venue added' } })
  })

  // @story: SCRUM-31
  // @ac: 1
  it('sends the operating hours and the accessibility features ticked', async () => {
    await renderForm()
    api.createVenue.mockResolvedValue({ id: 8 })

    await userEvent.type(screen.getByTestId('venue-new-name-input'), 'Hall B')
    await userEvent.type(screen.getByTestId('venue-new-location-input'), 'Block E Level 1')
    await userEvent.type(screen.getByTestId('venue-new-max-capacity-input'), '80')
    await userEvent.type(screen.getByTestId('venue-new-opening-time-input'), '08:00')
    await userEvent.type(screen.getByTestId('venue-new-closing-time-input'), '22:00')
    await userEvent.click(
      screen.getByTestId('venue-new-accessibility-features-hearing-loop-input'),
    )
    await userEvent.click(screen.getByTestId('venue-new-save-button'))

    await waitFor(() => {
      expect(api.createVenue).toHaveBeenCalledWith({
        name: 'Hall B',
        location: 'Block E Level 1',
        max_capacity: '80',
        opening_time: '08:00',
        closing_time: '22:00',
        facilities: [],
        accessibility_features: ['Hearing loop'],
      })
    })
  })

  // @story: SCRUM-31
  // @ac: 2
  it('shows a message under every empty required field and sends nothing', async () => {
    await renderForm()

    await userEvent.click(screen.getByTestId('venue-new-save-button'))

    expect(screen.getByTestId('venue-new-name-error')).toBeInTheDocument()
    expect(screen.getByTestId('venue-new-location-error')).toBeInTheDocument()
    expect(screen.getByTestId('venue-new-max-capacity-error')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-new-banner')).not.toBeInTheDocument()
    expect(api.createVenue).not.toHaveBeenCalled()
  })

  // @story: SCRUM-31
  // @ac: 3
  it('shows the API refusal in the banner, never under the field', async () => {
    await renderForm()
    api.createVenue.mockRejectedValue(
      Object.assign(new Error('Maximum capacity must be a positive whole number.'), { status: 400 }),
    )

    await userEvent.type(screen.getByTestId('venue-new-name-input'), 'Room C')
    await userEvent.type(screen.getByTestId('venue-new-location-input'), 'Block D Level 2')
    await userEvent.type(screen.getByTestId('venue-new-max-capacity-input'), '0')
    await userEvent.click(screen.getByTestId('venue-new-save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('venue-new-banner')).toHaveTextContent(/positive whole number/i)
    })
    expect(screen.getByTestId('venue-new-banner')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('venue-new-max-capacity-error')).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    await renderForm()
    api.createVenue.mockRejectedValue(
      Object.assign(new Error('Maximum capacity must be a positive whole number.'), { status: 400 }),
    )
    await userEvent.type(screen.getByTestId('venue-new-name-input'), 'Room C')
    await userEvent.type(screen.getByTestId('venue-new-location-input'), 'Block D Level 2')
    await userEvent.type(screen.getByTestId('venue-new-max-capacity-input'), '0')
    await userEvent.click(screen.getByTestId('venue-new-save-button'))
    await screen.findByTestId('venue-new-banner')

    await userEvent.click(screen.getByTestId('venue-new-banner-dismiss'))

    expect(screen.queryByTestId('venue-new-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-31
  // @ac: 1
  it('shows a refusal of the fixed lists in the banner and no form', async () => {
    api.getVenueOptions.mockRejectedValue(
      Object.assign(new Error('You do not have permission to perform this action.'), { status: 403 }),
    )

    render(
      <MemoryRouter>
        <VenueNewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('venue-new-banner')).toHaveTextContent(/permission/i)
    })
    expect(screen.queryByTestId('venue-new-name-input')).not.toBeInTheDocument()
  })
})

describe('VenueNewPage feedback at the point of action', () => {
  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('focuses the first field named by a refused save', async () => {
    await renderForm()
    await userEvent.type(screen.getByTestId('venue-new-name-input'), 'Room C')

    await userEvent.click(screen.getByTestId('venue-new-save-button'))

    expect(screen.getByTestId('venue-new-location-input')).toHaveFocus()
    expect(Element.prototype.scrollIntoView.mock.contexts.at(-1)).toContainElement(
      screen.getByTestId('venue-new-location-error'),
    )
  })
})
