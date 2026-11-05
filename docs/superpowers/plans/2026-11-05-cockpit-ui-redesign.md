# Cockpit UI Redesign Plan

**Goal:** Replace the generic first-draft UI with one coherent visual system
styled as a modern spacecraft cockpit, fix the information architecture, and
ship a vector brand mark with favicons, PWA icons and README artwork.

**Tech stack:** Vue 3, Tailwind CSS 4 (theme tokens), self-hosted fonts via
`@fontsource-variable/host-grotesk` and `@fontsource-variable/jetbrains-mono`,
hand-written SVG.

## Review findings (before)

Screenshots taken with Playwright at 1440x900 and 390x844.

1. **Information architecture.** *Browse mods* opens with 21 tall cards of
   installed mods; search starts ~2000px down (several screens on a phone).
   The dashboard counts installed mods but never lists them. Registry status is
   duplicated on two views.
2. **No single system.** Five button styles (filled cyan, cyan outline, grey
   outline, rose outline, violet outline), three badge styles, boxes nested
   three deep (card > filter card > chips), tracked uppercase labels next to
   sentence-case ones, a different type scale in the details panel, violet for
   updates.
3. **Density and scanning.** One tall card per mod with a single button; a
   `max-h-96` scroll area inside a scrolling page; no row layout to scan.
4. **Details.** "Installed (vv112.0.1)" double prefix; raw ISO timestamp;
   unformatted counts ("31209"); a text "✕" as the close icon; an 11px job
   UUID in the install queue; the header wraps on phones.
5. **Branding.** AI-generated raster logo that is unreadable at 40px;
   favicons are downscaled PNGs.

## Direction

A modern touch-screen cockpit (think crew-capsule displays), not retro
sci-fi: near-black blue ground with a faint cool glow and instrument grid,
hairline panels, bright readouts set in a monospace face, one cyan accent,
amber only for caution and red only for destructive actions. No violet, no
glow on text, no clipped-corner "HUD" frames.

Rules taken from the `design-taste-frontend` skill that apply to an app UI:
one button family (primary, secondary, danger, plus a quiet icon button), one
radius scale, one panel recipe, never a box in a box in a box, sentence-case
13px labels instead of tracked capitals, text contrast 7:1 for reading text
and 4.5:1 for labels, buttons that step on hover and press on click, no
scroll-linked motion, everything at rest under `prefers-reduced-motion`.
Landing-page rules (hero, one section per screen, photographs) do not apply.

## Tasks

1. **Tokens and base styles** (`apps/frontend/src/styles.css`, `main.ts`):
   colour, radius and font tokens in `@theme`; the cockpit ground; shared
   component classes `.btn` (`-primary`, `-secondary`, `-danger`, `-quiet`,
   `-sm`), `.panel`, `.badge` (`-ok`, `-warn`, `-info`, `-accent`),
   `.field`, `.label`, `.readout`; visible focus ring; reduced motion.
2. **Icons** (`components/AppIcon.vue`): one inline SVG set on a 24px grid,
   1.75px stroke: overview, installed, browse, refresh, close, external,
   download, update, trash, search, check, alert, folder, arrow-up.
3. **Shell** (`AppShell.vue`): a fixed left sidebar with the mark, three
   views (*Overview*, *Installed* with a count, *Browse*) and a systems
   status block (service link, KSP version, registry). Below 768px it becomes
   a top bar with the three views in one row. The install queue docks at
   the bottom of the main column.
4. **Overview** (`DashboardView.vue`): a readout strip (KSP version,
   installed mods, updates, registry modules with a relative "updated" time),
   the updates list with *Update* and *Update all*, installation details
   and the registry panel with *Refresh registry*.
5. **Installed** (new `InstalledModsView.vue`): a filterable table of
   installed mods (name, identifier, version, status) with *Update* and
   *Uninstall* in the row. Moved out of *Browse*.
6. **Browse** (`BrowseModsView.vue`, `ModFilterBar.vue`, `ModTable.vue`,
   `ModPagination.vue`): search first, a single filter row, results as
   rows without an inner scroll area, pagination at the foot. Dependency and
   provider dialogs restyled to the shared dialog recipe.
7. **Details and dialogs** (`ModDetailsPanel.vue`, `UninstallDialog.vue`,
   `InstallQueuePanel.vue`, `SetupView.vue`): restyled to the system; fix
   the double "v"; SVG close icon; drop the job UUID line; setup as a
   pre-flight screen.
8. **Brand assets** (`assets/brand/*.svg`, `apps/frontend/public/*`):
   a vector mark (planet, orbit ring, kraken tentacle), `favicon.svg`,
   rasterised `favicon.ico`, 16/32 PNGs, `apple-touch-icon.png`,
   `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, a README banner
   SVG and fresh screenshots; README and manifest updated.
9. **Verification:** update the frontend tests whose copy or structure
   changed, add tests for the new Installed view and the version-prefix
   fix; run lint, typecheck, test and build; check every view in a browser at
   1440 and 390 px, keyboard included.

## Out of scope (noted for later)

- Focus trap for the dependency/provider dialog in *Browse* (restyled only).
- Opening mod details from the *Installed* table (needs a registry lookup by
  identifier).
- A light theme.
