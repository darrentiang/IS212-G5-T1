# UI guidelines

What every page shows, how it behaves for the user and the `data-testid` of every element. Test-case rows describe what the user sees on these pages; Playwright tests find elements by the ids defined here, so an id must be predictable from this file alone. How the front end is built lives in `frontend.md`; who may do what in `permissions.md`; status names in `state-model.md`; `/api/me` and refusals in `docs/adr/ADR-002-authorisation.md`. Changing a rule or a test id pattern means changing this file first, in the same pull request.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 16-09-2026 | Initial guidelines | Functional tests for SCRUM-26/27 need stable test ids before the scaffold is built |
| 1.1 | 16-09-2026 | Landing page by permission; page anatomy; loading; inline action forms, no modals; dates, times and status constants; notifications count | The first pages are about to be built by four Developers; these are the choices that would otherwise be made four ways |
| 1.2 | 22-09-2026 | `/venues/new` and `/venues/:id` in §1; a checkbox group for several choices from a fixed list in §5 | SCRUM-31 adds the two pages, and picks facilities and accessibility features from seeded lists rather than free text |
| 1.3 | 24-09-2026 | §12 Look: the visual style and the status-to-colour table; §1 a welcome home page for an account that may open no page | UI refresh: one shared look in `visual-style.md`; Technical Support Staff have no page yet and were landing on the not-permitted page |
| 1.4 | 25-09-2026 | A moment in time (`03 Oct 2026, 14:30`) in §9, formatted with `formatDateTime` | SCRUM-29 shows when a request was submitted and decided; the API sends those as ISO date-times in UTC |
| 1.5 | 06-10-2026 | §7 a list of related records on a detail page, and the venue page's Blocks section and inline block form test ids; §9 a period across two dates (`20 Oct 2026, 09:00 to 21 Oct 2026, 18:00`), formatted with `formatDateTimePeriod` | SCRUM-40 lists a venue's blocks on its page and lets Venue Staff block it for a period that may span days |
| 1.6 | 06-10-2026 | §7 inline update form on venue detail page, and update test ids | SCRUM-75 lets Venue Staff update recorded venue fields via an inline form |
| 1.7 | 06-10-2026 | §7 the venue page's per-block Remove and End early buttons and the inline end-block form's test ids; one inline form open at a time across Update venue, Block venue and End early | SCRUM-79 lets Venue Staff remove a block that has not started or end one in progress early |
| 1.8 | 07-10-2026 | §7 venue supported-layout display and selection test ids | SCRUM-32 records the layouts a venue supports |
| 1.8 | 07-10-2026 | §1 `/requests/:id/bookings/new`; §7 the request page's Request venue booking button and the venue page's Booking requests section; §12 Requested and Withdrawn added to the status-colour table | SCRUM-36 lets an Event Coordinator raise a venue booking request from an event, and lists the venue's booking requests on its page the same way as Blocks |
| 1.9 | 08-10-2026 | §1 `/requests/:id/venues/search`; §7 the request page's Search venues button and the venue-search page | SCRUM-33 lets an Event Coordinator find venues that are free on an event's dates and large enough for its attendance |
| 1.10 | 08-10-2026 | §7 the venue-search page's accessibility feature checkboxes, with the one shared Apply | SCRUM-34 narrows the SCRUM-33 search by accessibility features |
| 1.10 | 08-10-2026 | §5 an optional single choice is a select whose first option is None; §7 the request's required layout, facilities and accessibility features on the new-request page, the request page and the Draft edit form, grouped under the headings Venue requirements and Accessibility needs in place of the free-text fields of those names (`request-new-venue-requirements-input`, `request-new-accessibility-needs-input`, their `request-detail-edit-…` inputs and `request-detail-venue-requirements`, `request-detail-accessibility-needs` are removed); the booking-new page's venue-suitability warnings | SCRUM-42 lets an Event Organiser choose an event's requirements from the venue lists, and warns an Event Coordinator when a chosen venue does not match them; the PO decided the choices replace the brief's free-text venue requirements and accessibility needs, which are what the Venue Catalogue records as layouts and facilities, and as accessibility features |
| 1.11 | 08-10-2026 | §7 the venue page's setup-time and turnaround-time display and the inline Edit times form test ids; one inline form open at a time across Update venue, Edit times, Block venue and End early | SCRUM-80 lets Venue Staff record how long a venue needs before and after an event |
| 1.12 | 08-10-2026 | §7 the venue page's Booking requests section gains attendance, the event's layout and facilities (its venue requirements, SCRUM-42) and a decision cell, plus per-row Approve/Reject and an inline decide form. The decision cell is blank while the booking is Requested, then reads `<Decision> by <username> (<moment>)`, followed by `: <reason>` when a reason was given (e.g. `Rejected by venue1 (08 Oct 2026, 09:15): Already committed that week`); the moment is formatted with `formatDateTime`, in UTC (§9) | SCRUM-37 lets Venue Staff decide a booking request from the venue's own page |
| 1.13 | 08-10-2026 | §7 a per-row action's confirm/reason form opens as its own row directly below the one it acts on, not below the whole table; End block early and Deciding a booking request updated to match | A form that opened at the bottom of a long list was mistaken for not working; this is now the rule for every per-row action, not just these two |
| 1.14 | 09-10-2026 | §7 the venue-search page's Room layout select and Facilities checkboxes, with the same one Apply | SCRUM-35 narrows the SCRUM-33 search by room layout and facilities |
| 1.15 | 09-10-2026 | §7 the request page's Assigned coordinator and Assigned on date, with their test ids | SCRUM-43: approving a request now assigns an Event Coordinator, and the Organiser and every Coordinator can see who |
| 1.16 | 09-10-2026 | §7: an Event Organiser's own Rejected request shows its form already open, with a Resubmit button and no Cancel | SCRUM-72: the form's only purpose is to resubmit, so there is no action button to open it and nothing to cancel |

## 1. Pages

| Route | Page name (test id prefix) | Who reaches it |
|---|---|---|
| `/login` | `login` | Anyone not logged in |
| `/requests` | `requests` | Logged in; the API returns only what the account may see |
| `/requests/new` | `request-new` | Feature per `permissions.md` |
| `/requests/:id` | `request-detail` | Feature and object rule per `permissions.md` |
| `/venues` | `venues` | Feature per `permissions.md` |
| `/venues/new` | `venue-new` | Feature per `permissions.md` |
| `/venues/:id` | `venue-detail` | Feature per `permissions.md` |
| `/requests/:id/bookings/new` | `booking-new` | Feature per `permissions.md` |
| `/requests/:id/venues/search` | `venue-search` | Feature per `permissions.md` |
| — (shown in place of a refused page) | `not-permitted` | Anyone whose account lacks the page's feature |

- Not logged in → any page sends the user to `/login`.
- **Home** is the first nav entry, in nav order, that the account may open. After logging in, `/`, unknown addresses and the not-permitted page's link all go home (pages send the user to `/`; the app resolves it). Venue Staff therefore land on Venues, an Attendee on Registration, never on a page they cannot open.
- An account without a page's feature sees the not-permitted page at the same address; it is not redirected.
- An account that may open **no** page (Technical Support Staff today) gets a welcome home page at `/`, inside the layout: "Welcome, <username>" and one sentence saying there is nothing to do for their role yet. Test ids: `home-title`, `home-message`.

## 2. Layout

Every page except `/login` sits inside the same layout.

- **Header:** username, every role the account holds (comma-separated, in the order `/api/me` returns them), a Log out button.
- **Nav:** one link per page the account may open, always visible, in the same order for everyone. A link that would lead to the not-permitted page is not shown. The Notifications link may carry the unread count in brackets, e.g. `Notifications (3)`, test id `layout-nav-notifications-count`; the notifications story adds it.
- **Main:** the page, laid out as in §3.

| Element | `data-testid` |
|---|---|
| Username | `layout-username` |
| Roles | `layout-roles` |
| Log out button | `layout-logout-button` |
| Nav link | `layout-nav-<page>` (e.g. `layout-nav-requests`) |

## 3. Page anatomy

Every page inside the layout has the same order, top to bottom:

1. **Back link**, only on detail and form pages: "Back to <list>", to the list the user came from.
2. **Title row**: the page title as `h1`; on a list page, the page-level action button (e.g. New request) at the right of the same row.
3. **Banner** (§4), when there is one.
4. **Content**: a table (§6), a form (§5) or label/value pairs (§7).

While the page is waiting for the API it renders the title row and nothing below it: never the empty message, never a stale table. A page shows its content only once it has it.

| Element | `data-testid` | Example |
|---|---|---|
| Back link | `<page>-back-link` | `request-detail-back-link` |
| Title | `<page>-title` | `requests-title` |
| Page-level action | `<page>-<action>-button` | `requests-new-button` |

## 4. Banners

- One banner at a time, at the top of the page content.
- Error: `role="alert"`. Success: `role="status"`. The text states what happened ("Request submitted", or the API's refusal message word for word). The page never replaces a refusal with its own wording.
- A refusal (the API says no) always shows in the banner, even when the page hid the control that led to it.
- A banner stays until the user's next action or navigation. No auto-dismiss, so tests never race a timer.
- After an action that moves the user to another page (e.g. submitting a new request opens its detail page), the success banner shows on the page they land on.
- A session that has ended sends the user to `/login`.
- Test id: `<page>-banner`. Tests tell success from error by `role`.

## 5. Forms

- Label above its field.
- Required fields: label ends with ` *`, the input has `aria-required="true"`. No native `required` attribute (browser pop-ups bypass our messages and cannot be asserted consistently).
- On submit the page checks required fields are filled and shows a message under each empty one, sending nothing. Every other rule is the API's, and an API refusal always shows in the banner, never under a field. Because the banner is not beside the field, the API's refusal message names the field it is about ("Attendance must be a positive whole number.", "Date cannot be earlier than today.").
- Input types: `date`, `time`, `number` where the value is one; a select for fixed choices; a textarea for long text.
- **An optional single choice from a fixed list** is a select whose first option is `None` (value empty); choosing None sends `null`.
- **Several choices from a fixed list** are a group of checkboxes, one per option, inside a `fieldset` whose `legend` is the field's label. One checkbox's test id is `<page>-<field>-<value>-input`, the option's own text in kebab-case (`venue-new-facilities-stage-lighting-input`). A select with `multiple` is not used: one checkbox per option is what a test can tick and read back.
- Buttons at the bottom right. One primary button (the action that completes the story), secondary buttons to its left (e.g. Save draft left of Submit).
- All buttons disabled while the request is being sent.

| Element | `data-testid` | Example |
|---|---|---|
| Input / select / textarea | `<page>-<field>-input` | `request-new-attendance-input` |
| Message under a field | `<page>-<field>-error` | `request-new-attendance-error` |
| Button | `<page>-<action>-button` | `request-new-submit-button` |

`<field>` is the API field name in kebab-case.

## 6. Lists

- A plain table with a header row, one row per record.
- The first cell links to the record's detail page.
- Status shown as the exact status text from `state-model.md` (e.g. Submitted, Planning). Colour may accompany the text, never replace it.
- A flag is not a status: "Clarification requested" shows as its own text beside the status, never appended to it.
- No records → one sentence saying so instead of the table.
- On narrow screens the table scrolls sideways; no column is hidden.

| Element | `data-testid` | Example |
|---|---|---|
| Row | `<page>-row-<id>` | `requests-row-12` |
| Status cell | `<page>-status-<id>` | `requests-status-12` |
| Flag beside a status | `<page>-<flag>-flag-<id>` | `requests-clarification-flag-12` |
| Empty message | `<page>-empty` | `requests-empty` |

## 7. Detail pages

- Fields as label/value pairs, in the order the form uses.
- Status as text; a flag as its own text beside it.
- Actions (approve, reject, …) are buttons per §5, in one row under the fields, shown only when the account's features allow them.
- **Assigned coordinator (SCRUM-43).** Approving a request makes the system assign one Event Coordinator and moves it to Planning, so the request page shows an Assigned coordinator (their username) and an Assigned on date, below the decision, to everyone who can open the request. The page offers no way to decline or change the assignment; reassignment is SCRUM-44.
- **An action that needs a reason or a confirmation opens an inline form** below the action row, on the same page: its fields per §5, a Confirm button (labelled with the action, e.g. Reject) and a Cancel button that closes it. No modal, no overlay, no browser `confirm()`. Only one inline form is open at a time; opening another closes the first. Its test ids use the action as `<field>`: `request-detail-reject-reason-input`, `request-detail-reject-confirm-button`, `request-detail-reject-cancel-button`.
- **Revise and resubmit (SCRUM-72).** On a Rejected request the Event Organiser who created it sees the request's fields in a form already open below the details (the decision and its reason stay above it), prefilled and laid out as the Draft edit form is, with one primary Resubmit button and no Cancel. The same required-field check as submitting runs first: a message under each empty required field, nothing sent. Test ids use `resubmit` as the action: `request-detail-resubmit-<field>-input`, `request-detail-resubmit-<field>-error`, a choice's checkbox `request-detail-resubmit-<list>-<option>-input` as in §5, and `request-detail-resubmit-button`. Once the request is Submitted the form is gone. Anyone else sees the details only.

| Element | `data-testid` | Example |
|---|---|---|
| Field value | `<page>-<field>` | `request-detail-attendance` |
| Status | `<page>-status` | `request-detail-status` |
| Flag | `<page>-<flag>-flag` | `request-detail-clarification-flag` |
| Assigned coordinator (SCRUM-43; shown once assigned) | `<page>-assigned-coordinator` | `request-detail-assigned-coordinator` |
| Assignment date (SCRUM-43; shown with the coordinator, `03 Oct 2026`) | `<page>-assigned-at` | `request-detail-assigned-at` |

**A list of related records on a detail page** (a venue's blocks) is a section under the fields with an `h2` and a table per §6. Its ids carry the record's name in place of the page's own list ids, so they cannot clash with the page's fields: `<page>-<record>-row-<id>`, one cell `<page>-<record>-<field>-<id>`, and `<page>-<records>-empty` when there are none. A per-row action's confirm/reason form opens as its own row directly below the one it acts on (a `<td colspan>` spanning the table), never below the whole table: in a long list, a form that opens far from its row is a form the user cannot find.

The venue page (`venue-detail`), SCRUM-40, SCRUM-75:

| Element | `data-testid` |
|---|---|
| Block row | `venue-detail-block-row-<id>` |
| Block period | `venue-detail-block-period-<id>` |
| Block reason | `venue-detail-block-reason-<id>` |
| No blocks | `venue-detail-blocks-empty` |
| Block venue button (only with `venues.edit`) | `venue-detail-block-button` |
| Inline form inputs | `venue-detail-block-start-date-input`, `venue-detail-block-start-time-input`, `venue-detail-block-end-date-input`, `venue-detail-block-end-time-input`, `venue-detail-block-reason-input` |
| Message under an empty field | `venue-detail-block-<field>-error` (e.g. `venue-detail-block-reason-error`) |
| Block (confirm) and Cancel buttons | `venue-detail-block-confirm-button`, `venue-detail-block-cancel-button` |
| Update venue button (only with `venues.edit`) | `venue-detail-update-button` |
| Inline update form inputs | `venue-detail-update-name-input`, `venue-detail-update-location-input`, `venue-detail-update-max-capacity-input`, `venue-detail-update-opening-time-input`, `venue-detail-update-closing-time-input`, `venue-detail-update-facilities-<kebab-option>-input`, `venue-detail-update-accessibility-features-<kebab-option>-input` |
| Message under an empty field | `venue-detail-update-<field>-error` (e.g. `venue-detail-update-name-error`) |
| Save and Cancel update buttons | `venue-detail-update-save-button`, `venue-detail-update-cancel-button` |

SCRUM-32 adds the venue's supported layouts. An empty list is shown as `None`, and the selection form is available only with `venues.edit`; it is another inline form, so it follows the one-form-at-a-time rule above.

| Element | `data-testid` |
|---|---|
| Supported layouts value | `venue-detail-layouts-value` |
| Select layouts button (only with `venues.edit`) | `venue-detail-layouts-button` |
| Layout checkbox | `venue-detail-layouts-<kebab-option>-input` |
| Save and Cancel layout buttons | `venue-detail-layouts-save-button`, `venue-detail-layouts-cancel-button` |

SCRUM-79 adds an action cell to each block row, only with `venues.edit`. Which action a block offers follows its `phase` from the API (not a status, so no badge): a block that has not started offers Remove, which acts at once; a block in progress offers End early, which opens an inline end-block form (new end date and time, End and Cancel) as its own row directly below the block's, inside the table (`<td colspan>` spanning every column) rather than below the whole table: a form that opens far from the row a long list scrolled past it is a form the user cannot find (SCRUM-37 review, 08-10-2026). A block that has ended offers neither. The update form, the times form, the block form and the end-block form are all inline forms, so only one of them is open at a time: opening any one closes the others.

| Element | `data-testid` |
|---|---|
| Remove button (upcoming block, only with `venues.edit`) | `venue-detail-block-remove-button-<id>` |
| End early button (block in progress, only with `venues.edit`) | `venue-detail-block-end-button-<id>` |
| End-block form inputs | `venue-detail-end-block-end-date-input`, `venue-detail-end-block-end-time-input` |
| Message under an empty field | `venue-detail-end-block-<field>-error` (e.g. `venue-detail-end-block-end-time-error`) |
| End (confirm) and Cancel buttons | `venue-detail-end-block-confirm-button`, `venue-detail-end-block-cancel-button` |

SCRUM-80 records two durations in whole minutes for the venue — setup time, the minutes needed before an event, and turnaround time, the minutes needed after it. They are never clock times. Both are shown on the venue page to anyone who may view it, as `0 minutes` when they have never been recorded and `1 minute` for a single minute. Only an account with `venues.edit` is offered **Edit times**, which opens an inline form: the two minute fields, the hint `Leave blank for 0 minutes.` (a field left blank when saving is recorded as zero), and Save and Cancel. It is an inline form, so it obeys the one-form-at-a-time rule with Update venue, Block venue and End early. A refusal from the API appears in the banner and names the field that was invalid; the form stays open with what was typed, and neither stored time changes.

| Element | `data-testid` |
|---|---|
| Setup time value | `venue-detail-setup-time` |
| Turnaround time value | `venue-detail-turnaround-time` |
| Edit times button (only with `venues.edit`) | `venue-detail-times-button` |
| Inline times form inputs | `venue-detail-times-setup-time-input`, `venue-detail-times-turnaround-time-input` |
| Blank-is-zero hint | `venue-detail-times-hint` |
| Save and Cancel times buttons | `venue-detail-times-save-button`, `venue-detail-times-cancel-button` |

**Booking requests** (SCRUM-36) is a second related-records section on the venue page, below Blocks: raising one happens from the event's own page (below), not here. Status as the exact state-model.md word, as a badge (§12). SCRUM-37 adds the event's expected attendance and its venue requirements, which are the event's chosen layout and facilities (SCRUM-42), each shown `None` when nothing was chosen, as the venue page shows an empty list, so Venue Staff can decide without leaving the page (AC1), the decision once made (AC5, AC9; blank while Requested, then `<Decision> by <username> (<moment>)` and `: <reason>` when one was given, the moment per §9), and a Venue Staff-only action cell per row, the same action-cell pattern as Blocks (§7 above): a Requested row offers Approve and Reject, any other status offers neither.

| Element | `data-testid` |
|---|---|
| Booking row | `venue-detail-booking-row-<id>` |
| Booking status | `venue-detail-booking-status-<id>` |
| Booking period | `venue-detail-booking-period-<id>` |
| Booking event name | `venue-detail-booking-event-<id>` |
| Booking attendance | `venue-detail-booking-attendance-<id>` |
| Booking layout (`None` when none chosen) | `venue-detail-booking-layout-<id>` |
| Booking facilities (comma-separated, `None` when none chosen) | `venue-detail-booking-facilities-<id>` |
| Booking decision (blank until decided) | `venue-detail-booking-decision-<id>` |
| No booking requests | `venue-detail-bookings-empty` |
| Approve button (Requested row, only with `bookings.decide`) | `venue-detail-booking-approve-button-<id>` |
| Reject button (Requested row, only with `bookings.decide`) | `venue-detail-booking-reject-button-<id>` |

**Deciding a booking request** opens its inline form as its own row directly below the booking's, inside the table, the same per-row pattern as End block early above (not below the whole Booking requests table): only one of Update venue, Edit times, Block venue, End early and this is open at a time. Reason is required to reject, optional to approve (the same rule as deciding an event request, `ui-guidelines.md` existing request-detail reject/approve pattern). Its test ids use the action as `<field>`, the same convention as request-detail's decide form.

| Element | `data-testid` |
|---|---|
| Reason input | `venue-detail-decide-reason-input` |
| Message under an empty required reason | `venue-detail-decide-reason-error` |
| Confirm button (labelled with the action, e.g. Reject) | `venue-detail-decide-confirm-button` |
| Cancel button | `venue-detail-decide-cancel-button` |

On the request page (`request-detail`), SCRUM-36: an Event Coordinator sees a Request venue booking button when the event's status is Approved or Planning; it links to `/requests/:id/bookings/new`, not an inline form, since raising starts a new record the bookings area owns (`docs/design/frontend.md` §2).

| Element | `data-testid` |
|---|---|
| Request venue booking button (only with `bookings.edit`, status Approved or Planning) | `request-detail-raise-booking-button` |

The booking-new page (`booking-new`): a venue picker (`select`, the active venues) and the usual form buttons.

| Element | `data-testid` |
|---|---|
| Back link | `booking-new-back-link` |
| Title | `booking-new-title` |
| Banner | `booking-new-banner` |
| Venue select | `booking-new-venue-input` |
| Message under an empty field | `booking-new-venue-error` |
| Raise (confirm) button | `booking-new-raise-button` |

**Requirements an event chose** (SCRUM-42). They replace the brief's free-text venue requirements and accessibility needs, so the event request has no field of either name; the brief's wording stays visible as two group headings, in the brief's order: after Expected attendance, before Equipment requirements. On the new-request page and in the Draft edit form on the request page, each group is a `fieldset` whose `legend` is its heading. "Venue requirements" holds a "Room layout" select (None, then the layouts) and a "Facilities" checkbox group per §5; "Accessibility needs" holds an "Accessibility features" checkbox group per §5. The lists are the same fixed lists as a venue's. None is required: no `*`, no message under them. The request page shows the same two headings as `h2`s at the same place, each over its label/value pairs ("Room layout", "Facilities"; "Accessibility features"), comma-separated in list order, `None` when empty (as the venue page does). The headings have no test ids.

| Element | `data-testid` |
|---|---|
| Layout select | `request-new-layout-input`, `request-detail-edit-layout-input` |
| Facility checkbox | `request-new-facilities-<kebab-option>-input`, `request-detail-edit-facilities-<kebab-option>-input` |
| Accessibility feature checkbox | `request-new-accessibility-features-<kebab-option>-input`, `request-detail-edit-accessibility-features-<kebab-option>-input` |
| Layout value | `request-detail-layout` |
| Facilities value | `request-detail-facilities` |
| Accessibility features value | `request-detail-accessibility-features` |

**Venue-suitability warnings** on the booking-new page (SCRUM-42). Choosing or changing the venue checks it against the event; each mismatch is one line in a warning list (`.warning-list`, `visual-style.md`) inside the form, under the venue select and above Raise, headed "This venue may not suit the event". A venue with no mismatch shows no list, and a new choice clears the old one's. The list is not a banner: it does not stop Raise, and it does not count against one banner at a time. The coordinator may Raise despite it, or leave with the back link, which is the Cancel (AC5). A failed check shows its message in `booking-new-banner`.

| Element | `data-testid` | Text |
|---|---|---|
| Warning list | `booking-new-warnings` | This venue may not suit the event |
| Capacity | `booking-new-warning-capacity` | Expected attendance 100 is above the venue's maximum capacity of 60. |
| Start time | `booking-new-warning-start-time` | Start time 07:59 is outside the venue's operating hours, 08:00 to 20:00. |
| End time | `booking-new-warning-end-time` | End time 20:01 is outside the venue's operating hours, 08:00 to 20:00. |
| Missing layout | `booking-new-warning-layout-<kebab-option>` | The venue does not record the Theatre layout. |
| Missing facility | `booking-new-warning-facility-<kebab-option>` | The venue does not record the facility Sound system. |
| Missing accessibility feature | `booking-new-warning-accessibility-feature-<kebab-option>` | The venue does not record the accessibility feature Hearing loop. |

**Venue search** (SCRUM-33). On the request page, an Event Coordinator sees a Search venues button when the event's status is Approved or Planning, next to Request venue booking; it links to `/requests/:id/venues/search`. For any other status the button is not shown.

| Element | `data-testid` |
|---|---|
| Search venues button (only with `venues.search`, status Approved or Planning) | `request-detail-search-venues-button` |

The venue-search page (`venue-search`) shows the event's own values, an optional location filter and the venues that fit. The filters are a text input for the location, a "Room layout" select (None, then the layouts; SCRUM-35), a group of checkboxes for facilities (SCRUM-35), a group of checkboxes for accessibility features (SCRUM-34) and one Apply button, not a form that leaves the page: Apply searches again with everything typed, chosen and ticked together. An empty location input applies no location restriction, the layout on None applies no layout restriction, and no facility or accessibility feature ticked applies no restriction for that list; nothing is chosen or ticked when the page opens, and the event's own required layout, facilities and accessibility needs never choose or tick anything. A venue's location must match the typed text exactly; a venue is shown only if it records the chosen layout as supported (a venue with no layouts recorded does not) and records every facility and every accessibility feature ticked. Clearing a filter is setting the layout back to None or unticking every box of one group and pressing Apply; only that restriction goes, and the other filters and the event's own criteria still apply. The results are a table per §6 whose first cell links to the venue's page; no results is one sentence instead of the table, never an error.

| Element | `data-testid` |
|---|---|
| Back link | `venue-search-back-link` |
| Title | `venue-search-title` |
| Banner | `venue-search-banner` |
| Event name | `venue-search-event-name` |
| Event date and times | `venue-search-period` |
| Expected attendance | `venue-search-attendance` |
| Location input | `venue-search-location-input` |
| Room layout select (None first) | `venue-search-layout-input` |
| Facility checkbox | `venue-search-facilities-<kebab-option>-input` (e.g. `venue-search-facilities-wi-fi-input`) |
| Accessibility feature checkbox | `venue-search-accessibility-features-<kebab-option>-input` (e.g. `venue-search-accessibility-features-hearing-loop-input`) |
| Apply button (every filter together) | `venue-search-apply-button` |
| Result row | `venue-search-row-<id>` |
| Venue name (link) | `venue-search-name-<id>` |
| Venue location | `venue-search-location-<id>` |
| Venue maximum capacity | `venue-search-capacity-<id>` |
| No results | `venue-search-empty` |

## 8. Not-permitted page

- One sentence saying the account cannot open this page, and a link home (§1).
- Test ids: `not-permitted-message`, `not-permitted-home-link`.

## 9. Dates, times and status text

- Dates are shown as `03 Oct 2026`; times as `14:30` (24-hour). Date and time together: `03 Oct 2026, 14:30–16:00`. A moment something happened (submitted, decided): `03 Oct 2026, 14:30`, in UTC as the API sends it. A period that may span days (a venue block): `20 Oct 2026, 09:00 to 21 Oct 2026, 18:00`, both ends in full even on the same day, in local time as entered. The API sends ISO values; pages format them with `formatDate`, `formatTime`, `formatPeriod`, `formatDateTime` and `formatDateTimePeriod` from `app/format.js` (`frontend.md` §7) and never by hand.
- Status text is the `STATUS` constant from `app/format.js`, whose values are the exact words in `state-model.md`. Pages never type a status string.

## 10. Test ids, summary

- Every input, button, link that acts, banner, title, back link, row, status, flag and empty message has a `data-testid`.
- Format `<page>-<element>`, kebab-case, `<page>` from §1 (`layout` for the layout).
- Tests find elements by test id only; text is asserted, never used to find an element.
- Renaming a test id changes every test that uses it: update those tests in the same pull request.

## 11. Review checks (per pull request that touches a page)

1. Every element in §10 has a test id matching the patterns here.
2. Refusals show the API's message; nothing fails silently.
3. Controls the account cannot use are hidden, and the page still shows a refusal if the API says no.
4. Status and flag text come from `STATUS`; dates and times from `app/format.js`; colour never stands alone.
5. The page follows the §3 order; no modal, overlay or browser dialog anywhere.

## 12. Look

How pages look (tokens, type, spacing and the shared classes) is in `visual-style.md`; pages use its classes and never style a pattern by hand. The one product decision it leaves here is which status gets which colour. A status is shown as a badge, the status text itself on a tint of its colour; colour never stands alone (§6). Pages get the class from `statusBadgeClass(status)` in `app/format.js`, keyed by the `STATUS` constants.

| Status | Badge colour |
|---|---|
| Draft | Neutral |
| Submitted | Info |
| Approved | Success |
| Planning | Warning |
| Confirmed | Success |
| Rejected | Danger |
| Cancelled | Danger |
| Completed | Neutral |
| Requested | Info |
| Withdrawn | Neutral |

A status not in this table is neutral until a story adds its row here. Requested and Withdrawn are a venue booking request's own statuses (state-model.md); its Approved and Rejected reuse the colours already above.
