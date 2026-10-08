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
| 1.9 | 08-10-2026 | §7 the venue page's Booking requests section gains attendance, venue requirements and a decision cell, plus per-row Approve/Reject and an inline decide form | SCRUM-37 lets Venue Staff decide a booking request from the venue's own page |

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
- **An action that needs a reason or a confirmation opens an inline form** below the action row, on the same page: its fields per §5, a Confirm button (labelled with the action, e.g. Reject) and a Cancel button that closes it. No modal, no overlay, no browser `confirm()`. Only one inline form is open at a time; opening another closes the first. Its test ids use the action as `<field>`: `request-detail-reject-reason-input`, `request-detail-reject-confirm-button`, `request-detail-reject-cancel-button`.

| Element | `data-testid` | Example |
|---|---|---|
| Field value | `<page>-<field>` | `request-detail-attendance` |
| Status | `<page>-status` | `request-detail-status` |
| Flag | `<page>-<flag>-flag` | `request-detail-clarification-flag` |

**A list of related records on a detail page** (a venue's blocks) is a section under the fields with an `h2` and a table per §6. Its ids carry the record's name in place of the page's own list ids, so they cannot clash with the page's fields: `<page>-<record>-row-<id>`, one cell `<page>-<record>-<field>-<id>`, and `<page>-<records>-empty` when there are none.

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

SCRUM-79 adds an action cell to each block row, only with `venues.edit`. Which action a block offers follows its `phase` from the API (not a status, so no badge): a block that has not started offers Remove, which acts at once; a block in progress offers End early, which opens an inline end-block form below the Blocks table (new end date and time, End and Cancel); a block that has ended offers neither. The update form, the block form and the end-block form are all inline forms, so only one of the three is open at a time: opening any one closes the other two.

| Element | `data-testid` |
|---|---|
| Remove button (upcoming block, only with `venues.edit`) | `venue-detail-block-remove-button-<id>` |
| End early button (block in progress, only with `venues.edit`) | `venue-detail-block-end-button-<id>` |
| End-block form inputs | `venue-detail-end-block-end-date-input`, `venue-detail-end-block-end-time-input` |
| Message under an empty field | `venue-detail-end-block-<field>-error` (e.g. `venue-detail-end-block-end-time-error`) |
| End (confirm) and Cancel buttons | `venue-detail-end-block-confirm-button`, `venue-detail-end-block-cancel-button` |

**Booking requests** (SCRUM-36) is a second related-records section on the venue page, below Blocks: raising one happens from the event's own page (below), not here. Status as the exact state-model.md word, as a badge (§12). SCRUM-37 adds the event's expected attendance and venue requirements, so Venue Staff can decide without leaving the page (AC1), the decision once made (AC5), and a Venue Staff-only action cell per row, the same action-cell pattern as Blocks (§7 above): a Requested row offers Approve and Reject, any other status offers neither.

| Element | `data-testid` |
|---|---|
| Booking row | `venue-detail-booking-row-<id>` |
| Booking status | `venue-detail-booking-status-<id>` |
| Booking period | `venue-detail-booking-period-<id>` |
| Booking event name | `venue-detail-booking-event-<id>` |
| Booking attendance | `venue-detail-booking-attendance-<id>` |
| Booking venue requirements | `venue-detail-booking-venue-requirements-<id>` |
| Booking decision (blank until decided) | `venue-detail-booking-decision-<id>` |
| No booking requests | `venue-detail-bookings-empty` |
| Approve button (Requested row, only with `bookings.decide`) | `venue-detail-booking-approve-button-<id>` |
| Reject button (Requested row, only with `bookings.decide`) | `venue-detail-booking-reject-button-<id>` |

**Deciding a booking request** opens an inline form below the Booking requests table, the same pattern as End block early: only one of Update venue, Block venue, End early and this is open at a time. Reason is required to reject, optional to approve (the same rule as deciding an event request, `ui-guidelines.md` existing request-detail reject/approve pattern). Its test ids use the action as `<field>`, the same convention as request-detail's decide form.

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
