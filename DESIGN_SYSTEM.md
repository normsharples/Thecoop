# The Coop — design system (Aug 2026 redesign)

Source of truth: the Claude Design canvas **Coop Redesign** — "navy / teal, higher
contrast". This file records how that design maps onto the code so future work
stays on-system.

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
| Primary (navy) | `#1E4A8C` | `primary`, hover `primary-hover` (`#15366B`) |
| Positive (teal) | `#0E7C66` | `success`, tint `success-soft` (`#ECFDF3`) |
| Watch (amber) | `#B54708` | `warning`, tint `warning-soft` (`#FFFAEB`) |
| Off track (red) | `#B42318` | `destructive`, tint `destructive-soft`, edge `destructive-border` |
| Canvas | `#F7F8FA` | `background` |
| Card | `#FFFFFF` | `card` |
| Table header / zebra | `#FAFBFC` | `surface-subtle` |
| Rails, progress tracks | `#EDF0F5` | `surface-sunken` |
| Hairline | `#E4E7EC` | `border` |
| Control edge | `#D0D5DD` | `border-strong` |
| Sidebar slab | `#101828` | `sidebar`, `sidebar-active-bg`, `sidebar-mark` … |
| Chart series | — | `chart-1` … `chart-6` |

Dark mode is derived, not designed — same roles on a navy-slate ground.

## Type

- **Archivo** — everything. `font-sans`.
- **Source Serif 4** — `h1`–`h3`, `CardTitle`, page title. `font-display`.
  Applied automatically to `h1/h2/h3` in `globals.css`.
- Figures use `font-variant-numeric: tabular-nums` (automatic inside `table`,
  or add `.tnum`) so columns line up.
- `.eyebrow` is the 11px uppercase label above stat values and table headers.

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
- `DashboardPage` and `PulsePage` use the new tokens but not the design's exact
  layout (stat hero + 6-up KPI row, by-venue table, flat vital grid).
- Star ratings keep `fill-yellow-400` deliberately — a gold star is a gold star.
