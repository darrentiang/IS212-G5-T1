# Visual style

How the product looks. One page, portable: every value here is a token in `frontend/src/index.css`, and pages use the shared classes built from them instead of writing their own styling. Behaviour, layout rules and test ids live in `ui-guidelines.md`; this file is only the look.

| Version | Date | Change |
|---|---|---|
| 1.0 | 25-09-2026 | Initial style |
| 1.1 | 24-09-2026 | Form card |
| 1.2 | 08-10-2026 | Warning list (`.warning-list`) |
| 1.3 | 15-10-2026 | Page banner (`.banner`): tint over the surface rather than transparent, `--shadow-md`, a dismiss control |

## Principles

1. **Quiet by default.** Near-black text on white and very light grey. Colour appears only where it means something: one accent for focus and the current place, and status colours.
2. **Whitespace does the grouping.** Space separates sections before borders do; a border is a hairline, a shadow is barely there.
3. **One primary action per view.** It is the only solid dark button on the screen.
4. **Type carries hierarchy.** Large, tight, semibold titles; small secondary text in grey. No decorative fonts, no icons for decoration.
5. **Everything feels immediate.** 150 ms transitions on colour, border and shadow; a button presses in slightly.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--color-text` | `#1d1d1f` | Body and headings |
| `--color-text-secondary` | `#6e6e73` | Labels, hints, table headers, empty states |
| `--color-bg` | `#fafafa` | Page background |
| `--color-surface` | `#ffffff` | Cards, tables, inputs, top bar |
| `--color-surface-muted` | `#f5f5f7` | Table header row, hover fills |
| `--color-border` | `#e5e5ea` | Hairlines around cards, inputs, tables |
| `--color-divider` | `#f0f0f2` | Lines between table rows |
| `--color-accent` | `#0071e3` | Focus ring, current nav item, links on hover. Nothing else |
| `--color-info` | `#0071e3` | Status: waiting on someone else |
| `--color-success` | `#1f9d55` | Status: approved, confirmed, success banner |
| `--color-warning` | `#c77700` | Status: in progress, needs attention |
| `--color-danger` | `#d70015` | Status: rejected, cancelled; errors; destructive actions |
| `--color-neutral` | `#6e6e73` | Status: draft, completed, anything inactive |
| `--font-sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif` | Everything |
| `--radius-control` | `8px` | Buttons, inputs |
| `--radius-card` | `12px` | Cards, tables, banners |
| `--radius-pill` | `999px` | Badges, filter pills |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)` | Cards, tables |
| `--shadow-md` | `0 2px 4px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.08)` | Primary button on hover |

## Type scale

| Role | Size / weight | Extra |
|---|---|---|
| Page title | 28px / 600 | letter-spacing −0.02em |
| Section title | 17px / 600 | letter-spacing −0.01em |
| Body | 15px / 400 | line-height 1.5 |
| Label | 13px / 500 | secondary colour |
| Small / table header | 12px / 600 | uppercase, letter-spacing 0.05em, secondary colour |

## Spacing

A 4px grid. Card padding 24px; 32px between page sections; 16px between fields; page gutter 16px on phones, 24px from tablet up; content width at most 1100px, centred.

## Components

| Pattern | Look |
|---|---|
| **Top bar** | Sticky; white at 80% opacity with a 12px backdrop blur; hairline bottom border; product name in semibold on the left; nav links 14px/500 secondary grey, the current one in the accent colour on a 6% accent fill; account name and roles on the right in 13px grey |
| **Primary button** | Solid `--color-text`, white text, 15px/500, 8px radius, 8×16 padding; hover a lighter near-black with `--shadow-md`; pressed scales to 0.98; disabled 50% opacity |
| **Secondary button** | White, hairline border, secondary text; hover fills `--color-surface-muted` and darkens the text |
| **Destructive button** | Danger text on a 6% danger fill, hairline danger border; hover goes solid danger with white text |
| **Input / select / textarea** | White, hairline border, 8px radius, 10×12 padding, 15px; focus: accent border plus a 3px ring of the accent at 15% |
| **Field error** | 13px danger text directly under the field |
| **Form card** | Max 720px wide; related short fields (date and times) share a row from tablet up |
| **Card** | Surface, hairline border, 12px radius, `--shadow-sm`, 24px padding |
| **Table** | Inside a card, no outer border of its own; header row on `--color-surface-muted` in the small uppercase style; rows 15px with `--color-divider` lines, 12×16 padding; row hover fills `rgba(0,0,0,.02)`; the linking cell in text colour, accent on hover |
| **Badge** | Pill, 12px/600, the status colour as text on a 10% tint of the same colour, no border |
| **Banner** | 12px radius, 12×16 padding, 14px text; error: danger tint with a 3px danger left edge; success: success tint with a 3px success left edge. The tint is mixed over `--color-surface`, not transparent, because the page banner (`.banner`) sticks over content below the header with `--shadow-md`; its dismiss control is a 24px secondary-text × at the right |
| **Warning list** (`.warning-list`) | Banner shape with a warning tint and a 3px warning left edge; a semibold heading line, then a bulleted list. For warnings that do not stop an action (SCRUM-42) |
| **Empty state** | Centred, 48px vertical padding, secondary 15px text, optional action below |
| **Focus** | Every interactive element: 2px accent outline, 2px offset, on keyboard focus only (`:focus-visible`) |

## Don't

Gradients. More than one accent. Coloured primary buttons. Shadows darker than `--shadow-md`. Borders thicker than 1px (except the banner edge). Icon libraries or decorative images. Text below 12px. Hand-written button, input, table, badge or banner styling where a shared class exists.

## How it is built

Tailwind v4. The tokens sit in one `@theme` block and the patterns above in `@layer components` in `frontend/src/index.css`, the only CSS file. Page markup uses those classes for every pattern this page covers, and Tailwind utilities only for layout (flex, grid, gaps, widths). Which status gets which colour is a product decision and lives in `ui-guidelines.md`.
