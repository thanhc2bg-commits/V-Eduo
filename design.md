# Design — V-Connect

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
modern-minimal — calm, technical, learner-first. Vietnamese UI copy throughout.

## Macrostructure family

- Marketing pages: Catalog (home / courses / roadmaps catalogue) + Search + Marquee Hero allowances.
- App pages (me/*): **Workbench** — the *me* area is a workspace, not a brochure.
  Per-page fingerprints stay inside the Workbench family and vary on rhythm:
  - `learning.hbs` → Workbench · **continue desk**: one full-width continue panel (big tabular progress) + a ledger list of the rest. Not a 3-equal-card grid.
  - `my-course.hbs`, `my-roadmap.hbs`, `stored-course.hbs`, `trash-course.hbs` → Workbench · **table kit**: single containment card, no index column, row-hover, badge + inline actions.
  - `watch-history.hbs` → Workbench · **timeline**: date-led hairline timeline. Not a bootstrap `list-group`.
- Content pages: Long Document (course show / news).

## Theme (locked · Hallmark Coral — see `tokens.css`)
- `--color-paper`   oklch(97% 0.008 60)
- `--color-paper-2` oklch(94% 0.01 60)
- `--color-rule`    oklch(88% 0.008 60)
- `--color-ink`     oklch(20% 0.012 50)
- `--color-ink-2`   oklch(35% 0.012 50)
- `--color-accent`  oklch(55% 0.19 30)  ← single anchor hue, ≤ 5 % per viewport
- `--color-focus`   oklch(55% 0.19 30)
- `--color-success` oklch(48% 0.12 155) / `--color-success-soft` oklch(94% 0.035 155)
- `--color-danger`  oklch(52% 0.18 25) / `--color-danger-soft` oklch(95% 0.035 25)

## Typography
- Display: ui-sans-serif/system stack, weight 650, tight tracking (−0.04em) — headings only.
- Body: same stack, weight 400 (−0.02em on body is banned).
- Mono: none — this is a UI workspace, not a code surface.
- Type scale anchor: `--text-display` = clamp(2.5rem, 6vw, 5.25rem).
- Tabular numbers (`font-variant-numeric: tabular-nums`) on every data display: progress %, counts, dates.

## Spacing
4-point named scale. Values live in `tokens.css`. Pages must use named tokens
(`var(--space-md)`), never raw values. Section rhythm: each *section break*
≥ `--space-2xl`; never equal padding everywhere.

## Motion
- Easings: `--ease-out` cubic-bezier(0.16, 1, 0.3, 1) → `--ease-in`/`--ease-in-out`.
- Reveal pattern: none on app pages — content is just there. Hover states only.
- Reduced-motion fallback: opacity-only, ≤ 150 ms (already global in `app.scss`).

## Microinteractions stance
- Silent success. No celebratory toasts on visible saves.
- Hover: 2 px lift on cards / rows at 150–220 ms (`--dur-short`). Focus ring appears instantly (`--shadow-focus`).
- Row hover on tables: background `--color-paper-2`, no shadow.

## CTA voice
- Primary CTA: `.me-btn--primary` — fill accent, `--radius-sm`, 44px min-height, label = verb + noun (″Thêm khóa học″, ″Tiếp tục học″), no arrow in button.
- Secondary CTA: `.me-btn--ghost` — paper-2 fill + rule border, same metrics.
- Destructive: `.me-btn--danger-ghost` — danger-soft fill, danger text, same metrics.
- Text link with arrow (→) only for ″continue″ affordances, never for primary actions.

## Per-page allowances
- App pages MUST NOT use decorative enrichment — function carries the page.
- Icons: inline SVG strokes (1.5 px), no emoji as icons.
- Empty states use one inline SVG glyph, title, one-line subtitle, one CTA — left-aligned block (not tombstone-centered).
- No emoji, no gradient text, no glass, no side-stripe cards, no card-in-card (one containment layer: the table/banner, then hairline rows).

## What pages MUST share
- The wordmark / logotype (`site-nav`).
- The accent colour and its placement (≤ 5 % per viewport: CTAs + tracking dots).
- The display + body font stacks.
- The CTA voice (button metrics above).
- Section head rhythm: eyebrow (accent, 700) over display heading over muted single-line desc, actions aligned end on desktop / stacked on mobile.

## What pages MAY differ on
- Macrostructure within the Workbench family (continue desk vs table kit vs timeline).
- Leading element (learning can lead with a continue panel; tables lead with the card).
- Density (learning ledger rows are looser; admin tables are tighter).

## Exports (tokens)
- Inputs: 48 px min-height inside forms, 1 px `--color-rule-2` border, focus = outline 2 px `--color-focus` offset 2 px.
- Table: min-width 46rem, scroll inside `--me-card`; th = muted 700 `--text-xs`; row border = `--color-rule`.

## Source of truth
- `tokens.css` (root-level) — colour / space / type / motion / radius.
- `src/resources/scss/app.scss` § »Me area · Hallmark kit« — the me-page component kit, built on the tokens. Append-only; never split into per-page CSS files.
- Audit gate: a page that drifts from this file gets flagged `stamp-vs-design.md disagreement`.