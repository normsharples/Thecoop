# ORBIT — design system

**ORBIT** — Operations, Rostering, Business insights, Team. Renamed from
"The Coop" in Oct 2026, and rethemed at the same time from navy/teal to the
brand's navy/orange off the ORBIT logo artboard.

Structure and rules come from the Aug 2026 redesign (the Claude Design canvas
*Coop Redesign* — "higher contrast"); only the palette moved. This file records
how the design maps onto the code so future work stays on-system.

## Brand marks

`src/components/brand/OrbitLogo.tsx` holds all three:

- `OrbitWordmark` — the lockup, rocket standing in for the I. Size it with a
  font-size; the rocket scales with the type. This is the ORBIT logo; don't
  re-set the word in plain type beside the rocket.
- `OrbitRocket` — the rocket alone. Body takes `currentColor`, exhaust is
  always ORBIT orange, porthole is cut out (`evenodd`) so it reads on any
  ground. Pass `label={null}` when it sits next to the word.
- `OrbitTile` — rocket in a rounded ink tile, matching the app icon.

`public/favicon.svg` (ink tile) and `public/orbit-mark.svg` (rocket alone) are
the static copies; `coop-clock/public/` carries the same two, and
`coop-agent/assets/` the PNG app + tray icons.

## Where the design lives in code

| Concern | File |
| --- | --- |
| Colour, radius, surface + status tokens | `src/styles/globals.css` |
| Token → Tailwind utility mapping | `tailwind.config.ts` |
| Fonts | `index.html` |
| Primitives (button, card, badge, input, select, table, tabs, popovers) | `src/components/ui/` |
| Shell | `src/components/layout/{Sidebar,Topbar,MobileNav}.tsx` |

## Palette

Semantic tokens only — **never hardcode a Tailwind palette colour**
(`text-amber-600`, `bg-green-500`, …). Every status colour has a token.

| Role | Light | Token / utility |
| --- | --- | --- |
| Primary (ink) | `#121E33` | `primary`, hover `primary-hover` (`#202F4D`) |
| ORBIT orange | `#FF692E` | `brand-accent`, `sidebar-mark`, `chart-2` |
| Orange for type | `#C2410C` | `brand-ink` |
| Focus ring | `#DE4E0E` | `ring` |
| Positive (teal) | `#0E7C66` | `success`, tint `success-soft` (`#ECFDF3`) |
| Watch (gold) | `#A16207` | `warning`, tint `warning-soft` (`#FDF6E3`) |
| Off track (red) | `#B42318` | `destructive`, tint `destructive-soft`, edge `destructive-border` |
| Canvas | `#F6F5F2` | `background` |
| Card | `#FFFFFF` | `card` |
| Table header / zebra | `#FAF9F6` | `surface-subtle` |
| Rails, progress tracks | `#EDEBE5` | `surface-sunken` |
| Hairline | `#E4E1DA` | `border` |
| Control edge | `#D6D3CC` | `border-strong` |
| Ink slab (sidebar, mark tile) | `#0E1726` | `sidebar`, `sidebar-active-bg` … |
| Chart series | — | `chart-1` … `chart-6` |

The neutral ramp was checked against the paper ground in Oct 2026 and left
alone. The text greys are navy-tinted (hue ~220) against a warm canvas (hue
45), which looks like a mismatch written down but is an ordinary paper-and-ink
pairing on screen, and every one of them passes AA on `#F6F5F2`:
`#667085` 4.56:1, `#344054` 9.60:1. `#98A2B3` (2.36:1) is for icons and rails
only — never text on a light ground.

Three rules the orange carries:

1. **Orange is an accent, never a surface for text.** `#FF692E` on white is
   2.9:1 — it fails AA. Fills and marks only. For orange *type* on a light
   ground use `brand-ink` (`#C2410C`, 5.1:1).
2. **Status keeps its own meanings.** Teal is still "on track" and red "off
   track"; watch moved from burnt orange to gold so it never reads as the
   brand colour. Don't recolour status to orange.
3. **Dark mode flips the lead.** On the dark ground the orange carries enough
   contrast, so `--primary` *is* ORBIT orange there (with ink type on it),
   while ink leads in light mode.

Dark mode is derived, not designed — same roles on a deeper ink ground.

## Type

- **Archivo** — everything. `font-sans`.
- **Source Serif 4** — `h1`–`h3`, `CardTitle`, page title. `font-display`.
  Applied automatically to `h1/h2/h3` in `globals.css`.
- Figures use `font-variant-numeric: tabular-nums` (automatic inside `table`,
  or add `.tnum`) so columns line up.
- `.eyebrow` is the 11px uppercase label above stat values and table headers.

## Topbar context line

The page name says where you are; it does not say what you are looking at. So
the topbar carries a second line, set by the PAGE rather than the layout's
title map, through `src/contexts/PageContextLine.tsx`:

```tsx
useSetPageContextLine("Monday 5 October 2026 · against the previous day");
```

Three rules:

1. **Scope, then period, then at most one live count** — in that order,
   separated by middots, in sentence case. "Week of 5 – 11 Oct · 11 shifts
   unpublished".
2. **It never repeats a number the body already leads with.** The dashboard's
   revenue figure is the hero of the page; the context line gives the date it
   belongs to, not the figure.
3. **It is optional.** A page that has no context worth stating sets nothing
   and the line does not render — an empty second line is worse than none.

The line is cleared automatically when the page unmounts.

## Dashboard hierarchy

The dashboard's job is one glance. It carries exactly one hero figure:

- **Hero** — net revenue, 44px/600 at `-0.025em`, tabular, with the period
  delta as a soft-tinted pill beside it. One per screen.
- **Supporting figures** — 24px/600, three across, each with an `.eyebrow`
  label and one line of context (a trend, a status dot, or a count).
- **Everything else** — 15px, in hairline-divided rows, never in its own
  floating card. Six identical cards read as six equal priorities, which is
  the same as none.

Control bars carry three objects at most: the period segment, one stepper for
the chosen period, and the actions (one primary, the rest quiet). The date on
screen belongs in the context line, not in a caption beside the control.

## Rules the design enforces

1. **Borders, not shadows.** Cards and panels are separated by a 1px hairline.
   Elevation is reserved for things that genuinely float — popovers, dropdowns,
   dialogs (`shadow-popover`).
2. **Radius ladder.** 12px cards (`rounded-xl`), 8px controls (`rounded-lg`),
   6px inner chips (`rounded-md`), full pills for status badges.
3. **Status is stated, not animated.** Pulse vital cards carry a 3px coloured
   cap (`.vital-green` / `-amber` / `-red`). Only "off track" still pulses, and
   only when the viewer has not asked for reduced motion.
4. **Brand ≠ chrome.** `BrandTheme` publishes the active brand's colour as
   `--brand-accent` and nothing else. Switching brand recolours the brand mark;
   it must never restyle buttons, focus rings or status colours.

## Known gaps

- `blue-*`, `slate-*`, `purple-*`, `indigo-*` classes still appear in a handful
  of components and have not been tokenised.
- `PulsePage` uses the new tokens but not the design's exact layout (flat
  vital grid). `DashboardPage` and `DailySnapshot` were brought onto the
  hierarchy above in Oct 2026; the remaining dashboard widgets still render as
  equal-weight cards.
- Star ratings keep `fill-yellow-400` deliberately — a gold star is a gold star.
