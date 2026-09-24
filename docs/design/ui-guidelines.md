# UI guidelines

What every page shows, how it behaves for the user and the `data-testid` of every element. Test-case rows describe what the user sees on these pages; Playwright tests find elements by the ids defined here, so an id must be predictable from this file alone. How the front end is built lives in `frontend.md`; who may do what in `permissions.md`; status names in `state-model.md`; `/api/me` and refusals in `docs/adr/ADR-002-authorisation.md`. Changing a rule or a test id pattern means changing this file first, in the same pull request.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 16-09-2026 | Initial guidelines | Functional tests for SCRUM-26/27 need stable test ids before the scaffold is built |
| 1.1 | 16-09-2026 | Landing page by permission; page anatomy; loading; inline action forms, no modals; dates, times and status constants; notifications count | The first pages are about to be built by four Developers; these are the choices that would otherwise be made four ways |
| 1.2 | 22-09-2026 | `/venues/new` and `/venues/:id` in §1; a checkbox group for several choices from a fixed list in §5 | SCRUM-31 adds the two pages, and picks facilities and accessibility features from seeded lists rather than free text |
| 1.3 | 24-09-2026 | §12 Look: the visual style and the status-to-colour table; §1 a welcome home page for an account that may open no page | UI refresh: one shared look in `visual-style.md`; Technical Support Staff have no page yet and were landing on the not-permitted page |

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

## 8. Not-permitted page

- One sentence saying the account cannot open this page, and a link home (§1).
- Test ids: `not-permitted-message`, `not-permitted-home-link`.

## 9. Dates, times and status text

- Dates are shown as `03 Oct 2026`; times as `14:30` (24-hour). Date and time together: `03 Oct 2026, 14:30–16:00`. The API sends ISO values; pages format them with `formatDate`, `formatTime` and `formatPeriod` from `app/format.js` (`frontend.md` §7) and never by hand.
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

A status not in this table is neutral until a story adds its row here.
