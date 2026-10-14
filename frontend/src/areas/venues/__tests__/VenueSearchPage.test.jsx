import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import * as api from '../api'
import VenueSearchPage from '../VenueSearchPage'

vi.mock('../api')

// The five recognised accessibility features, in the fixed list's order.
const FEATURES = ['Step-free access', 'Hearing loop', 'Accessible toilet', 'Lift access', 'Reserved seating']

// The recognised room layouts and facilities, in the fixed lists' order.
const LAYOUTS = ['Classroom', 'Theatre', 'Boardroom', 'Banquet', 'Exhibition']
const FACILITIES = ['Projector', 'Stage lighting', 'Sound system', 'Whiteboard', 'Catering kitchen', 'Wi-Fi']

// What the page sends the search for the event in the address (id 5): every filter empty
// unless the test names it.
const searchArgs = (filters = {}) => [
  '5',
  { location: '', accessibilityFeatures: [], layout: '', facilities: [], ...filters },
]

beforeEach(() => {
  api.getVenueOptions.mockResolvedValue({
    layouts: LAYOUTS,
    facilities: FACILITIES,
    accessibility_features: FEATURES,
  })
})

afterEach(() => {
  api.searchVenues.mockReset()
  api.getVenueOptions.mockReset()
})

const EVENT = {
  id: 5,
  name: 'Search Test A',
  date: '2026-12-15',
  start_time: '10:00',
  end_time: '12:00',
  attendance: 50,
}
const SEMINAR_ROOM_1 = { id: 1, name: 'Seminar Room 1', location: 'Block A Level 2', max_capacity: 60 }
const AUDITORIUM = { id: 2, name: 'Auditorium', location: 'Block C Level 1', max_capacity: 400 }

const found = (venues) => ({ event: EVENT, venues })
const refusal = (message, status = 400) => Object.assign(new Error(message), { status })

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/requests/5/venues/search']}>
      <Routes>
        <Route path="/requests/:id/venues/search" element={<VenueSearchPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Sets the field in one change rather than key by key (a slow machine times out
// typing), then presses Apply as a user does.
async function applyLocation(text) {
  fireEvent.change(screen.getByTestId('venue-search-location-input'), { target: { value: text } })
  await userEvent.click(screen.getByTestId('venue-search-apply-button'))
}

describe('VenueSearchPage', () => {
  // @story: SCRUM-33
  // @ac: 1
  it('shows only the title while the search is waiting for the API', () => {
    api.searchVenues.mockReturnValue(new Promise(() => {}))

    renderPage()

    expect(screen.getByTestId('venue-search-title')).toHaveTextContent('Search venues')
    expect(screen.queryByTestId('venue-search-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-apply-button')).not.toBeInTheDocument()
  })

  // @story: SCRUM-33
  // @ac: 1
  it('searches for the event in the address and shows the event values the search used', async () => {
    api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))

    renderPage()

    expect(await screen.findByTestId('venue-search-event-name')).toHaveTextContent('Search Test A')
    expect(screen.getByTestId('venue-search-period')).toHaveTextContent('15 Dec 2026, 10:00–12:00')
    expect(screen.getByTestId('venue-search-attendance')).toHaveTextContent('50')
    expect(api.searchVenues).toHaveBeenCalledWith(...searchArgs())
    expect(screen.getByTestId('venue-search-back-link')).toHaveAttribute('href', '/requests/5')
  })

  // @story: SCRUM-33
  // @ac: 7
  it('shows each venue with its name, location and maximum capacity, the name linking to the venue', async () => {
    api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))

    renderPage()

    expect(await screen.findByTestId('venue-search-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('venue-search-name-1')).toHaveTextContent('Seminar Room 1')
    expect(screen.getByTestId('venue-search-name-1')).toHaveAttribute('href', '/venues/1')
    expect(screen.getByTestId('venue-search-location-1')).toHaveTextContent('Block A Level 2')
    expect(screen.getByTestId('venue-search-capacity-1')).toHaveTextContent('60')
    expect(screen.getByTestId('venue-search-name-2')).toHaveTextContent('Auditorium')
    expect(screen.getByTestId('venue-search-location-2')).toHaveTextContent('Block C Level 1')
    expect(screen.getByTestId('venue-search-capacity-2')).toHaveTextContent('400')
    expect(screen.queryByTestId('venue-search-empty')).not.toBeInTheDocument()
  })

  // @story: SCRUM-33
  // @ac: 8
  it('shows one sentence and no table when no venue matches, and no error', async () => {
    api.searchVenues.mockResolvedValue(found([]))

    renderPage()

    expect(await screen.findByTestId('venue-search-empty')).toHaveTextContent('No venues match this search.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-33
  // @ac: 1
  it('shows the API refusal in the banner and nothing else when the event cannot be searched', async () => {
    api.searchVenues.mockRejectedValue(
      refusal('Venue search is available only for an Approved or Planning event.'),
    )

    renderPage()

    expect(await screen.findByTestId('venue-search-banner')).toHaveTextContent(
      'Venue search is available only for an Approved or Planning event.',
    )
    expect(screen.getByTestId('venue-search-banner')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('venue-search-apply-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-event-name')).not.toBeInTheDocument()
  })

  // @story: chore-ui-feedback
  // @ac: banner-dismiss
  it('clears the banner from its dismiss control', async () => {
    api.searchVenues.mockRejectedValue(
      refusal('Venue search is available only for an Approved or Planning event.'),
    )
    renderPage()
    await screen.findByTestId('venue-search-banner')

    await userEvent.click(screen.getByTestId('venue-search-banner-dismiss'))

    expect(screen.queryByTestId('venue-search-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-33
  // @ac: 6
  it('applies the typed location only when Apply is pressed', async () => {
    api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))
    renderPage()
    await screen.findByTestId('venue-search-row-2')

    fireEvent.change(screen.getByTestId('venue-search-location-input'), {
      target: { value: 'Block C Level 1' },
    })
    expect(api.searchVenues).toHaveBeenCalledTimes(1)

    api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
    await userEvent.click(screen.getByTestId('venue-search-apply-button'))

    await waitFor(() => {
      expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('venue-search-row-2')).toBeInTheDocument()
    expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs({ location: 'Block C Level 1' }))
  })

  // @story: SCRUM-33
  // @ac: 6
  it('applies no location restriction again once the location is emptied', async () => {
    api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
    renderPage()
    await screen.findByTestId('venue-search-row-2')
    await applyLocation('Block C Level 1')
    await waitFor(() => {
      expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs({ location: 'Block C Level 1' }))
    })

    api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))
    await applyLocation('')

    expect(await screen.findByTestId('venue-search-row-1')).toBeInTheDocument()
    expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs())
  })

  // @story: SCRUM-33
  // @ac: 1
  it('keeps the earlier results under the refusal when a later search fails, then clears it on success', async () => {
    api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))
    renderPage()
    await screen.findByTestId('venue-search-row-1')

    api.searchVenues.mockRejectedValue(refusal('Event request not found.', 404))
    await applyLocation('Block A Level 2')
    expect(await screen.findByTestId('venue-search-banner')).toHaveTextContent('Event request not found.')
    expect(screen.getByTestId('venue-search-row-1')).toBeInTheDocument()

    api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
    await applyLocation('Block C Level 1')
    expect(await screen.findByTestId('venue-search-row-2')).toBeInTheDocument()
    expect(screen.queryByTestId('venue-search-banner')).not.toBeInTheDocument()
  })

  // @story: SCRUM-33
  // @ac: 6
  it('keeps the results of the location applied last when an earlier search replies last', async () => {
    api.searchVenues.mockResolvedValueOnce(found([SEMINAR_ROOM_1, AUDITORIUM]))
    renderPage()
    await screen.findByTestId('venue-search-row-1')

    let resolveFirst
    api.searchVenues
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValueOnce(found([AUDITORIUM]))
    await applyLocation('Block A Level 2')
    await applyLocation('Block C Level 1')
    await waitFor(() => {
      expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument()
    })
    await act(async () => resolveFirst(found([SEMINAR_ROOM_1])))

    expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-search-row-2')).toBeInTheDocument()
  })

  // @story: SCRUM-33
  // @ac: 6
  it('ignores an earlier search that fails after a later one has succeeded', async () => {
    api.searchVenues.mockResolvedValueOnce(found([SEMINAR_ROOM_1, AUDITORIUM]))
    renderPage()
    await screen.findByTestId('venue-search-row-1')

    let rejectFirst
    api.searchVenues
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce(found([AUDITORIUM]))
    await applyLocation('Block A Level 2')
    await applyLocation('Block C Level 1')
    await waitFor(() => {
      expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument()
    })
    await act(async () => rejectFirst(refusal('Something went wrong', 500)))

    expect(screen.queryByTestId('venue-search-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('venue-search-row-2')).toBeInTheDocument()
  })

  describe('accessibility filter', () => {
    const featureBox = (name) =>
      screen.getByTestId(`venue-search-accessibility-features-${name.toLowerCase().replaceAll(' ', '-')}-input`)
    const tick = (name) => fireEvent.click(featureBox(name))
    const apply = () => userEvent.click(screen.getByTestId('venue-search-apply-button'))

    // @story: SCRUM-34
    // @ac: 1, 3
    it('offers exactly the recognised features, none ticked, and searches without any at first', async () => {
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))

      renderPage()
      await screen.findByTestId('venue-search-row-1')
      await screen.findByTestId('venue-search-accessibility-features-hearing-loop-input')

      const group = screen.getByRole('group', { name: 'Accessibility features' })
      const boxes = Array.from(group.querySelectorAll('input[type="checkbox"]'))
      expect(boxes.map((box) => box.parentElement.textContent)).toEqual(FEATURES)
      boxes.forEach((box) => expect(box).not.toBeChecked())
      expect(api.searchVenues).toHaveBeenCalledWith(...searchArgs())
    })

    // @story: SCRUM-34
    // @ac: 1, 2
    it('sends the ticked features only when Apply is pressed, and shows the narrowed results', async () => {
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))
      renderPage()
      await screen.findByTestId('venue-search-row-2')
      await screen.findByTestId('venue-search-accessibility-features-hearing-loop-input')

      tick('Hearing loop')
      expect(featureBox('Hearing loop')).toBeChecked()
      expect(api.searchVenues).toHaveBeenCalledTimes(1)

      api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
      await apply()

      await waitFor(() => {
        expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('venue-search-row-2')).toBeInTheDocument()
      expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs({ accessibilityFeatures: ['Hearing loop'] }))
    })

    // @story: SCRUM-34
    // @ac: 2
    it('sends every feature ticked, in the order ticked', async () => {
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))
      renderPage()
      await screen.findByTestId('venue-search-accessibility-features-lift-access-input')

      tick('Step-free access')
      tick('Lift access')
      await apply()

      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({ accessibilityFeatures: ['Step-free access', 'Lift access'] }),
        )
      })
    })

    // @story: SCRUM-34
    // @ac: 4
    it('sends the location and the ticked features together in one search', async () => {
      api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
      renderPage()
      await screen.findByTestId('venue-search-accessibility-features-step-free-access-input')

      tick('Step-free access')
      await applyLocation('Block C Level 1')

      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({ location: 'Block C Level 1', accessibilityFeatures: ['Step-free access'] }),
        )
      })
    })

    // @story: SCRUM-34
    // @ac: 5
    it('clears only the accessibility restriction when every feature is unticked, keeping the location', async () => {
      api.searchVenues.mockResolvedValue(found([]))
      renderPage()
      await screen.findByTestId('venue-search-accessibility-features-hearing-loop-input')
      tick('Hearing loop')
      await applyLocation('Block A Level 2')
      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({ location: 'Block A Level 2', accessibilityFeatures: ['Hearing loop'] }),
        )
      })

      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))
      tick('Hearing loop')
      expect(featureBox('Hearing loop')).not.toBeChecked()
      await apply()

      expect(await screen.findByTestId('venue-search-row-1')).toBeInTheDocument()
      expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs({ location: 'Block A Level 2' }))
      expect(screen.getByTestId('venue-search-location-input')).toHaveValue('Block A Level 2')
    })

    // @story: SCRUM-34
    // @ac: 1
    it('shows the API refusal in the banner when the recognised features cannot be loaded', async () => {
      api.getVenueOptions.mockRejectedValue(refusal('You do not have permission to perform this action.', 403))
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))

      renderPage()

      expect(await screen.findByTestId('venue-search-banner')).toHaveTextContent(
        'You do not have permission to perform this action.',
      )
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    // @story: SCRUM-34
    // @ac: 1
    it('shows the API refusal for an unrecognised feature in the banner and keeps the earlier results', async () => {
      api.searchVenues.mockResolvedValueOnce(found([SEMINAR_ROOM_1, AUDITORIUM]))
      renderPage()
      await screen.findByTestId('venue-search-accessibility-features-hearing-loop-input')
      await screen.findByTestId('venue-search-row-1')

      api.searchVenues.mockRejectedValue(refusal('Choose each accessibility feature from the list.'))
      tick('Hearing loop')
      await apply()

      expect(await screen.findByTestId('venue-search-banner')).toHaveTextContent(
        'Choose each accessibility feature from the list.',
      )
      expect(screen.getByTestId('venue-search-row-1')).toBeInTheDocument()
    })
  })
  describe('layout and facilities filters', () => {
    const layoutSelect = () => screen.getByTestId('venue-search-layout-input')
    const facilityBox = (name) =>
      screen.getByTestId(`venue-search-facilities-${name.toLowerCase().replaceAll(' ', '-')}-input`)
    const chooseLayout = (name) => fireEvent.change(layoutSelect(), { target: { value: name } })
    const tickFacility = (name) => fireEvent.click(facilityBox(name))
    const apply = () => userEvent.click(screen.getByTestId('venue-search-apply-button'))
    const ready = () => screen.findByTestId('venue-search-facilities-wi-fi-input')

    // @story: SCRUM-35
    // @ac: 1, 2, 3
    it('offers None then every recognised layout, and every recognised facility, none chosen', async () => {
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))

      renderPage()
      await ready()

      expect(Array.from(layoutSelect().options).map((option) => option.textContent)).toEqual([
        'None',
        ...LAYOUTS,
      ])
      expect(layoutSelect()).toHaveValue('')
      const facilityGroup = screen.getByRole('group', { name: 'Facilities' })
      const boxes = Array.from(facilityGroup.querySelectorAll('input[type="checkbox"]'))
      expect(boxes.map((box) => box.parentElement.textContent)).toEqual(FACILITIES)
      boxes.forEach((box) => expect(box).not.toBeChecked())
      expect(api.searchVenues).toHaveBeenCalledWith(...searchArgs())
    })

    // @story: SCRUM-35
    // @ac: 1
    it('sends the chosen layout only when Apply is pressed, and shows the narrowed results', async () => {
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1, AUDITORIUM]))
      renderPage()
      await ready()

      chooseLayout('Classroom')
      expect(layoutSelect()).toHaveValue('Classroom')
      expect(api.searchVenues).toHaveBeenCalledTimes(1)

      api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
      await apply()

      await waitFor(() => {
        expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('venue-search-row-2')).toBeInTheDocument()
      expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs({ layout: 'Classroom' }))
    })

    // @story: SCRUM-35
    // @ac: 2
    it('sends every facility ticked, in the order ticked', async () => {
      api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
      renderPage()
      await ready()

      tickFacility('Stage lighting')
      tickFacility('Projector')
      expect(facilityBox('Projector')).toBeChecked()
      await apply()

      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({ facilities: ['Stage lighting', 'Projector'] }),
        )
      })
    })

    // @story: SCRUM-35
    // @ac: 1, 2, 4
    it('sends the layout, the facilities, the accessibility features and the location in one search', async () => {
      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))
      renderPage()
      await ready()

      chooseLayout('Classroom')
      tickFacility('Wi-Fi')
      fireEvent.click(screen.getByTestId('venue-search-accessibility-features-step-free-access-input'))
      fireEvent.change(screen.getByTestId('venue-search-location-input'), {
        target: { value: 'Block D Level 1' },
      })
      await apply()

      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({
            location: 'Block D Level 1',
            layout: 'Classroom',
            facilities: ['Wi-Fi'],
            accessibilityFeatures: ['Step-free access'],
          }),
        )
      })
    })

    // @story: SCRUM-35
    // @ac: 5
    it('clears only the layout when it is set back to None, keeping the facilities and the location', async () => {
      api.searchVenues.mockResolvedValue(found([]))
      renderPage()
      await ready()
      chooseLayout('Classroom')
      tickFacility('Wi-Fi')
      fireEvent.change(screen.getByTestId('venue-search-location-input'), {
        target: { value: 'Block D Level 1' },
      })
      await apply()
      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({ location: 'Block D Level 1', layout: 'Classroom', facilities: ['Wi-Fi'] }),
        )
      })

      api.searchVenues.mockResolvedValue(found([SEMINAR_ROOM_1]))
      chooseLayout('')
      await apply()

      expect(await screen.findByTestId('venue-search-row-1')).toBeInTheDocument()
      expect(api.searchVenues).toHaveBeenLastCalledWith(
        ...searchArgs({ location: 'Block D Level 1', facilities: ['Wi-Fi'] }),
      )
      expect(facilityBox('Wi-Fi')).toBeChecked()
      expect(screen.getByTestId('venue-search-location-input')).toHaveValue('Block D Level 1')
    })

    // @story: SCRUM-35
    // @ac: 5
    it('clears only the facilities when every one is unticked, keeping the layout', async () => {
      api.searchVenues.mockResolvedValue(found([]))
      renderPage()
      await ready()
      chooseLayout('Classroom')
      tickFacility('Wi-Fi')
      await apply()
      await waitFor(() => {
        expect(api.searchVenues).toHaveBeenLastCalledWith(
          ...searchArgs({ layout: 'Classroom', facilities: ['Wi-Fi'] }),
        )
      })

      api.searchVenues.mockResolvedValue(found([AUDITORIUM]))
      tickFacility('Wi-Fi')
      expect(facilityBox('Wi-Fi')).not.toBeChecked()
      await apply()

      expect(await screen.findByTestId('venue-search-row-2')).toBeInTheDocument()
      expect(api.searchVenues).toHaveBeenLastCalledWith(...searchArgs({ layout: 'Classroom' }))
      expect(layoutSelect()).toHaveValue('Classroom')
    })

    // @story: SCRUM-35
    // @ac: 1, 2
    it('shows the API refusal for an unrecognised layout in the banner and keeps the earlier results', async () => {
      api.searchVenues.mockResolvedValueOnce(found([SEMINAR_ROOM_1, AUDITORIUM]))
      renderPage()
      await ready()
      await screen.findByTestId('venue-search-row-1')

      api.searchVenues.mockRejectedValue(refusal('Choose the layout from the list.'))
      chooseLayout('Classroom')
      await apply()

      expect(await screen.findByTestId('venue-search-banner')).toHaveTextContent(
        'Choose the layout from the list.',
      )
      expect(screen.getByTestId('venue-search-row-1')).toBeInTheDocument()
    })
  })
})

describe('VenueSearchPage feedback at the point of action', () => {
  // @story: chore-ui-feedback
  // @ac: point-of-action
  it('brings the results an Apply returns into view, keeping focus on Apply, but not the first search', async () => {
    Element.prototype.scrollIntoView.mockClear()
    api.searchVenues.mockResolvedValueOnce(found([SEMINAR_ROOM_1, AUDITORIUM]))
    renderPage()
    await screen.findByTestId('venue-search-row-1')
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    api.searchVenues.mockResolvedValueOnce(found([AUDITORIUM]))
    await applyLocation('Block C Level 1')

    await waitFor(() => expect(screen.queryByTestId('venue-search-row-1')).not.toBeInTheDocument())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(Element.prototype.scrollIntoView.mock.contexts[0]).toContainElement(screen.getByTestId('venue-search-row-2'))
    expect(screen.getByTestId('venue-search-apply-button')).toHaveFocus()
  })
})
