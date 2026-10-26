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
| 1.17 | 09-10-2026 | §7 the booking-new page's warnings gain a line per approved booking and per block already holding the chosen venue over the event's period (`booking-new-warning-approved-booking-<id>`, `booking-new-warning-block-<id>`); deciding a booking request: a refused approval shows the API's message, naming what holds the venue, in the venue page's banner | SCRUM-38 refuses an approval that would double-book a venue and warns the Event Coordinator before raising |
| 1.18 | 09-10-2026 | §7 the venue page's Booking requests section gains a Withdraw button, own-record scoped to the raising Coordinator, acting at once | SCRUM-77 lets the Coordinator who raised a booking pull it back before Venue Staff decide it |
| 1.19 | 09-10-2026 | §7 the venue page's Occupied periods section and Current clashes section and their test ids; the warnings and the approval refusal speak of the event's occupied period, widened by the venue's setup and turnaround time (a block keeps its own period) | SCRUM-41 reserves setup and turnaround time either side of a booking, so what holds a venue is its occupied period, not its published one |
| 1.20 | 09-10-2026 | §7 a successful duration save always closes the form and says `Times updated`; a list whose reload refuses afterwards shows an unavailable notice with a Reload control (`venue-detail-occupied-unavailable`/`-reload-button`, `venue-detail-clashes-unavailable`/`-reload-button`, `venue-detail-bookings-unavailable`/`-reload-button`) instead of its previous rows | SCRUM-41 review: a failed refresh must not leave stale occupied periods or a stale clash list on the page as though they were current |
| 1.21 | 09-10-2026 | §7 the venue page's Booking requests section gains a Suggestion column, and the Reject form gains an optional suggested venue and suggested period, with their test ids | SCRUM-78 lets Venue Staff suggest another venue or period when they reject a booking request, and the Event Coordinator reads it beside the reason |
| 1.22 | 09-10-2026 | §1 `/venues/:id/availability`; §7 the venue page's View availability link and the venue-availability page | SCRUM-39 lets an Event Coordinator or Venue Staff see a venue's committed and pending periods on a calendar before raising or deciding a request |
| 1.23 | 09-10-2026 | §7 the venue-availability page shown one day at a time, reusing the label/value list, with an explicit Free day instead of one flat table of entries; its test ids updated to match | A flat table of only-busy entries did not show which days were open, the very thing AC1 ("judge dates") needs; day-by-day, with Free days shown, makes that legible at a glance |
| 1.24 | 11-10-2026 | §1 `/notifications`; §7 the notifications page and its test ids; §2's anticipated nav unread count (`layout-nav-notifications-count`) now has a source, `GET /api/notifications/unread-count` | SCRUM-58 lets any logged-in account see, open and mark their own notifications read |
| 1.25 | 12-10-2026 | §1 `/equipment` route; §1 home-page bullet reworded (every seeded role can now open a page); §7 the equipment inventory page — plain-text type name (no detail page, stated deviation from §6's link rule), per-row Change total with its inline `noValidate` form, `n units` text, and the unavailable-notice ids for a refused refresh | SCRUM-49: Technical Support Staff change stock counts; they and Event Coordinators view inventory (was 1.24 on the branch; renumbered after SCRUM-58's 1.24 merged first) |
| 1.26 | 12-10-2026 | §7 equipment inventory: all stock-edit controls are disabled during a save and its refresh; an initial read failure also offers Reload; an open editor is hidden if editing permission is removed; replies from discarded initial loads are ignored | SCRUM-49 review: prevent switching editors during a pending write and allow recovery from a failed initial read (was 1.25 on the branch; renumbered after SCRUM-58's 1.24 merged first) |
| 1.27 | 13-10-2026 | §7 the request page's Safety check section (a Safety Officer's review of an event in Safety Check, with its note-per-area form and Approve and Reject buttons) and Safety decisions section, and their test ids; §12 Safety Check badge colour | SCRUM-89 lets the Safety Officer review, note and decide an event in Safety Check from the request page; the decision returns them to Requests |
| 1.28 | 14-10-2026 | §7 the Decide form's Changes needed in checkboxes and Request changes button; the Changes requested card for an Event Coordinator; a decision's Areas line | SCRUM-90 lets the Safety Officer send an event back with the areas to change, and the coordinator reads them on the event |
| 1.29 | 14-10-2026 | §7 the request page's Send for safety check button and Sent for safety check line, and how a refusal lists what is outstanding | SCRUM-53 lets the assigned Event Coordinator send a Planning event for safety check |
| 1.30 | 15-10-2026 | §7 the request page's Venue holds section, its Place hold form and Release button, with their test ids and banners; the booking-new page's hold warning line (`booking-new-warning-hold-<id>`); the venue-availability page's Held entries (kind `hold`); a refused approval also names a Held hold; §12 Held and Released badge colours | SCRUM-84 lets the assigned Event Coordinator hold a venue for an event until an expiry, and shows the hold wherever the venue's availability is judged |
| 1.31 | 15-10-2026 | §4 the page banner sticks below the header wherever the page is scrolled, is announced (`aria-live`) and has a dismiss control (`<page>-banner-dismiss`); every page renders it with the shared `app/Banner.jsx`; §10 the dismiss id | The Product Owner's review: a message raised by an action low on the page was out of sight at the top of the content, so the action seemed to do nothing |
| 1.32 | 15-10-2026 | §13 Feedback at the point of action: the principle and its patterns (an inline form beside its trigger, brought into view with its first field focused; a confirmation the same way with Cancel focused; refreshed results brought into view; a refused required-field check focusing the first field it names); §7 the request page's Approve and Reject in the card's action row, and the Edit draft, Delete draft and decide forms directly below the card; §11 check 6 | The Product Owner's review: pressing Approve opened its form further down the page, so nothing seemed to change where the user clicked; the audit found the same gap on every inline form and long form |
| 1.33 | 14-10-2026 | §7 the Equipment page's Check availability form and result card, with their test ids | SCRUM-50 lets Technical Support Staff check a type for a period |
| 1.34 | 15-10-2026 | §7 equipment inventory displays seeded descriptions and storage locations; stock remains the only editable field | SCRUM-49 AC1 refinement closes the equipment-catalogue information gap in the Week 1 customer brief |
| 1.35 | 15-10-2026 | §7 the request page's Venues section: Search venues, Place hold and Request venue booking grouped at its top (moved there, same rules), the event's Venue bookings list with Cancel booking and its inline form, Withdraw, the Cancelled row's reason, and the Venue holds list inside it, with their test ids, messages and banners; §12 a Cancelled booking reuses the Cancelled colour | SCRUM-83 lets the assigned Event Coordinator see and manage each venue booked for an event separately, and cancel one Approved booking without touching the others |
| 1.36 | 16-10-2026 | §7 the request page's Venue bookings row carries a Venue unavailable marker (`request-detail-booking-unavailable-<id>`); the venue-search page's Action column with Request booking and Place hold on each result (`venue-search-request-booking-button-<id>`, `venue-search-place-hold-button-<id>`); `?venue=<id>` on the booking-new page and `?hold=<id>` on the request page choose a venue; §6 a button-styled link in a cell keeps the button's colours; §12 the Venue unavailable flag's Danger badge | SCRUM-82 tells the assigned Event Coordinator a booked venue became unavailable and lets them request a replacement or place a hold from the search results |
| 1.37 | 16-10-2026 | §1 the Equipment requests list (`/equipment-requirements`) and the per-event requirements page (`/requests/:id/equipment`); §7 their forms, status badges, ids and permission gates | Record Coordinator equipment needs, preserve stock and reservations |
| 1.38 | 18-10-2026 | Equipment requirement decisions, corrections, notes, decision metadata and per-row test ids | SCRUM-81; approval never reserves |
| 1.39 | 19-10-2026 | §7 the per-event requirements page gains a Check availability button on each requirement for an account with `equipment.check`, and a result card (brought into view, §13) with the verdict covered or short by N | SCRUM-50 AC2, AC6 and AC7: the check can be opened from a recorded requirement; the event's own reservation is left out |
| 1.40 | 19-10-2026 | §7 the request page's Venue holds rows show Expired with no Release, the hold-expiry warning and expiry notice texts on the Notifications page, and the venue-availability page leaves Expired holds out; §12 Expired badge colour (Danger) | SCRUM-85 lets a Held hold expire on its own, warning the assigned Event Coordinator 24 hours before and telling them when the venue was released |
| 1.41 | 19-10-2026 | Equipment reserve/release confirmations and scoped reservation history | SCRUM-51 AC1–7 |
| 1.42 | 19-10-2026 | §1 the Unassigned queue page (`/assignments/queue`, `assignment-queue`) and its test ids in §6; §7 the Assigned coordinator is now set by the Lead from the queue (not by approving), and the request page also shows who assigned it (`request-detail-assigned-by`) | Week 7 customer change 5; SCRUM-86 replaces SCRUM-43's auto-assignment with an unassigned queue the Event Coordinator Lead assigns from |
| 1.43 | 20-10-2026 | §7 an Event Coordinator is offered Approve/Reject, Request venue booking, Search venues, Place hold, Cancel booking and Withdraw only on an event assigned to them (Withdraw whoever raised the request, on the venue page and on the request page); New request is offered only to an Event Organiser | SCRUM-87: a coordinator manages only their assigned events, and only an Organiser creates or submits a request |
| 1.44 | 21-10-2026 | §1 the All assignments page (`/assignments`, `assignments`) and §6 its elements and test ids; §7 the Lead's read-only view of an active event | SCRUM-88 AC1–6 |
| 1.43 | 19-10-2026 | The Notifications page texts for venue booking decisions, equipment decisions and equipment reservations; no new page, element or test id | SCRUM-63 tells the event's assigned Event Coordinator when Venue Staff or Technical Support Staff decide or change something for their event |
| 1.45 | 22-10-2026 | §1/§6 the All assignments page gains a coordinator select and a Reassign button on each assigned row, with their test ids, messages and the three Notifications page texts; §7 the request page shows the new coordinator and the reassigning Lead after a reassignment | SCRUM-44 AC1–6: the Event Coordinator Lead moves an assigned active event to another Event Coordinator |
| 1.46 | 22-10-2026 | The Notifications page texts for an event request received, approved and rejected, beside the assignment (SCRUM-86) and reassignment (SCRUM-44) notices they sit with; no new page, element or test id | SCRUM-62 tells the Event Organiser who created a request when it is received, assigned a coordinator, approved or rejected |
| 1.47 | — | Completion confirmation, metadata, refusal and documented ids on Request detail | SCRUM-66; unmerged implementation, date to be recorded at review |
| 1.48 | — | Event cancellation form, persistent metadata, shared lifecycle confirmation state and post-cancel arrangement refresh | SCRUM-65; date pending team review |
| 1.49 | 23-10-2026 | §7 the request page's Clarifications section (the Request clarification button and form, the reply form, the history, the flag beside the status and on the Requests page) with their test ids, messages and banners; the Notifications page texts for a clarification requested and a reply | SCRUM-45 AC1–8: the assigned Event Coordinator asks the Event Organiser what is missing on a Submitted request, and the Organiser replies |
| 1.50 | 25-10-2026 | SCRUM-47 section: Edit event on Request detail (button, inline form, refusal) and the Change record, with their test ids and messages | SCRUM-47 AC1–7: the assigned Event Coordinator edits an event after submission and sees its record of significant changes |
| 1.51 | 27-10-2026 | SCRUM-61 section: the Too small and Timing mismatch badges on the request page's bookings and holds, the venue page's booking requests, the Safety check card and the equipment page's reservations, with their test ids; the status test ids on a hold row and a venue booking-request row move from the cell to the status badge, so each holds the status alone | SCRUM-61 AC1, AC3, AC6: flags beside each affected arrangement |

## 1. Pages

| Route | Page name (test id prefix) | Who reaches it |
|---|---|---|
| `/login` | `login` | Anyone not logged in |
| `/requests` | `requests` | Logged in; the API returns only what the account may see |
| `/requests/new` | `request-new` | Feature per `permissions.md` |
| `/requests/:id` | `request-detail` | Feature and object rule per `permissions.md` |
| `/assignments/queue` | `assignment-queue` | Feature per `permissions.md` (`assignments.manage`, the Event Coordinator Lead) |
| `/assignments` | `assignments` | Feature per `permissions.md` (`assignments.view`, the Event Coordinator Lead) |
| `/venues` | `venues` | Feature per `permissions.md` |
| `/venues/new` | `venue-new` | Feature per `permissions.md` |
| `/venues/:id` | `venue-detail` | Feature per `permissions.md` |
| `/venues/:id/availability` | `venue-availability` | Feature per `permissions.md` |
| `/requests/:id/bookings/new` | `booking-new` | Feature per `permissions.md` |
| `/requests/:id/venues/search` | `venue-search` | Feature per `permissions.md` |
| `/equipment` | `equipment` | Feature per `permissions.md` |
| `/equipment-requirements` | `equipment-requests` (nav: Equipment requests) | `equipment.requirements.view`; the API returns only the events this account may read |
| `/requests/:id/equipment` | `equipment-requirements` (no nav) | `equipment.requirements.view`; the API returns only the events this account may read |
| `/notifications` | `notifications` | Logged in; every role holds `notifications.view` |
| — (shown in place of a refused page) | `not-permitted` | Anyone whose account lacks the page's feature |

- Not logged in → any page sends the user to `/login`.
- **Home** is the first nav entry, in nav order, that the account may open. After logging in, `/`, unknown addresses and the not-permitted page's link all go home (pages send the user to `/`; the app resolves it). Venue Staff therefore land on Venues, an Attendee on Registration, never on a page they cannot open.
- An account without a page's feature sees the not-permitted page at the same address; it is not redirected.
- An account that may open **no** page gets a welcome home page at `/`, inside the layout: "Welcome, <username>" and one sentence saying there is nothing to do for their role yet. Test ids: `home-title`, `home-message`. Since SCRUM-49 gives Technical Support Staff the Equipment page, every role seeded today can open at least one page — the welcome page remains for an account whose roles open none (none exists in the seed), never a redirect to a page they cannot use.

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

- One banner at a time, at the top of the page content (§3). It **stays in view**: once the page scrolls past its place it sticks just below the header, so a message raised by an action anywhere on the page is seen without scrolling back up. While it sticks it covers the top of the content under it; the user dismisses it to see what is beneath.
- Error: `role="alert"` with `aria-live="assertive"`. Success: `role="status"` with `aria-live="polite"`. Screen readers announce both. The text states what happened ("Request submitted", or the API's refusal message word for word). The page never replaces a refusal with its own wording.
- A dismiss control (×, labelled "Dismiss message") at its right clears it at once. The control sits beside the message, not inside it, so the banner's test id still reads the message alone, word for word.
- Every page renders its banner with the shared `Banner` component (`app/Banner.jsx`, `frontend.md` §1), passing its error and its success; an error wins when both are set.
- A refusal (the API says no) always shows in the banner, even when the page hid the control that led to it.
- A banner stays until the user's next action, navigation or dismissal. No auto-dismiss, so tests never race a timer.
- After an action that moves the user to another page (e.g. submitting a new request opens its detail page), the success banner shows on the page they land on.
- A session that has ended sends the user to `/login`.
- Test ids: `<page>-banner` (the message), `<page>-banner-dismiss` (the dismiss control). Tests tell success from error by `role`.

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
- A link styled as a button in a cell (an action such as Request booking) keeps the button's colours, not the cell link's.
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

**The unassigned queue (SCRUM-86).** The Event Coordinator Lead's page (`/assignments/queue`, test id prefix `assignment-queue`, nav label Unassigned queue, first in the nav so the Lead lands on it) lists every Submitted request that has no assigned coordinator, oldest submission first, as a table (§6): the event name (a link to the request page, which the Lead may open read-only), purpose, date, expected attendance, Event Organiser and the submission date and time (§9), and nothing more. Each row has a select of the Event Coordinators (first option "Choose a coordinator") and an Assign button. Assigning with no one chosen shows a message under the select and sends nothing (§5); every other refusal (already assigned, no longer Submitted) shows in the banner and reloads the queue. A success removes the row and says `<event> assigned to <coordinator>`. No requests waiting shows one sentence, no table.

| Element | `data-testid` |
|---|---|
| Title, banner, empty message | `assignment-queue-title`, `assignment-queue-banner`, `assignment-queue-empty` |
| Row | `assignment-queue-row-<id>` |
| Event name (holds the link), purpose, date, attendance, Event Organiser, submitted | `assignment-queue-name-<id>`, `assignment-queue-purpose-<id>`, `assignment-queue-date-<id>`, `assignment-queue-attendance-<id>`, `assignment-queue-organiser-<id>`, `assignment-queue-submitted-<id>` |
| Coordinator select, message under an empty choice, Assign button | `assignment-queue-coordinator-input-<id>`, `assignment-queue-coordinator-error-<id>`, `assignment-queue-assign-button-<id>` |

**All assignments (SCRUM-88, SCRUM-44).** The Event Coordinator Lead's page (`/assignments`, test id prefix `assignments`, nav label All assignments, second in the nav after the Unassigned queue) lists every Submitted, Approved, Planning, Safety Check or Confirmed request as a table: the event name (a link to the request page, which the Lead opens read-only), the date (§9), the status (a badge, §12) and the assigned coordinator, or "Unassigned". Above it, each Event Coordinator and how many active events they hold (a coordinator with none shows 0; the counts ignore the filters), and two selects: Coordinator (first option "All coordinators") and Status (first option "All statuses", then the five active statuses). Choosing either reloads the list; a refusal shows in the banner and the list is not shown. With nothing to list the page says "No active events match.". Opening an event (the name is a link) shows it read-only, as below. SCRUM-44 adds one thing the page can do: each row that has an assigned coordinator ends with a select of the Event Coordinators (first option "Choose a coordinator", then every account holding the role, the current coordinator included) and a Reassign button. Reassigning with no one chosen shows a message under the select and sends nothing (§5); every other refusal (the event is no longer active, the coordinator it already has) shows in the banner, and the list and the counts reload whatever the outcome. A success says `<event> reassigned to <coordinator>.`, shows the new coordinator on the row, and leaves the status as it was. A row with no coordinator ("Unassigned") has neither select nor button: it is assigned from the Unassigned queue. The new coordinator, the previous one and the Event Organiser are told on the Notifications page (`You have been assigned the event "<event>".`, `The event "<event>" has been reassigned to <coordinator>.`, `<coordinator> has been assigned to your event "<event>".`).

| Element | `data-testid` |
|---|---|
| Title, banner, empty message | `assignments-title`, `assignments-banner`, `assignments-empty` |
| Coordinator select, Status select | `assignments-coordinator-filter`, `assignments-status-filter` |
| A coordinator's count of active events | `assignments-workload-<username>` |
| Row | `assignments-row-<id>` |
| Event name (holds the link), date, status, assigned coordinator | `assignments-name-<id>`, `assignments-date-<id>`, `assignments-status-<id>`, `assignments-coordinator-<id>` |
| Coordinator select, message under an empty choice, Reassign button (SCRUM-44; assigned rows only) | `assignments-reassign-input-<id>`, `assignments-reassign-error-<id>`, `assignments-reassign-button-<id>` |

## 7. Detail pages

- **The Lead's read-only view (SCRUM-88).** The Event Coordinator Lead opens any active event from All assignments and sees its fields, its bookings and its holds, and the coordinator notes; no Approve, Reject, Request venue booking, Search venues, Place hold, Cancel booking, Withdraw or Send for safety check control is offered, because none is offered to an account that is not the event's assigned Coordinator.
- **Who is offered what (SCRUM-87).** An Event Coordinator sees only the requests assigned to them, so the Requests page lists no other and another's request opens as a refusal in the banner with none of its fields (§4). On a request they may open, Approve and Reject, Request venue booking, Search venues, Place hold, Cancel booking and Withdraw (any Requested booking of the event, whoever raised it) are shown only to the event's assigned Coordinator; the New request button and page are offered only to an Event Organiser, so a Coordinator, a Lead or any other role finds neither.

- Fields as label/value pairs, in the order the form uses.
- Status as text; a flag as its own text beside it.
- Actions (approve, reject, …) are buttons per §5, in one row under the fields, shown only when the account's features allow them.
- **Assigned coordinator (SCRUM-86).** Once the Event Coordinator Lead has assigned a request from the unassigned queue (§6), the request page shows an Assigned coordinator (their username), Assigned by (the Lead) and an Assigned on date, below the decision, to everyone who can open the request. Approving a request assigns no one. The request page offers no way to decline or change the assignment; the Lead reassigns from All assignments (§6, SCRUM-44), after which this section shows the new coordinator, the Lead who moved the event and the date.
- **An action that needs a reason or a confirmation opens an inline form** directly below the action row, on the same page, brought into view with focus in it (§13): its fields per §5, a Confirm button (labelled with the action, e.g. Reject) and a Cancel button that closes it. No modal, no overlay, no browser `confirm()`. Only one inline form is open at a time; opening another closes the first. Its test ids use the action as `<field>`: `request-detail-reject-reason-input`, `request-detail-reject-confirm-button`, `request-detail-reject-cancel-button`.
- **Revise and resubmit (SCRUM-72).** On a Rejected request the Event Organiser who created it sees the request's fields in a form already open below the details (the decision and its reason stay above it), prefilled and laid out as the Draft edit form is, with one primary Resubmit button and no Cancel. The same required-field check as submitting runs first: a message under each empty required field, nothing sent. Test ids use `resubmit` as the action: `request-detail-resubmit-<field>-input`, `request-detail-resubmit-<field>-error`, a choice's checkbox `request-detail-resubmit-<list>-<option>-input` as in §5, and `request-detail-resubmit-button`. Once the request is Submitted the form is gone. Anyone else sees the details only.

| Element | `data-testid` | Example |
|---|---|---|
| Field value | `<page>-<field>` | `request-detail-attendance` |
| Status | `<page>-status` | `request-detail-status` |
| Flag | `<page>-<flag>-flag` | `request-detail-clarification-flag` |
| Assigned coordinator (SCRUM-86; shown once assigned) | `<page>-assigned-coordinator` | `request-detail-assigned-coordinator` |
| Assigned by, the Lead (SCRUM-86; shown with the coordinator) | `<page>-assigned-by` | `request-detail-assigned-by` |
| Assignment date (SCRUM-86; shown with the coordinator, `03 Oct 2026`) | `<page>-assigned-at` | `request-detail-assigned-at` |

**Clarifications (SCRUM-45).** While the request is Submitted and no clarification is open, the assigned Event Coordinator sees a Request clarification button in the card's action row, beside Reject and Approve, that opens an inline form directly below the card (§13) with one Message field and Send and Cancel buttons; a blank message shows `Say what is missing or unclear.` under the field and sends nothing. Sending shows the banner `Clarification requested`, leaves the request Submitted and shows Clarification requested (a flag, §6, not a status) beside its status here and on the Requests page. While one is open the Organiser who wrote the request sees, under it, a Your reply field and a Send reply button; a blank reply shows `Write a reply.` and sends nothing, and sending shows the banner `Reply sent` and takes the flag away. Every clarification is listed, oldest first, as its message, `<username>, <moment>` (§9) and, once answered, the reply and `<username>, <moment>`; one a decision (Approve or Reject) ended is kept with no reply. A refusal (one already open, none open, no longer Submitted) shows in the banner and the page shows the request as it now stands. Once anything has been asked, a Clarifications section below the details shows the history to the Organiser who wrote the request, its assigned coordinator and the Lead (read-only); with nothing asked there is no section.

| Element | `data-testid` |
|---|---|
| History section | `request-detail-clarifications` |
| Request clarification button (action row), form (below the card), Message field, message under it, Send, Cancel | `request-detail-clarification-button`, `request-detail-clarification-form`, `request-detail-clarification-message-input`, `request-detail-clarification-message-error`, `request-detail-clarification-send-button`, `request-detail-clarification-cancel-button` |
| Reply form, Your reply field, message under it, Send reply | `request-detail-clarification-reply-form`, `request-detail-clarification-reply-input`, `request-detail-clarification-reply-error`, `request-detail-clarification-reply-button` |
| An entry, its message, who and when, its reply, who replied and when | `request-detail-clarification-row-<id>`, `request-detail-clarification-message-<id>`, `request-detail-clarification-by-<id>`, `request-detail-clarification-reply-<id>`, `request-detail-clarification-reply-by-<id>` |
| The flag beside the status (request page, Requests page) | `request-detail-clarification-flag`, `requests-clarification-flag-<id>` |

**Where the request page's forms open (§13).** Approve and Reject (SCRUM-29) sit in the request card's action row, under the fields, like the Draft's Delete, Edit and Submit. The forms those rows open (Edit draft, the Delete draft confirmation, and the Approve or Reject reason form) open directly below the card, above Venue holds and the safety sections, so they appear next to the button that opened them.

**Safety check (SCRUM-89).** An Event Coordinator or Safety Officer opening an event that has had a safety decision sees a Safety decisions section below the details: each decision as `<Decision> by <username> on <moment>`, its reason when it has one, and each note as `<Area>: <text>`, oldest first. A Safety Officer opening an event in Safety Check also sees a Safety check card: the date and time it was sent, its Approved venue bookings (venue and location, period, maximum capacity, supported layouts, facilities, accessibility features, each `None` when empty), and its Approved equipment requirements (`None.` until equipment is recorded). Below it is one Decide form, always open, with one optional note per area (Attendance, Capacity and layout, Emergency access, Accessibility, Equipment placement, Crowd movement, Venue restrictions), a Reason field, and Reject and Approve buttons. Reject with a blank reason shows `Reason is required.` and sends nothing. A decision returns the user to the Requests page with a banner `<event name>: approved, now Confirmed` or `<event name>: rejected, back in Planning`; a refused decision shows the reason in the page's banner and stays. An account without `safety.decide` sees no form.

**Request changes (SCRUM-90).** The Decide form also has a Changes needed in group of two checkboxes, Venue arrangements and Technical arrangements, and a Request changes button beside Reject and Approve. Request changes needs a reason and at least one box: otherwise `Reason is required.` and `Choose at least one area.` are shown and nothing is sent. The notes above are optional, as for the other decisions. A request returns the user to Requests with the banner `<event name>: changes requested, back in Planning`. While the event is in Planning and has not been sent for safety check again, its Event Coordinator sees a Changes requested card above the details with the areas, the reason, any notes, and who asked and when; once the event is sent again the card is gone and the request stays in the Safety decisions list, shown as `Changes requested` with `Areas: …`.

| Element | `data-testid` |
|---|---|
| Safety check card | `request-detail-safety-check` |
| Date and time sent | `request-detail-safety-sent-at` |
| Approved booking, its venue, period, capacity, layouts, facilities, accessibility features | `request-detail-safety-booking-<id>`, `-venue`, `-period`, `-capacity`, `-layouts`, `-facilities`, `-accessibility` |
| No Approved booking; no Approved equipment requirement | `request-detail-safety-bookings-empty`, `request-detail-safety-equipment-empty` |
| Approved equipment requirement list | `request-detail-safety-equipment` |
| Safety decisions section | `request-detail-safety-decisions` |
| One decision, its decision word, reason and one area's note | `request-detail-safety-decision-<id>`, `-decision`, `-reason`, `-note-<area>` |
| Decide form | `request-detail-safety-form` |
| Note field for an area (`emergency-access`, `crowd-movement`, …) | `request-detail-safety-note-<area>` |
| Reason field and its error | `request-detail-safety-reason-input`, `request-detail-safety-reason-error` |
| Reject and Approve buttons | `request-detail-safety-reject-button`, `request-detail-safety-approve-button` |
| Changes needed in: Venue arrangements and Technical arrangements checkboxes, and their error (SCRUM-90) | `request-detail-safety-area-venue-arrangements`, `request-detail-safety-area-technical-arrangements`, `request-detail-safety-area-error` |
| Request changes button (SCRUM-90) | `request-detail-safety-request-changes-button` |
| One decision's areas (SCRUM-90) | `request-detail-safety-decision-<id>-areas` |
| Changes requested section (an Event Coordinator, while the event is in Planning; SCRUM-90), its areas, reason, one area's note and who and when | `request-detail-requested-changes`, `-areas`, `-reason`, `-note-<area>`, `-by` |

**Send for safety check (SCRUM-53).** An event in Planning shows its assigned Event Coordinator, and only them, one primary Send for safety check button in the action row. It acts at once (no inline form). On success the banner says `Sent for safety check`, the status shows Safety Check and the page gains a Sent for safety check line with the date and time it was sent (§9), which stays while the event is in Safety Check or Confirmed. A refusal shows its reason in the page's banner and the page is read again, so a send made from another tab is shown as it now stands; when the event is not ready the banner lists each outstanding arrangement after `Outstanding:`, separated by semicolons.

| Element | `data-testid` |
|---|---|
| Send for safety check button (assigned coordinator, Planning only) | `request-detail-send-safety-button` |
| Sent for safety check date and time (Safety Check or Confirmed) | `request-detail-safety-check-at` |

**Check availability (SCRUM-50).** Below the banner, above the inventory, an account with `equipment.check` (Technical Support Staff) sees a Check availability form: an Equipment type select (every type in the list), a Start and an End (date and time, both required), and a Check availability button. It sends nothing to change: a refusal shows its reason in the page's banner (`The start must be before the end.`, `A start and an end are required.`) and no result. A result card, brought into view when it appears (§13), shows the type and the period, then Total units, Reserved for the period (the most units held at the same time, state-model.md), Out of service and Available. An account without `equipment.check`, such as an Event Coordinator, sees the inventory and no form.

| Element | `data-testid` |
|---|---|
| Check availability form, its type select, start, end and button | `equipment-check-form`, `equipment-check-type-input`, `equipment-check-start-input`, `equipment-check-end-input`, `equipment-check-button` |
| Result card and its four values | `equipment-check-result`, `equipment-check-total`, `equipment-check-reserved`, `equipment-check-out-of-service`, `equipment-check-available` |

**A list of related records on a detail page** (a venue's blocks) is a section under the fields with an `h2` and a table per §6. Its ids carry the record's name in place of the page's own list ids, so they cannot clash with the page's fields: `<page>-<record>-row-<id>`, one cell `<page>-<record>-<field>-<id>`, and `<page>-<records>-empty` when there are none. A per-row action's confirm/reason form opens as its own row directly below the one it acts on (a `<td colspan>` spanning the table), never below the whole table: in a long list, a form that opens far from its row is a form the user cannot find.

The venue page (`venue-detail`), SCRUM-40, SCRUM-75:

| Element | `data-testid` |
|---|---|
| View availability link (SCRUM-39; links to `/venues/:id/availability`) | `venue-detail-availability-link` |
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

SCRUM-39: View availability is shown to anyone who may view the venue at all (`venues.view`, held by both Event Coordinator and Venue Staff) — no narrower than the page itself, so there is nothing to gate beyond reaching this page. It links to `/venues/:id/availability`.

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

SCRUM-41 adds two sections to the venue page, below the actions and above Blocks: **Occupied periods** and, for Venue Staff only, **Current clashes**.

A duration save and the refresh it triggers are two separate outcomes. **Save** succeeds when the API accepts the times: the form closes and the banner says `Times updated` — that acknowledgment never depends on what the page does next, and an API refusal stays what it always was: the banner shows the message, the form stays open with what was typed, and nothing was written. The page then reads the lists again, one read feeding Occupied periods and Booking requests together (they share it) and one feeding Current clashes. A read that refuses marks its section unavailable: the section shows an unavailable notice with a **Reload** control instead of the rows it held — previous rows, or an empty state claiming nothing clashes, would read as current when they are not — while the other section shows whatever its own read returned. Reload reads both lists again, and each list that answers comes back current. A read that fails on the way into the page still shows in the banner, as it always has.

**Occupied periods** is the venue's availability list, shown to anyone who may view the venue (`venues.view`), earliest occupied period first. One row per Approved booking: the event's name and the booking's occupied period — its published period widened by the venue's setup and turnaround time (AC1) — formatted with `formatDateTimePeriod` (§9), so both endpoints and both dates show when the buffers roll over midnight. The event's name links to the event's request page only for an account with `requests.view`; anyone else sees plain text. The published date and times are never replaced by the buffers: they stay on the Booking requests row below and on the event's own page (AC1). An empty list says only that the venue has no approved bookings — never that it has no blocks or is completely free. The API derives every period at read time from the durations recorded now (AC5). A successful approval brings the booking into this list with the period the API sent back beside the row, and a successful duration save reads this list again — and the Current clashes list — so both show what the new durations make; the bookings themselves are never changed by a save.

| Element | `data-testid` |
|---|---|
| Occupied period row (Approved booking) | `venue-detail-occupied-row-<id>` |
| Occupied period's event name (link with `requests.view`, else plain text) | `venue-detail-occupied-event-<id>` |
| Occupied period, `formatDateTimePeriod` | `venue-detail-occupied-period-<id>` |
| No approved bookings | `venue-detail-occupied-empty` |
| Unavailable notice and its Reload control (after a refused reload) | `venue-detail-occupied-unavailable`, `venue-detail-occupied-reload-button` |

**Current clashes** (SCRUM-41 AC5) is a standing section under Occupied periods, only with `venues.edit`, since only those who may change the durations need it. It lists the Approved bookings of this venue whose occupied periods overlap another's — what the venue's recorded durations make clash right now. Every booking of a clashing pair is listed once, earliest first, so a chain A–B–C names all three. A booking awaiting a decision, a block and a booking of another venue are never listed. Saving durations never changes a booking, and a valid save succeeds even when it exposes a clash; reducing a duration simply drops the pairs it resolved. The event name follows the same link rule as Occupied periods.

| Element | `data-testid` |
|---|---|
| Clash row (Approved booking) | `venue-detail-clash-row-<id>` |
| Clash event name (link with `requests.view`, else plain text) | `venue-detail-clash-event-<id>` |
| Clash occupied period, `formatDateTimePeriod` | `venue-detail-clash-period-<id>` |
| Nothing currently clashing | `venue-detail-clashes-empty` |
| Unavailable notice and its Reload control (after a refused reload) | `venue-detail-clashes-unavailable`, `venue-detail-clashes-reload-button` |

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
| Unavailable notice and its Reload control (after a refused reload) | `venue-detail-bookings-unavailable`, `venue-detail-bookings-reload-button` |
| Booking decision (blank until decided) | `venue-detail-booking-decision-<id>` |
| Booking suggestion cell (SCRUM-78; empty when nothing was suggested) | `venue-detail-booking-suggestion-<id>` |
| Suggested venue's name, inside that cell | `venue-detail-booking-suggested-venue-<id>` |
| Suggested period, inside that cell, `11 Dec 2026, 09:00–12:00` | `venue-detail-booking-suggested-period-<id>` |
| No booking requests | `venue-detail-bookings-empty` |
| Approve button (Requested row, only with `bookings.decide`) | `venue-detail-booking-approve-button-<id>` |
| Reject button (Requested row, only with `bookings.decide`) | `venue-detail-booking-reject-button-<id>` |
| Withdraw button (Requested row, only with `bookings.edit`, only the event's assigned Coordinator, whoever raised it) | `venue-detail-booking-withdraw-button-<id>` |

SCRUM-77 adds Withdraw to a Requested row's action cell, for the Coordinator who raised that specific booking only (not every Coordinator, even though `bookings.edit` is a role-level key) — the same own-record pattern as a Draft's Edit/Delete. It acts at once, no inline form: the criteria ask for no confirmation, the same as a block's Remove. SCRUM-87 changes whose it is: the event's assigned Coordinator, whoever raised the request, so after a reassignment the previous Coordinator no longer sees it and the new one does.

**Deciding a booking request** opens its inline form as its own row directly below the booking's, inside the table, the same per-row pattern as End block early above (not below the whole Booking requests table): only one of Update venue, Edit times, Block venue, End early and this is open at a time. Reason is required to reject, optional to approve (the same rule as deciding an event request, `ui-guidelines.md` existing request-detail reject/approve pattern). Its test ids use the action as `<field>`, the same convention as request-detail's decide form. An approval refused because an approved booking or a block already holds the venue over an overlapping occupied period (SCRUM-38, widened by SCRUM-41) shows the API's message in `venue-detail-banner`, naming each holder (`This venue is already committed for an overlapping period: TC38 Holder, 10 Dec 2026, 14:00–17:00.`; a block as `blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement)`; several joined with `; `); the booking stays Requested and its decision cell stays blank. SCRUM-84: another event's Held hold refuses it the same way, named like a booking by its event and published period, after the bookings and before the blocks; the event's own hold never refuses its own approval, and approving releases it.

| Element | `data-testid` |
|---|---|
| Reason input | `venue-detail-decide-reason-input` |
| Message under an empty required reason | `venue-detail-decide-reason-error` |
| Confirm button (labelled with the action, e.g. Reject) | `venue-detail-decide-confirm-button` |
| Cancel button | `venue-detail-decide-cancel-button` |
| Suggested venue select, Reject only; first option None, then the active venues (SCRUM-78) | `venue-detail-decide-suggested-venue-input` |
| Suggested date, start time and end time, Reject only (SCRUM-78) | `venue-detail-decide-suggested-date-input`, `venue-detail-decide-suggested-start-time-input`, `venue-detail-decide-suggested-end-time-input` |
| Message under an empty part of a started period (SCRUM-78) | `venue-detail-decide-suggested-date-error`, `venue-detail-decide-suggested-start-time-error`, `venue-detail-decide-suggested-end-time-error` |

**Suggesting an alternative when rejecting (SCRUM-78).** Only the Reject form, never Approve, offers an optional suggested venue and an optional suggested period (date, start time and end time). The reason stays required; a suggestion cannot replace it. If any part of a period is filled the other two are required, with a message under each empty one (§5) and nothing sent. Every other rule is the API's and shows in `venue-detail-banner` with the form left open and its entries kept: the venue must exist, the start must be before the end, and the suggestion must change the venue or the period from what was requested. A refused suggestion refuses the whole rejection, so the booking stays Requested. Once rejected, the Suggestion column shows `Venue: <name>` and `Period: <period>` for whichever was suggested, to Venue Staff and every Event Coordinator who can open the venue page. A suggestion is only text: it creates no booking and holds nothing.

**Venues** (SCRUM-83). On the request page, one Venues section (an `h2`) after the request's card holds everything about the event's venues: at its top, beside the heading, Search venues, Place hold and Request venue booking, in that order, each shown by its own rule below; then the Place hold form when it is open; then Venue bookings (an `h3`); then Venue holds (an `h3`). The section is shown when any of its parts is: the two lists to everyone with `venues.view` on any event that is not a Draft, the buttons by their own rules.

| Element | `data-testid` |
|---|---|
| Venues section | `request-detail-venues` |

**Venue bookings** (SCRUM-83 AC1) lists every booking request raised for the event, oldest first, as a table per §6, or `No venue booking has been requested for this event.` when there are none. Each row shows the venue (plain text), the occupied period it covers (as the API derives it; the same text as a hold row below, `05 Dec 2026, 09:30–12:30`) and the status badge; a Cancelled row also shows `Reason: <reason>` under its badge. An account with `bookings.edit` sees an Action column: an Approved row offers **Cancel booking** to the event's assigned Event Coordinator while the event is Approved or Planning; a Requested row offers **Withdraw** to the Coordinator who raised it (SCRUM-77: the same call and banner as on the venue page, acting at once, §13 D); any other row offers nothing, and the API refuses anyone else. Cancel booking opens an inline form as the row directly below its own (§13 pattern A, one inline form at a time, §7), with a required Reason, then Cancel and Confirm cancel. A blank Reason shows `Reason is required.` under it and nothing is sent (§13 pattern C). Every other rule is the API's and shows in `request-detail-banner` word for word, with the form left open and its reason kept: `Only an approved booking can be cancelled.` and `A booking can be cancelled only while the event is Approved or Planning.` A cancelled booking closes the form, shows `Booking cancelled` and reads the bookings again; the row becomes Cancelled with its reason, and no other row and not the event's status changes (AC5).

| Element | `data-testid` |
|---|---|
| Venue bookings section | `request-detail-bookings` |
| No booking requests | `request-detail-bookings-empty` |
| Booking row | `request-detail-booking-row-<id>` |
| Venue, occupied period, status | `request-detail-booking-venue-<id>`, `request-detail-booking-period-<id>`, `request-detail-booking-status-<id>` |
| Cancel reason (Cancelled row) | `request-detail-booking-cancel-reason-<id>` |
| Cancel booking button (Approved row, assigned coordinator, event Approved or Planning) | `request-detail-booking-cancel-button-<id>` |
| Withdraw button (Requested row, the event's assigned Coordinator, whoever raised it) | `request-detail-booking-withdraw-button-<id>` |
| Venue unavailable marker (Approved row a block overlaps, SCRUM-82) | `request-detail-booking-unavailable-<id>` |
| Cancel booking form | `request-detail-booking-cancel-form` |
| Reason, and the message under it | `request-detail-booking-cancel-reason-input`, `request-detail-booking-cancel-reason-error` |
| Confirm cancel and Cancel buttons | `request-detail-booking-cancel-confirm-button`, `request-detail-booking-cancel-cancel-button` |

**Venue unavailable** (SCRUM-82). An Approved row whose booking a block of its venue overlaps (the booking's `venue_unavailable`, derived by the API at every read and never stored) shows a **Venue unavailable** badge beside its Approved badge, in the Danger colour so that it reads apart from the other Approved rows (§12); the status stays Approved. The marker goes when the booking is cancelled, or when the block is removed or ended early so that it no longer overlaps; no other row shows it. When the block is created the event's assigned Event Coordinator is told on the Notifications page with the API's message, `Seminar Room 1, booked for Swap Gala, is unavailable 05 Dec 2026, 11:00 to 05 Dec 2026, 15:00 (Pipe burst).` (the block's period as a block's, §9), naming the event. The venue page does not show which bookings a block marked.

On the venue page, a Cancelled booking stays in Booking requests with its Cancelled badge and its decision cell, and offers no action; it leaves Occupied periods and Current clashes, and the venue-availability page does not show it, since it no longer holds the venue.

On the request page (`request-detail`), SCRUM-36: an Event Coordinator sees a Request venue booking button at the top of the Venues section when the event's status is Approved or Planning; it links to `/requests/:id/bookings/new`, not an inline form, since raising starts a new record the bookings area owns (`docs/design/frontend.md` §2).

| Element | `data-testid` |
|---|---|
| Request venue booking button (only with `bookings.edit`, status Approved or Planning) | `request-detail-raise-booking-button` |

**Venue holds** (SCRUM-84). On the request page, everyone with `venues.view` sees a Venue holds list inside the Venues section, after Venue bookings (an `h3` since SCRUM-83, then a table per §6, or `This event holds no venue.` when there are none). Each row shows the venue, the occupied period the hold covers (the event's period widened by the venue's setup and turnaround time, as the API derives it; `formatPeriod` when it falls on one day, `05 Dec 2026, 09:30–12:30`, else `formatDateTimePeriod`), the expiry (`formatDateTime`) and the status badge, Held, Released or Expired (SCRUM-85). The first cell is plain text, not a link: the venue page lists no holds. The event's assigned Event Coordinator (with `bookings.edit`) sees a **Place hold** button at the top of the Venues section while the event is Approved or Planning, and a **Release** button on each Held row; nobody else sees either, and the API refuses anyone else. Place hold opens an inline form directly below the Venues section's buttons (one inline form at a time, §7) with a Venue select (the active venues, first option `Select a venue`), an Expiry date (`date`) and an Expiry time (`time`), all required, then Cancel and Place hold. An empty field gets its message under it (§5) and nothing is sent. Every other rule is the API's and shows in `request-detail-banner` word for word, with the form left open and its entries kept: the expiry must be in the future and before the event's start, and a conflict names what already holds the venue in the same wording as a refused approval (below). A placed hold closes the form, adds its row and shows `Hold placed`; the request is then read again, since placing the first hold moves an Approved event to Planning. Release shows `Hold released` and the row's badge becomes Released; a refused release shows the API's message and reads the holds again.

**Hold expiry** (SCRUM-85). A Held hold becomes Expired at its expiry without anyone acting: the next page load after it shows the Expired badge and no Release (only a Held row offers Release). Expiry does not change the event's status. The event's assigned Event Coordinator is told on the Notifications page, each once, with the API's messages (the expiry as `formatDateTime`, in local time as entered): when 24 hours or less remain, `The hold on Seminar Room 1 for Clock Gala expires 01 Dec 2026, 17:00.`; when it expires, `The hold on Seminar Room 1 for Clock Gala expired 01 Dec 2026, 17:00 and the venue was released.` A hold first seen after its expiry gets only the second; a Released hold gets neither. No new test id: the row's status and Release button keep SCRUM-84's.

| Element | `data-testid` |
|---|---|
| Venue holds section | `request-detail-holds` |
| No holds | `request-detail-holds-empty` |
| Place hold button (assigned coordinator, status Approved or Planning) | `request-detail-place-hold-button` |
| Place hold form | `request-detail-hold-form` |
| Venue select | `request-detail-hold-venue-input` |
| Expiry date, expiry time | `request-detail-hold-expiry-date-input`, `request-detail-hold-expiry-time-input` |
| Message under an empty field | `request-detail-hold-venue-error`, `request-detail-hold-expiry-date-error`, `request-detail-hold-expiry-time-error` |
| Place hold (confirm) and Cancel buttons | `request-detail-hold-confirm-button`, `request-detail-hold-cancel-button` |

SCRUM-82: opened as `/requests/:id?hold=<id>` (venue search's Place hold), the request page opens the Place hold form once, as soon as it would offer Place hold, with that venue already chosen, brought into view with the Venue select focused (§13 pattern A). An unknown or retired venue id, or an account the form is not offered to, is ignored: the page opens normally.
| Hold row | `request-detail-hold-row-<id>` |
| Venue, occupied period, expiry, status | `request-detail-hold-venue-<id>`, `request-detail-hold-period-<id>`, `request-detail-hold-expiry-<id>`, `request-detail-hold-status-<id>` |
| Release button (Held row, assigned coordinator) | `request-detail-hold-release-button-<id>` |

The booking-new page (`booking-new`): a venue picker (`select`, the active venues) and the usual form buttons.

| Element | `data-testid` |
|---|---|
| Back link | `booking-new-back-link` |
| Title | `booking-new-title` |
| Banner | `booking-new-banner` |
| Venue select | `booking-new-venue-input` |
| Message under an empty field | `booking-new-venue-error` |
| Raise (confirm) button | `booking-new-raise-button` |

SCRUM-82: opened as `/requests/:id/bookings/new?venue=<id>` (venue search's Request booking), the venue select starts with that venue chosen and its warnings are checked as if the coordinator had chosen it; they may still choose another. An unknown or retired venue id is ignored and nothing is chosen. Raising is unchanged: it lands on the venue's page with `Venue booking requested`.

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
| Approved booking holding the venue (SCRUM-38) | `booking-new-warning-approved-booking-<id>` (the booking's id) | The venue already holds an approved booking for TC38 Holder, 10 Dec 2026, 14:00–17:00. |
| Another event's Held hold on the venue (SCRUM-84) | `booking-new-warning-hold-<id>` (the hold's id) | The venue is held for Hold Seminar, 05 Dec 2026, 10:00–12:00. |
| Block holding the venue (SCRUM-38) | `booking-new-warning-block-<id>` (the block's id) | The venue is blocked 10 Dec 2026, 13:00 to 10 Dec 2026, 15:00 (Projector replacement). |

SCRUM-38: after the mismatches, one line per approved booking and then per block of the venue that overlaps the event's occupied period, each earliest first; a booking that is not Approved, or a period that only touches the event's occupied period, gives no line. SCRUM-41: the occupied period is the event's own period widened by the venue's setup and turnaround time, and each approved booking is compared by its own occupied period, while a block keeps its own recorded period and is never widened. Each line still shows the holder's own period — `formatPeriod` for a booking and `formatDateTimePeriod` for a block (§9). Like every other line, it does not stop Raise. SCRUM-84: between the approved bookings and the blocks, one line per other event's Held hold whose period overlaps the event's occupied period, showing the holding event's published period with `formatPeriod`; the event's own hold gives no line.

**Venue search** (SCRUM-33). On the request page, an Event Coordinator sees a Search venues button at the top of the Venues section when the event's status is Approved or Planning, beside Place hold and Request venue booking; it links to `/requests/:id/venues/search`. For any other status the button is not shown.

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

**Search-result actions** (SCRUM-82 AC6). Each result row ends with an Action column holding **Request booking** and **Place hold**, links rather than forms, each shown by the same rule as the matching button in the request page's Venues section: Request booking with `bookings.edit` while the event is Approved or Planning, Place hold only to the event's assigned Event Coordinator while it is Approved or Planning (the search reply carries the event's `status` and `assigned_coordinator` for this). Request booking opens `/requests/:id/bookings/new?venue=<id>`; Place hold opens `/requests/:id?hold=<id>`. An account offered neither sees no Action column.

| Element | `data-testid` |
|---|---|
| Request booking (link) | `venue-search-request-booking-button-<id>` |
| Place hold (link) | `venue-search-place-hold-button-<id>` |

**Venue availability** (SCRUM-39). The venue-availability page (`venue-availability`) shows, for a chosen week or a chosen month, every period that currently occupies or might occupy the venue: an Approved booking's occupied period (its published period widened by the venue's setup and turnaround time, the same `occupied_start`/`occupied_end` as Occupied periods above), a Requested booking's own published period, unwidened (AC4 names only an approved booking; a request still awaiting a decision does not yet hold the venue), and a block's own recorded period, never widened (the same rule as everywhere else). SCRUM-84: a Held hold is shown over the period it covers, widened like an Approved booking's, with a Held badge (`statusBadgeClass(STATUS.HOLD.HELD)`), so it reads apart from Approved and Pending; a Released or Expired (SCRUM-85) hold holds nothing and is not shown. The page reads the venue's holds once with its bookings and blocks (`listVenueHolds`). Rejected and Withdrawn booking requests are never shown: they no longer hold or threaten to hold the venue (team decision, 09-10-2026).

It is shown one day at a time (§7's label/value list, reused: the date as `dt`, that day's own entries as `dd`), not one flat table, so a free day reads as "Free" rather than simply being absent — judging dates means seeing the open ones as clearly as the booked ones (AC1). An entry that spans midnight is listed under every day it overlaps, in full, with both its own dates (the same `formatDateTimePeriod` text each time): a calendar is exactly the place a booking crossing into the next day is expected to appear on both. Within a day, entries are earliest start first; every entry carries a status badge — Approved (`statusBadgeClass(STATUS.BOOKING.APPROVED)`) or Pending (`statusBadgeClass(STATUS.BOOKING.REQUESTED)`) for a booking, Block (its own neutral badge, not a state-model.md status) for a block — so a Requested booking reads as pending at a glance beside an Approved one (AC5).

The page opens to the current week (Monday to Sunday), "current" read from the browser's own clock: this default is a cosmetic starting point only, never a rule the API enforces, so it is the one place in the front end allowed to read the time itself rather than through `app/format.js` or the API. Week and Month are two buttons, not a form; switching recomputes the displayed days from the same anchor date. Previous and Next move the anchor by one week or one month, matching whichever is selected. The page reads the venue's bookings and blocks once, from the same two lists `venue-detail` already calls (`listVenueBookings`, `listVenueBlocks`) — neither API filters by date, so there is nothing to re-read on navigation; the displayed days only change which already-loaded entries the page shows against each one.

| Element | `data-testid` |
|---|---|
| Back link (to `venue-detail`) | `venue-availability-back-link` |
| Title (the venue's name) | `venue-availability-title` |
| Displayed range, `formatDate` on each end (`06 Oct 2026 to 12 Oct 2026`; a month is its first day to its last, e.g. `01 Oct 2026 to 31 Oct 2026`) | `venue-availability-range` |
| Week / Month buttons | `venue-availability-week-button`, `venue-availability-month-button` |
| Previous / Next buttons | `venue-availability-prev-button`, `venue-availability-next-button` |
| Day group (one per displayed day, `<date>` its ISO date) | `venue-availability-day-<date>` |
| Day heading, `formatDate` | `venue-availability-day-heading-<date>` |
| Free day (no entry overlaps it) | `venue-availability-day-empty-<date>` |
| Entry row (booking, hold or block; `<kind>` is `booking`, `hold` or `block`, `<id>` that record's own id, `<date>` the day group it is shown under; an entry spanning more than one displayed day repeats, once per day, each with its own id this way — Month can show two of its days at once, so the id must still be unique on the page) | `venue-availability-entry-row-<kind>-<id>-<date>` |
| Entry period, `formatDateTimePeriod` | `venue-availability-entry-period-<kind>-<id>-<date>` |
| Entry name (event name for a booking or a hold, reason for a block) | `venue-availability-entry-name-<kind>-<id>-<date>` |
| Entry status (`Approved`, `Pending`, `Held` or `Block`) | `venue-availability-entry-status-<kind>-<id>-<date>` |

**Equipment inventory** (SCRUM-49). The equipment page (`equipment`) lists every recognised equipment type, its description, storage location and total units, a plain table per §6, reachable with `equipment.view` — Technical Support Staff and Event Coordinator. The first cell is the type's name as **plain text, not a link**: there is no per-type detail page, so §6's linking rule has nothing to point at (recorded here as the deliberate deviation). Description and storage location are seeded catalogue information, displayed as plain text and never offered as editable fields; an unrecorded value reads `None`. The table columns are Equipment type, Description, Storage location, Total units and Action; the inline editor spans all five columns. The total reads `<n> units` (`5 units`, `0 units`, `1 unit`); a zero total keeps the type listed (AC4 note). Only an account with `equipment.edit` (Technical Support Staff) is offered **Change total** on a row; it opens an inline form as its own row directly below that row (the §7.13 per-row rule): a `number` input with **no native `required` or `min`**, the form `noValidate` like every other form (so a typed fraction reaches the server and the API's refusal is what shows), a blank caught by the page's own required check with a message under the field and nothing sent, then Save and Cancel. It is the page's only inline form, so one-form-at-a-time holds trivially. A refusal appears in `equipment-banner` word-for-word with the form left open and its entry kept, and nothing stored changes — a reduction below the reservation minimum shows the API message naming the required total. A successful save closes the form, shows `Total units updated` as the success banner and reads the list again: **that acknowledgment never depends on the refresh**, and a refused refresh replaces the table with an unavailable notice and a Reload control instead of leaving previous rows looking current (the SCRUM-41 rule, ids below). While a save and its follow-up refresh are pending, the stock input, Save, Cancel and every row's Change total button are disabled, so a pending save cannot close a newly opened editor. An initial inventory read failure also shows the error banner and the unavailable notice with Reload; it is not shown as an empty inventory. A late reply from a discarded initial load cannot replace the current inventory or show an obsolete error. If the current account loses `equipment.edit`, an already-open editor is hidden along with the change controls; the API remains the authority. Coordinator viewing needs no narrower rule than the page itself.

| Element | `data-testid` |
|---|---|
| Title (`Equipment inventory`) | `equipment-title` |
| Banner | `equipment-banner` |
| Row | `equipment-row-<id>` |
| Type name (plain text) | `equipment-name-<id>` |
| Description (plain text; `None` when unrecorded) | `equipment-description-<id>` |
| Storage location (plain text; `None` when unrecorded) | `equipment-location-<id>` |
| Total units, `<n> units` (`1 unit`) | `equipment-units-<id>` |
| Change total button (only with `equipment.edit`) | `equipment-edit-button-<id>` |
| Inline form input | `equipment-edit-units-input` |
| Message under an empty field | `equipment-edit-units-error` |
| Save and Cancel buttons | `equipment-edit-save-button`, `equipment-edit-cancel-button` |
| No equipment types | `equipment-empty` |
| Unavailable notice and its Reload control (after an initial read or refresh failure) | `equipment-unavailable`, `equipment-reload-button` |

**Equipment requirements** (SCRUM-48). Two pages record what an event needs without touching stock or reservations. The scoped index (`equipment-requests`, route `/equipment-requirements`, nav "Equipment requests") lists only the events this account may read requirements for — the assigned Coordinator's non-Draft events, every non-Draft event for Technical Support Staff — each a link with `formatPeriod` timing and its status badge; it is Technical Support's real entry point and grants no `requests.view`. The detail page (`equipment-requirements`, route `/requests/:id/equipment`) shows the event name and status badge, `formatPeriod` timing, its Approved venue bookings or "No Approved venue bookings.", and the recorded requirements or "No equipment requirements."; an Event details link appears only where the account also holds `requests.view`. Each requirement row shows type, quantity, optional technical text (`None` when blank) and its status badge. Add, Change and Remove appear only with `equipment.requirements.edit` while the event is Approved or Planning; Change and Remove only on a Requested row; the type cannot change on edit. One inline form or confirmation at a time, directly below its row (Add below its trigger), `useReveal` (Cancel focused for a removal), `noValidate`, required-field messages only under the field, server refusals in the banner (§4). A refusal keeps the typed values and the stored row; a success updates the list, closes the form and announces the action (§13). Recording a requirement never checks stock and never creates a reservation. A late reply to a discarded load or mutation never replaces the event on screen. SCRUM-86/87 integration must recheck assignment transitions, not relax the Approved/Planning rule.

| Element | `data-testid` |
|---|---|
| Index title (`Equipment requests`) | `equipment-requests-title` |
| Index event link | `equipment-requests-event-<id>` |
| Index event status badge | `equipment-requests-status-<id>` |
| Index empty | `equipment-requests-empty` |
| Detail title (`Equipment requirements`) | `equipment-requirements-title` |
| Event status badge | `equipment-requirements-status` |
| Event timing, `formatPeriod` | `equipment-requirements-timing` |
| Event details link (only with `requests.view`) | `equipment-requirements-event-link` |
| Approved venue booking | `equipment-requirements-venue-<bookingId>` |
| No Approved venue bookings | `equipment-requirements-no-venues` |
| Requirement row | `equipment-requirements-row-<id>` |
| Type name | `equipment-requirements-type-<id>` |
| Quantity | `equipment-requirements-quantity-<id>` |
| Technical text (`None` when blank) | `equipment-requirements-technical-<id>` |
| Requirement status badge | `equipment-requirements-status-<id>` |
| No requirements | `equipment-requirements-empty` |
| Check availability button on a requirement (only with `equipment.check`; SCRUM-50) | `equipment-requirements-check-<id>` |
| Check result for that requirement, the period it was checked for, total, reserved for the period, out of service, available, and the verdict (`Covered: the N requested are available.` or `Short by N: M requested, K available.`) | `equipment-requirements-check-result-<id>`, `-period-<id>`, `-total-<id>`, `-reserved-<id>`, `-out-of-service-<id>`, `-available-<id>`, `-verdict-<id>` |
| Add button | `equipment-requirements-add-button` |
| Change and Remove buttons | `equipment-requirements-edit-<id>`, `equipment-requirements-remove-<id>` |
| Inline form | `equipment-requirements-form` |
| Type, quantity and technical inputs | `equipment-requirements-type-input`, `equipment-requirements-quantity-input`, `equipment-requirements-technical-input` |
| Save, Cancel and Remove-confirmation buttons | `equipment-requirements-save-button`, `equipment-requirements-cancel-button`, `equipment-requirements-confirm-remove-button` |

Banner uses the shared page prefix (§4). Forms and rows use existing card and list styles; no new visual tokens.

**Notifications** (SCRUM-58). The notifications page (`notifications`) lists this account's own notifications only, newest first, each showing when it was created (`formatDateTime`, §9), its message, and Unread or Read as a badge (its own neutral/info pair, not a state-model.md status — read is a flag, not a transition). A notification's event is named, and opening it navigates there, only when this account may open that event's own page (the same rule `request-detail` itself uses); otherwise nothing about the event is shown beyond the message (AC6) — not even its name. "Opening" a notification is the single action that marks it read, nothing else does: clicking its event name when one is shown, or its own Open button when none is (there is then nowhere to navigate to, so the button exists only to mark it read). Either one marking an already-read notification is a no-op — the row was already Read, and stays so (AC4). Mark all as read marks every currently unread row read in one action (AC5); no row's own control is needed first. No notifications is one sentence instead of the list, same as any other empty list (§6).

| Element | `data-testid` |
|---|---|
| Title | `notifications-title` |
| Banner | `notifications-banner` |
| Mark all as read button | `notifications-mark-all-button` |
| No notifications | `notifications-empty` |
| Row | `notifications-row-<id>` |
| Created at, `formatDateTime` | `notifications-created-at-<id>` |
| Message | `notifications-message-<id>` |
| Read state (`Unread` or `Read`) | `notifications-status-<id>` |
| Event name (link; shown only when this account may open that event) | `notifications-event-<id>` |
| Open button (shown only when no event is named) | `notifications-open-button-<id>` |

The nav's unread count (§2, `layout-nav-notifications-count`) comes from `GET /api/notifications/unread-count`, read once at login alongside `/api/me` and re-read after marking one or all read, so every page's count stays current without polling.

## 8. Not-permitted page

- One sentence saying the account cannot open this page, and a link home (§1).
- Test ids: `not-permitted-message`, `not-permitted-home-link`.

## 9. Dates, times and status text

- Dates are shown as `03 Oct 2026`; times as `14:30` (24-hour). Date and time together: `03 Oct 2026, 14:30–16:00`. A moment something happened (submitted, decided): `03 Oct 2026, 14:30`, in UTC as the API sends it. A period that may span days (a venue block): `20 Oct 2026, 09:00 to 21 Oct 2026, 18:00`, both ends in full even on the same day, in local time as entered. The API sends ISO values; pages format them with `formatDate`, `formatTime`, `formatPeriod`, `formatDateTime` and `formatDateTimePeriod` from `app/format.js` (`frontend.md` §7) and never by hand.
- Status text is the `STATUS` constant from `app/format.js`, whose values are the exact words in `state-model.md`. Pages never type a status string.

## 10. Test ids, summary

- Every input, button, link that acts, banner, banner dismiss control, title, back link, row, status, flag and empty message has a `data-testid`. The banner's ids are `<page>-banner` and `<page>-banner-dismiss` (§4).
- Format `<page>-<element>`, kebab-case, `<page>` from §1 (`layout` for the layout).
- Tests find elements by test id only; text is asserted, never used to find an element.
- Renaming a test id changes every test that uses it: update those tests in the same pull request.

## 11. Review checks (per pull request that touches a page)

1. Every element in §10 has a test id matching the patterns here.
2. Refusals show the API's message; nothing fails silently.
3. Controls the account cannot use are hidden, and the page still shows a refusal if the API says no.
4. Status and flag text come from `STATUS`; dates and times from `app/format.js`; colour never stands alone.
5. The page follows the §3 order; no modal, overlay or browser dialog anywhere.
6. Every action's response is visible without scrolling (§13).

## 12. Look

How pages look (tokens, type, spacing and the shared classes) is in `visual-style.md`; pages use its classes and never style a pattern by hand. The one product decision it leaves here is which status gets which colour. A status is shown as a badge, the status text itself on a tint of its colour; colour never stands alone (§6). Pages get the class from `statusBadgeClass(status)` in `app/format.js`, keyed by the `STATUS` constants.

| Status | Badge colour |
|---|---|
| Draft | Neutral |
| Submitted | Info |
| Approved | Success |
| Planning | Warning |
| Safety Check | Warning |
| Confirmed | Success |
| Rejected | Danger |
| Cancelled | Danger |
| Completed | Neutral |
| Requested | Info |
| Withdrawn | Neutral |
| Held | Warning |
| Released | Neutral |
| Expired | Danger |
| Venue unavailable (a flag on an Approved booking, not a status) | Danger |

A status not in this table is neutral until a story adds its row here. Requested and Withdrawn are a venue booking request's own statuses (state-model.md); its Approved, Rejected and Cancelled (SCRUM-83) reuse the colours already above. Held and Released are a venue hold's (SCRUM-84): Held is Warning so that a hold reads apart from an Approved booking (Success) and a Pending one (Info) on the availability page. Expired (SCRUM-85) is Danger, so a lapsed hold reads apart from Held and Released. Venue unavailable (SCRUM-82) is a flag, shown beside the Approved badge with `VENUE_UNAVAILABLE_BADGE` from `app/format.js`; Danger so it reads apart from Approved's Success.

## 13. Feedback at the point of action

**Every action gets a visible response where the user is looking.** When a control opens a form, asks for confirmation, or changes what the page shows, that response appears next to the control or is brought into view, and keyboard focus moves to it (the first field of a form, or the confirmation). A user never has to scroll or search to learn what their click did. Messages follow §4.

A page picks one of these patterns for each control. They are built with `useReveal` and `useRevealError` from `app/reveal.js` (`frontend.md` §7), which scroll only as far as needed and stop clear of the sticky header.

| Pattern | Use it for | What happens |
|---|---|---|
| **A. Inline form** | An action that needs fields (Edit, Update venue, Block venue, Place hold, Change total, a reason) | The form opens directly below its trigger, in its place, or as the row below a per-row trigger (§7). It is brought into view and its first field is focused. Switching to another form or row brings that one into view too. |
| **A′. Inline confirmation** | An action that only needs a yes or no (Delete draft) | Opens as pattern A, with the Cancel button focused, so a stray Enter does not confirm. Still no modal or browser dialog (§7, §11). |
| **B. Refreshed results** | An action that replaces a list below it (Apply on venue search) | The new results are brought into view; focus stays on the control, so the user can change the filter and apply again. The page's first load scrolls nothing. |
| **C. Refused required fields** | A form's own required-field check (§5) | The first field with a message is brought into view and focused, on every refused submit. A refusal from the API goes to the banner (§4), which is always in view. |
| **D. Act at once** | An action with no form (Submit, Send for safety check, Remove, Withdraw, Release, Mark as read) | The change shows where the action was (the row, its badge or the status), and the banner (§4) says what happened. Nothing moves. |

A control that leaves the page (a link, or an action that navigates) needs none of these: the next page opens at its top, with its banner (§4).

## SCRUM-81 — Equipment review on the existing requirement page

Each requirement shows the current decline reason and arrangement note (`None`
when blank), and the latest decision as `<username> — <UTC moment>` using
formatDateTime, or `Not yet reviewed`. Technical Support (`equipment.requirements.review`)
sees Approve/Decline for Requested, Decline for Approved, Approve for Declined,
only in Approved/Planning and with no unreleased reservation. Reserved rows show
`Review decision locked while equipment is reserved.` Notes can be changed in
Approved/Planning regardless of requirement status or reservation. SCRUM-81 itself adds no Reserve
button; SCRUM-51 adds the reservation actions described below. Assigned Coordinators see the same recorded outcomes, not the
Technical Support controls. Existing scoped event visibility remains unchanged.

One inline form at a time across Coordinator and Technical Support actions.
Approve opens confirmation, Decline opens a required-reason textarea, and
Change arrangement note opens its own textarea. Forms use noValidate, useReveal
and existing shared classes; API errors appear only in the banner, required-field
errors beside the required reason. Refusals retain typed values. All action
controls are disabled during a write; an opened editor is hidden if its current
permission/state/reservation guards no longer permit it. A success applies the
returned row, closes the form and announces `Equipment requirement approved`,
`Equipment requirement declined` or `Arrangement note updated`. No dependent
read is needed to acknowledge a successful write.

All ids below start `equipment-requirements-`:

| Element | Suffix |
|---|---|
| Current decline reason | `decline-reason-<id>` |
| Arrangement note | `note-<id>` |
| Latest reviewer and decision time | `decision-<id>` |
| Reservation lock explanation | `review-locked-<id>` |
| Approve / Decline / Change arrangement note | `approve-<id>`, `decline-<id>`, `edit-note-<id>` |
| Review/note inline form | `review-form` |
| Decline reason / arrangement note input | `review-reason-input`, `review-note-input` |
| Required reason error | `review-reason-error` |
| Confirm / Cancel | `review-save-button`, `review-cancel-button` |


## SCRUM-51 — equipment reservations on the requirements page

The existing `/requests/:id/equipment` page shows an Equipment reservations
section below Recorded requirements. Context reads include `reservations` in id
order. Both scoped readers see type, quantity, `formatPeriod` timing and Reserved
or Released status. Empty wording: `No equipment reservations.` This section is
part of the authoritative context load; a failed load never invents an empty list.

With `equipment.reserve`, only in Approved/Planning, an Approved unreserved
requirement offers Reserve. A Reserved history row offers Release. Both open a
single inline confirmation beside the trigger; Cancel is focused by useReveal.
There is no quantity or period input. Opening any action replaces the page's
other inline form. All action buttons are disabled while a mutation is pending.
On success, apply the returned reservation and derived requirement lock flag,
close the form, invalidate pending availability replies and clear the earlier result, and announce `Equipment
reserved` or `Equipment reservation released`. No follow-up read is required to
acknowledge the committed write. Refusals stay in the existing banner and keep
the confirmation open. Discard replies after leaving the route. Losing reserve
permission hides an open reservation confirmation. Server access checks remain
authoritative. Reloading reads persisted history. No new page/nav item.

All ids below start `equipment-requirements-`:

| Element | Suffix |
|---|---|
| Reserve on requirement | `reserve-<requirementId>` |
| Reservation row | `reservation-<reservationId>` |
| Reservation period | `reservation-period-<reservationId>` |
| Reservation status | `reservation-status-<reservationId>` |
| Release on reservation | `release-<reservationId>` |
| Empty history | `reservations-empty` |
| Inline confirmation | `reservation-form` |
| Confirm action | `reservation-save-button` |
| Cancel | `reservation-cancel-button` |

## SCRUM-63 — decision notices on the Notifications page

The event's assigned Event Coordinator at the moment of the decision is told
on the Notifications page (§7, SCRUM-58), with the event named, once per
decision. No new page, element or test id: each notice is a
`notifications-row-<id>` whose `notifications-message-<id>` is the API's text,
word for word. Periods are a booking's or a reservation's own (`formatPeriod`,
§9), never the occupied period widened by setup and turnaround.

| Decision | Message |
|---|---|
| Booking approved | `Venue booking approved for Annual Gala: Venue A, 15 Dec 2026, 10:00–12:00.` |
| Booking rejected | `Venue booking rejected for Annual Gala: Venue A, 15 Dec 2026, 10:00–12:00.` then, for whichever was suggested (SCRUM-78), ` Suggested venue: Venue B.` and ` Suggested period: 15 Dec 2026, 13:00–15:00.`, then ` Reason: <reason>` |
| Equipment approved | `Equipment decision for Annual Gala: Projector × 2 Approved.` |
| Equipment declined | `Equipment decision for Annual Gala: Projector × 2 Declined. Reason: <reason>` |
| Equipment reserved | `Equipment reserved for Annual Gala: Projector × 2, 15 Dec 2026, 10:00–12:00.` |
| Equipment released | `Equipment released for Annual Gala: Projector × 2, 15 Dec 2026, 10:00–12:00.` |

A correction of an equipment decision (SCRUM-81) is a new decision and sends a
new notice. An event with no assigned coordinator tells nobody; a refused
decision, a withdrawal (SCRUM-77) and an arrangement note tell nobody.

## SCRUM-62 — request notices on the Notifications page

The Event Organiser who created the request is told on the Notifications page
(§7, SCRUM-58), with the event named, once per action. No new page, element or
test id: each notice is a `notifications-row-<id>` whose
`notifications-message-<id>` is the API's text, word for word. The event is
named as it is when the action happens, so a resubmission under a new name
uses the new one.

| Action | Message |
|---|---|
| Submitted, a Draft submitted, or resubmitted (SCRUM-28, SCRUM-72) | `Your request "Annual Gala" was received.` |
| Coordinator assigned (SCRUM-86's notice) | `coord1 has been assigned to your event "Annual Gala".` |
| Coordinator reassigned (SCRUM-44's notice, naming the new coordinator) | `coord2 has been assigned to your event "Annual Gala".` |
| Approved | `Your request "Annual Gala" was approved.` then, when a reason was given, ` Reason: <reason>` |
| Rejected | `Your request "Annual Gala" was rejected. Reason: <reason>` |
| Clarification requested (SCRUM-45; told to the Organiser) | `Clarification was requested on your request "Annual Gala".` |
| The Organiser replied (SCRUM-45; told to the request's assigned coordinator) | `org2 replied to your clarification request on "Annual Gala".` |

Saving or editing a Draft and any refused action tell nobody. The two clarification
notices are SCRUM-45's; the reply notice goes to the coordinator the request is
assigned to when the Organiser replies.

## SCRUM-66 — Completion on Request detail

Only the assigned Coordinator with `requests.complete` on a Confirmed event sees
Mark as Completed. The browser does not compare wall clocks: the API validates
the end. Open an inline confirmation, focus Cancel via `useReveal`, disable both
buttons during submission. Refusal stays in the form with the API message.
Success updates the detail status and shows actor/time; reload preserves it.
Late replies after navigation are discarded. Completed events show no completion
action, but permitted readers can still open the detail.

| Element | data-testid |
|---|---|
| Open completion | request-detail-complete-button |
| Confirmation form | request-detail-complete-form |
| Cancel confirmation | request-detail-complete-cancel-button |
| Confirm completion | request-detail-complete-confirm-button |
| Refusal | request-detail-complete-error |
| Completion actor and time | request-detail-completion-details |

SCRUM-66 v2: display the completion date, time and explicit UTC suffix. Render
no completion section when neither details nor an action is available. Completed
events remain in the assigned Coordinator's general Requests list as historical
records; the active assignments list/counts exclude them.

## SCRUM-65 — Cancel event on Request detail

The assigned Coordinator with requests.cancel sees **Cancel event** only in
Submitted, Approved, Planning, Safety Check or Confirmed. The inline form has a
required Cancellation reason textarea, **Keep event** (dismiss) and **Confirm
cancellation**. It warns that commitments will be released and the action cannot
be undone. Focus the reason through useReveal. noValidate delegates validation
to the server, including whitespace-only input; a refusal stays in the form
with its entered reason and API message. Disable all form controls while pending.

The form shares Request detail's openAction with completion and existing actions:
opening one closes the others. Success updates the event and re-fetches bookings
and holds; stale earlier reads are discarded by the existing effect cleanup.
Suppress standalone withdraw/release controls immediately when Cancelled. Late
cancellation responses after event navigation/unmount cannot replace the current
record. Both lifecycle components retain standalone uncontrolled behaviour for
focused tests; the real page uses the shared action state.

Authorised readers see **Cancelled by <username> at <date, time> UTC** and the
reason, retained after reload/reopening. Use formatDateTime with explicit UTC,
matching SCRUM-66. No empty cancellation region if neither metadata nor an action
exists. Organisers have no direct Cancel event control. Cancelled history remains
readable, but no resubmit/reopen/planning actions are offered. A new request is
required to organise the event again. Cancellation notifications are SCRUM-64.

| Element | data-testid |
|---|---|
| Open event cancellation | request-detail-cancel-button |
| Inline form | request-detail-cancel-form |
| Reason | request-detail-cancel-reason-input |
| Keep event / dismiss | request-detail-cancel-dismiss-button |
| Confirm cancellation | request-detail-cancel-confirm-button |
| Refusal | request-detail-cancel-error |
| Cancellation actor/time and reason group | request-detail-cancellation-details |
| Recorded reason | request-detail-cancellation-reason |

Messages: `Cancellation reason is required.`; `Cancellation reason must be text.`;
`A JSON object containing reason is required.`; protected write `Event request
not found.`; wrong role `You do not have permission to perform this action.`;
wrong stage `Only a Submitted, Approved, Planning, Safety Check or Confirmed
event can be cancelled.` No modal or new page is introduced.

## SCRUM-47 — Edit event on Request detail

The event's assigned Event Coordinator sees **Edit event** while the event is
Submitted, Approved, Planning, Safety Check or Confirmed; nobody else does
(the Organiser, the Lead, another coordinator), and a Draft, Rejected,
Completed or Cancelled event shows no Edit event. It opens an inline form with
the same fields, order and labels as the Draft edit form (§7), filled with the
event's values; the layout, facilities and accessibility features come from
`/api/venue-options`. **Save** sends the form; **Cancel** closes it unchanged.
noValidate: every rule is the API's, and a refusal stays in the form with the
entered values and the API's message. Success closes the form, shows the
event as it now is and the success banner `Event updated`. The form shares
Request detail's openAction, like completion and cancellation.

The assigned coordinator also sees **Change record**: one line per significant
change, oldest first, `<Field>: <old> → <new>, by <username> at <date, time> UTC`
(dates and times formatted as in §9, an empty value as `None`), or
`No significant changes recorded.` Ordinary changes have no line.

| Element | data-testid |
|---|---|
| Open the form | request-detail-event-edit-button |
| Inline form | request-detail-event-edit-form |
| A field | request-detail-event-edit-<field>-input, field in kebab-case (name, purpose, description, date, start-time, end-time, attendance, equipment-requirements, registration-needs, layout) |
| A checkbox | request-detail-event-edit-facilities-<option>-input, request-detail-event-edit-accessibility-features-<option>-input (option in kebab-case, §5) |
| Cancel | request-detail-event-edit-cancel-button |
| Save | request-detail-event-edit-confirm-button |
| Refusal | request-detail-event-edit-error |
| Change record | request-detail-change-record |
| One change (its field in `data-field`) | request-detail-change-record-entry |
| No changes yet | request-detail-change-record-empty |

Messages: the submission messages (`Missing required fields: …`, `Date cannot be
earlier than today.`, `Start time must be before the end time.`, `Attendance must
be a positive whole number.`); `A significant change to an event in Safety Check
or Confirmed needs an accepted change request.`; `Release the held venue before
changing the event's date or times.`; `Only a Submitted, Approved, Planning, Safety
Check or Confirmed event can be edited.`; protected write `Event request not
found.`; wrong role `You do not have permission to perform this action.`

## SCRUM-61 — Too small and Timing mismatch

Two flags (state-model.md, SCRUM-61), each a badge beside the status badge,
never in its place: **Too small** (`TOO_SMALL`, Danger) and **Timing mismatch**
(`TIMING_MISMATCH`, Warning), from `app/format.js`. The API derives both at every
read; the page shows a badge only when the row's flag is true, and the status
badge beside it keeps its own text.

| Where | Element | data-testid |
|---|---|---|
| Request page, Venue bookings row | Too small, Timing mismatch | request-detail-booking-too-small-<id>, request-detail-booking-timing-mismatch-<id> |
| Request page, Venue holds row | Too small | request-detail-hold-too-small-<id> |
| Venue page, Booking requests row | Too small, Timing mismatch | venue-detail-booking-too-small-<id>, venue-detail-booking-timing-mismatch-<id> |
| Safety check card, an Approved booking | Too small, beside its maximum capacity | request-detail-safety-booking-<id>-too-small |
| Equipment page, a reservation | Timing mismatch | equipment-requirements-reservation-timing-mismatch-<id> |

`request-detail-hold-status-<id>`, `venue-detail-booking-status-<id>`,
`request-detail-safety-booking-<id>-capacity` and
`equipment-requirements-reservation-status-<id>` are on the status (or capacity)
text itself, so they read the status alone whatever badge is beside it.
