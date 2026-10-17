# OdrForge Viewer design system: "Sky & Meadow"

Status: **adopted** (2026-10-17). `src/main.tsx` imports `src/design/tokens.css` before `src/styles.css`, which takes every colour, size and duration from it. Icons are drawn inline in the Lucide style (`src/components/Icon.tsx`) instead of adding the `lucide-react` package; the tooltip (§5) is `src/components/Tooltip.tsx`, one instance serving every element's `title`. Inter and JetBrains Mono load from Google Fonts (`index.html`; guarded by `tests/fonts.test.ts`). The top bar's **Map** is the theme's map (`src/map/basemap.ts`): the OSM raster in the light theme and the near-black OpenFreeMap dark vector map in the dark theme, as §3 tunes the lane sets; explicit basemaps (Layers → Base map) do not change with the theme.

- Figma library: https://www.figma.com/design/4XVC3fKkAl3bJMRh8GeY1C (Starter plan, venky s's team)
- Logo: [`docs/brand/logo-mark.svg`](brand/logo-mark.svg) (one colour, `currentColor`) and [`docs/brand/logo-tile.svg`](brand/logo-tile.svg) (app tile / favicon)
- Tokens: [`src/design/tokens.css`](../src/design/tokens.css)

## 1. Rationale

The viewer is a review tool that sits on a map. The map, the lanes and the findings carry the information, and the chrome
around them should stay quiet: low-contrast surfaces, one accent, and colour only where it means something.

The identity comes from a calm landscape: a sky that runs from deep to pale blue, soft white clouds, a single dark tree and
a bright yellow-green meadow. The landscape shows in three places:

- **The top bar is the sky.** It is a zenith-to-sky gradient by day and the night sky in dark mode, with a 3px meadow-green
  **horizon line** under it. This is the one literal quote of the image.
- **Surfaces are tinted by the sky.** Light-theme surfaces are clouds over horizon haze (`#e8f2fb`). Dark-theme surfaces are
  the night zenith (`#06112a`). Neither theme uses plain grey.
- **Sky and meadow are the two brand colours.** Sky is the accent and meadow is the secondary. The logo uses them in one colour.

| Reference area      | Sampled | Becomes |
|---------------------|---------|---------|
| Zenith              | `#0b2cc5` | `--sky-zenith` (brand gradient only) |
| Upper sky           | `#107cea` | `--sky-500` |
| Mid sky             | `#69c2e8` | sets `--sky-300/400` (accent in dark theme) |
| Horizon haze        | `#aed0e6` | `--sky-200` |
| Clouds              | `#eceef0` | haze neutrals (light surfaces) |
| Lit meadow          | `#79ad32` | `--meadow-500` |
| Foreground grass    | `#588721` | `--meadow-600` |
| Tree shadow         | `#22341d` | `--meadow-900` area |

How these become UI roles:

- **Primary (sky)** is used for selection, focus, the active segment and tab, links and the primary button.
- **Secondary (meadow)** is used sparingly for "good/added/fixed" moments and brand accents. It never competes with the accent.
- **Neutrals (haze)** are visibly sky-tinted: the horizon haze by day and the night zenith by night.
- **Semantic colours** are leaf (ok), sun (warn), clay (error) and sky (info). Each has a text-safe foreground and a soft tint for chips and banners.

## 2. Colour tokens

All ratios are WCAG 2.x contrast ratios. The AA thresholds are 4.5:1 for text and 3:1 for UI component boundaries.

### Light theme

| Token | Value | Notes / contrast |
|---|---|---|
| `--bg` | `#e8f2fb` | app background (horizon haze) |
| `--surface` | `#ffffff` | panel, top bar, drawer, dialog |
| `--surface-2` | `#f3f8fd` | inputs, cards, list items |
| `--surface-3` | `#deebf7` | hover, code, neutral chip |
| `--line` | `#cfdfee` | dividers (decorative) |
| `--line-2` | `#b2c9df` | card / segment borders (decorative) |
| `--line-strong` | `#6a8aa8` | **input & checkbox borders: 3.61:1 on surface, 3.38:1 on surface-2** |
| `--text` | `#0f2236` | 16.1:1 on surface, 13.3:1 on surface-3 |
| `--muted` | `#45607b` | 6.54:1 on surface, 5.40:1 on surface-3 |
| `--accent` | `#0a65c2` | 5.75:1 on surface, 4.74:1 on surface-3; white text on it 5.75:1 |
| `--accent-hover` | `#0857a8` | white on it 7.15:1 |
| `--accent-soft` | `#e3effb` | selected row tint; text on it 14.2:1 |
| `--secondary` | `#3a7311` | 5.77:1 on surface, 4.76:1 on surface-3; white on it 5.77:1 |
| `--ok` / `--ok-soft` | `#2b7317` / `#e6f2e0` | 5.89:1 on surface, 4.86:1 on surface-3; chip 5.09:1 |
| `--warn` / `--warn-soft` | `#975400` / `#fbefdc` | 5.86:1, 4.84:1 on surface-3; chip 5.16:1 |
| `--warn-solid` / `--warn-ink` | `#f2b544` / `#2a1a00` | Flag-mode button, 9.2:1 |
| `--err` / `--err-soft` | `#c42b2b` / `#fbe5e4` | 5.63:1, 4.65:1 on surface-3; chip 4.68:1 |
| `--info` / `--info-soft` | `#0a65c2` / `#e3effb` | 5.75:1; chip 4.93:1 |
| `--focus` | `#0a65c2` | 2px ring, 5.75:1 against surface |
| `--topbar-start` → `--topbar-end` | `#0b2cc5` → `#0a65c2` | sky gradient; white text 9.6:1 → 5.75:1 |
| `--topbar-glass` / `-hover` / `-line` | white 14% / 22% / 30% | glass controls on the top bar |
| `--horizon` | `#79ad32` | 3px line under the top bar (sampled lit meadow) |

### Dark theme (default)

| Token | Value | Notes / contrast |
|---|---|---|
| `--bg` | `#06112a` | night zenith |
| `--surface` | `#0b1a34` | |
| `--surface-2` | `#10223f` | |
| `--surface-3` | `#172c4f` | |
| `--line` / `--line-2` | `#1e3558` / `#2a4570` | decorative |
| `--line-strong` | `#5878a6` | **3.84:1 on surface, 3.52:1 on surface-2** |
| `--text` | `#e8f1fb` | 15.2:1 on surface, 12.2:1 on surface-3 |
| `--muted` | `#9fb6d0` | 8.32:1 on surface, 6.67:1 on surface-3 |
| `--accent` | `#5cb6f2` | 7.78:1; ink `#061626` on it 8.2:1 |
| `--accent-hover` | `#7cc5f5` | ink on it 9.7:1 |
| `--accent-soft` | `#15324a` | |
| `--secondary` | `#8cc63f` | 8.47:1; ink `#0d1a05` on it 8.8:1 |
| `--ok` / `--ok-soft` | `#7cc95a` / `#1b3320` | 8.55:1; chip 6.72:1 |
| `--warn` / `--warn-soft` | `#f2b544` / `#3a2e14` | 9.47:1; chip 7.25:1 |
| `--err` / `--err-soft` | `#ff7b70` / `#3d1f22` | 6.87:1; chip 5.87:1 |
| `--info` / `--info-soft` | `#5cb6f2` / `#15324a` | 7.78:1; chip 5.94:1 |
| `--topbar-start` → `--topbar-end` | `#071a45` → `#0b3170` | night sky; snow text 10.9:1 or more |

### Primitives

| Ramp | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sky | `#eef6fc` | `#d9ecf8` | `#aed0e6` | `#7cc5f5` | `#5cb6f2` | `#107cea` | `#0a65c2` | `#0857a8` | `#0b3f78` | `#15324a` | `#0a1b2c` |
| meadow | `#f2f8ea` | `#e8f2dc` | `#c9e3a4` | `#a8d46e` | `#8cc63f` | `#79ad32` | `#588721` | `#3a7311` | `#2f4f17` | `#1e3315` | `#121d0d` |

The haze neutrals (sky-tinted) are `0 #ffffff · 25 #f3f8fd · 50 #e8f2fb · 100 #deebf7 · 200 #cfdfee · 300 #b2c9df · 400 #9fb6d0 ·
500 #6a8aa8 · 600 #5878a6 · 700 #45607b · 750 #2a4570 · 800 #1e3558 · 850 #172c4f · 900 #10223f · 925 #0b1a34 · 950 #06112a`, plus
ink `#0f2236` and snow `#e8f1fb`. The night sky adds `sky-night-1 #071a45` and `sky-night-2 #0b3170`.

The semantic hues are:

- leaf: `100 #e6f2e0 · 400 #7cc95a · 700 #2b7317 · 900 #1b3320`
- sun: `100 #fbefdc · 400 #f2b544 · 700 #975400 · 900 #3a2e14`
- clay: `100 #fbe5e4 · 400 #ff7b70 · 700 #c42b2b · 900 #3d1f22`

Translucent tokens carry their alpha in the value: `--topbar-glass*`, `--topbar-ink-soft`, `--surface-glass`, `--err-line`,
`--ok-halo`, `--backdrop` and `--data-junction-fill`. Use them instead of `opacity` or `color-mix` on a token. Figma's renderer
drops paint opacity on variable-bound paints, so the Figma library uses the same alpha-baked variables.

### Logo

The mark is **one colour** that follows the theme. It is a **folded map** (the viewer) with a **road** cut through it
(OpenDRIVE), a **car** on the road (the networks are built for driving simulation), and the **lone tree** and meadow contours
from the reference landscape (nature). The tree canopy can also be read as a map pin.

| Use | File | Colour |
|---|---|---|
| Mark on surfaces | `docs/brand/logo-mark.svg` | `currentColor` = `--accent` (`#0a65c2` light, `#5cb6f2` dark) |
| Mark on the top bar | same | `--topbar-ink` (white / snow) |
| App tile, favicon | `docs/brand/logo-tile.svg` | `--accent` tile with an `--accent-ink` glyph |

The wordmark is "OdrForge" in Inter Bold 15 plus "Viewer" in Inter Medium 15 (muted, or `--topbar-ink-soft` on the top bar),
with an 8px gap after a 22–24px mark. Keep clear space of 25% of the mark around it. The minimum size is 16px. Do not add
gradients, outlines or other colours.

### Adopting the tokens

`tokens.css` keeps every variable name that `styles.css` uses today. These are new:

- `--line-strong`
- `--accent-hover`, `--accent-soft`
- `--secondary*`
- `--*-soft`
- `--warn-solid`, `--warn-ink`
- `--focus`, `--backdrop`, `--shadow-sm`
- the scales

To adopt:

1. Import `tokens.css` before `styles.css` and delete the two `:root` blocks there. Give `.topbar` the sky
   (`background: var(--topbar-bg); color: var(--topbar-ink); border-bottom: 3px solid var(--horizon)`) and its controls the glass tokens.
2. Change the input, select and checkbox borders from `--line` to `--line-strong`.
3. Change chip backgrounds from `color-mix(... 22%)` to `--*-soft`. The light-theme mixes reach only about 4.1:1.
4. Use `--warn-solid` and `--warn-ink` for `.btn.warn`. In light mode, `--warn` is now a dark amber text colour.

## 3. Map data colours

The overlays are the product. Each one has to read over three kinds of ground:

- the OSM Carto raster: pastel, mostly light
- satellite imagery: dark greens, browns and greys
- the dark vector map: near black

Rules:

1. **Lanes are opaque** (alpha ~0.92), so their colour is read against the neighbouring lanes, not against the basemap. Each theme has its own set: muted fills on dark, lighter pastels on the OSM raster.
2. **Overlays are saturated, mid-light hues** that do not occur in any basemap. Lines are at least 1.5px. Markers have a 1.5px `#0a1017` halo, which turns white when selected.
3. **Each overlay hue has one meaning.** Magenta is only compare-B. Cyan is only cross paths. Chartreuse is only road reference lines. Amber is only real junction areas and open flags. Iris is only virtual junctions.
4. **Road marks and signals keep real-world colours**: white, yellow, and the red/amber/green signal heads.
5. **Each theme has its own map.** The top bar's Map draws the OSM raster in the light theme and the near-black dark vector map in the dark theme (`tests/basemap.test.ts`). Lane opacity defaults to 1 (the lane alpha .92 above); the Road opacity slider only lowers it on request.

### Lane types (keep the set: driving, junction, sidewalk, curb, biking, parking, shoulder, border, median, restricted, bidirectional, bus)

| Type | Dark theme | Light theme | Before (dark / light) |
|---|---|---|---|
| driving | `#4a5566` | `#7d8898` | `#485060` / `#78808e` |
| junction (driving in junction) | `#66748a` | `#a1adbd` | `#5c687c` / `#929cac` |
| sidewalk / walking | `#9c968a` | `#d9d2c4` | `#969288` / `#d6d0c4` |
| curb | `#d2cdc2` | `#f1ede5` | `#bebab0` / `#ece8e0` |
| biking | `#1e8c61` | `#51c49f` | `#2f8c69` / `#6ebe96` |
| parking | `#5475b2` | `#849fd3` | `#2d5a8c` / `#78a0cd` |
| shoulder | `#b09a62` | `#c6aa75` | `#6e624c` / `#b4a688` |
| border | `#443930` | `#937d5c` | `#605448` / `#aa9c8c` |
| median | `#3d6b2e` | `#9cc85a` | `#356e3c` / `#78af78` |
| restricted | `#b7322e` | `#df7f7e` | `#a04646` / `#d77878` |
| bidirectional | `#a098c9` | `#c4bce2` | `#786096` / `#aa91c8` |
| bus | `#dba04b` | `#d28630` | `#aa5a28` / `#dc8c50` |

The other lane types follow `driving`, as they do today:

- entry, exit, onRamp, offRamp, connectingRamp: driving
- stop: shoulder
- rail, tram: neutral greys
- none: transparent

**Colour-vision check.** The worst pair in each set, measured as CIELAB ΔE76 under Machado-2009 simulation. Higher is more distinct. A ΔE below about 10 is hard to tell apart.

| Set | Normal | Deuteranopia | Protanopia | Tritanopia |
|---|---|---|---|---|
| current dark | 8 (shoulder/border) | **5** (median/restricted) | **3** (border/restricted) | 6 |
| proposed dark | 13 (driving/junction) | 13 | 13 | 10 |
| current light | 8 | **2** (median/restricted) | **3** (parking/bidirectional) | 4 |
| proposed light | 10 (sidewalk/curb) | 10 | 10 | 7 (restricted/bus) |

The proposed sets came from a constrained search. Each hue was held near its family (asphalt grey, stone, teal bike, steel-blue
parking, sand shoulder, grass median, brick restricted, violet bidirectional, orange bus). Lightness and chroma were then varied
to maximise the worst-case ΔE across normal, deuteranopic and protanopic vision.

Driving, junction, sidewalk and curb are pinned, because they cover most of the map and must stay calm. Driving and junction
are deliberately close (a junction lane is a driving lane), and the junction-area outline separates them.

### Overlays and review markers (same in both themes)

| Role | Colour | Over OSM | Over satellite | Over dark map |
|---|---|---|---|---|
| selected lane/junction/feature | `#1e9bff` (was `#5aa9ff`) | ✔ | ✔ | ✔ |
| real junction (default, direct, crossing): fill / outline | `#f5b84a` solid tint at α .28 / 1 | ✔ | ✔ | ✔ |
| **virtual junction**: fill / outline | `#7c5cff` iris, **45° hatch** (3px stripes, 5px gap) at α .55 / 1 | ✔ | ✔ | ✔ |
| cross path (dashed) | `#00e5ff` (was `#00cdff`: ΔE 16.7 from the sky info markers) | ✔ | ✔ | ✔ |
| road reference lines | `#d0ff14` chartreuse (on the lanes: 3.1:1 light, 6.5:1 dark driving; was `#e84cff`, too close to compare magenta) | ✔ | ✔ | ✔ |
| junction reference line (dashed) | `#ff4d00` vermilion (was `#eb4034`: ΔE 16.1 from error findings) | ✔ | ✔ | ✔ |
| elevation grid | `#50dcc8` | ✔ | ✔ | ✔ |
| **compare B outlines** | `#ff40c8` magenta | ✔ | ✔ | ✔ |
| building footprint / outline | `#ffb347` α .28 / `#ff9f1c` | ✔ | ✔ | ✔ |
| flag open / fixed / question / won't fix | `#f2b544` / `#7cc95a` / `#5cb6f2` / `#8c929e` | ✔ | ✔ | ✔ |
| finding error / warning / info | `#ff6a5c` / `#ffaa3c` / `#5cb6f2` | ✔ | ✔ | ✔ |
| road marks | `#f5f7fa` white, `#f5c442` yellow, `#96989c` curb | | | |
| traffic light heads | `#eb3434`, `#f5aa28`, `#2ecc62` on `#1a1c20` | | | |
| signs | stop `#cc2028`, other `#2c62ce`, speed/yield `#f6f6f6` | | | |

Selection moves from `#5aa9ff` to the more saturated `#1e9bff`, which keeps it clear of the new steel-blue parking lanes. Marker
pairs that collide for colour-blind users never rely on colour alone, because they differ in other ways too:

- flag vs finding: the flag has a number label, the finding a plain dot
- open vs fixed: carried in the list chip text as well
- error vs warning: the finding chip text

### Junctions: real and virtual

OpenDRIVE 1.8.0 §12 has four junction types:

- `default`, `direct` and `crossing` are real places where roads meet.
- `virtual` (§12.5) is a logical junction on a through road, such as a driveway or a parking entry, with no physical
  intersection.

A reviewer must tell the two apart at a glance, so each property is carried by its own visual channel:

| Channel | Says | Real junction | Virtual junction |
|---|---|---|---|
| Hue | the type | amber `#f5b84a` | iris `#7c5cff` |
| Fill form | the type (works for every kind of colour vision) | solid tint, α .28 (hull .15) | 45° hatch, α .55 (hull .35) |
| Line style | the outline's source | solid = an outline the file defines, dashed 4/3 = approximate hull | same; a virtual junction without `<boundary>` is its main road's span `sStart`..`sEnd` (§12.5), full width, solid |
| Edge | | 2px; selected 3px `#1e9bff` | same |
| Legend / inspector | | "junction" with the type in the inspector | "virtual junction", iris chip in the inspector head |

Values: `JUNCTION` and `OVERLAY.virtual*` in `scene.ts`, plus `--data-junction-virtual`. Real vs virtual stays ΔE ≥ 40 in
every vision mode (guarded). The hatch is a `FillStyleExtension` procedural pattern (`@deck.gl/extensions`), fixed on screen.

Wiring (`src/map/junctionStyle.ts`, guarded by `tests/junctionStyle.test.ts` and `tests/virtualJunction.test.ts`):

- A virtual junction lies on its through road, so a fill under the opaque lanes would never show. Real fills stay under
  the lanes (`junctions`); the virtual hatch is its own layer over the lanes (`junctions-virtual`, draw order 4), and the
  lanes show between the stripes.
- Its area is the main road between `sStart` and `sEnd` (`mainRoad`, 1.5+, §12.5). The hull of its connecting roads
  (often one crossing path) collapsed to a line, with nothing to hatch.
- The chip text uses text-safe iris tokens (`--virtual` / `--virtual-soft`: 7.4:1 dark, 5.6:1 light); raw `#7c5cff` reaches
  only 3.99:1 on the dark surface.

## 4. Scales

| Scale | Tokens |
|---|---|
| Spacing | `--space-1..9` = 2, 4, 6, 8, 12, 16, 20, 24, 32 px |
| Radius | xs 4 (kbd, code) · sm 6 (chips in lists, credit) · md 8 (controls, list items) · default 10 (cards, groups, banners) · lg 14 (dialog, drawer) · full (pills, dots) |
| Type | Inter. 22/600 display · 16/600 dialog title · 15/600 drawer title, stat value · 13/400 body (base) · 13/550 tab · 12/400 small · 11/700 caps overline (+.06em) · 10.5/700 caps chip (+.04em). JetBrains Mono 12 / 11 for ids, coordinates and the server URL. Tabular numerals for numbers. |
| Elevation | 0 flat (panel, top bar); 1 `--shadow-sm` (hover cards, map controls); 2 `--shadow` (drawer, dialog, toast, banners, loading pill). Overlays on the map always use level 2, because they must lift off any basemap. |
| Motion | `--dur-fast` 120ms (hover, press), `--dur` 180ms (chevrons, segment switch, toasts in), `--dur-slow` 260ms (drawer, panel). Easing `--ease` = cubic-bezier(.2,.7,.2,1). Durations drop to 0 under `prefers-reduced-motion`. |
| Sizes | control 32 (topbar/panel), small control 26, top bar 52, status bar 28, panel 320, drawer 340 |
| z-index | map UI 3 · drawer 5 · banner/loading 6 · toast 7 · mobile panel 8 · drop zone 20 |

### Icons

Use **[Lucide](https://lucide.dev)** (ISC licence, free, tree-shakeable `lucide-react`) at 16px with a 1.5px stroke and round
caps. They inherit `currentColor`. The Figma file draws a matching subset under `Icon/*`. The glyphs used today map to Lucide icons as follows:

| Today | Icon | Today | Icon |
|---|---|---|---|
| ☰ | `menu` | ⤢ | `scan` / `maximize` |
| ◆ | logo mark (`docs/brand/logo-mark.svg`) | ◐ | `sun-moon` |
| ⚑ | `flag` | ✕ | `x` |
| ▸ | `chevron-right` (rotates 90°) | search | `search` |
| Map / Satellite | `map` / `globe` | Layers / Flags / Findings / Compare tabs | `layers`, `flag`, `triangle-alert`, `git-compare` |

## 5. Components

Every interactive component has these states:

- **default**
- **hover**: surface-3, or the accent-hover tint
- **focus-visible**: a 2px `--focus` ring with a 2px offset. This replaces the current 1px offset so the ring clears borders.
- **active/pressed**: one step darker, no movement
- **selected/on**: the accent
- **disabled**: 45% opacity and no pointer. Disabled controls are still shown as present.

| Component | Spec |
|---|---|
| **Top bar** | 52px high, `--topbar-bg` sky gradient, then a 3px `--horizon` meadow line. 12px padding, 8px gaps. Left to right: panel toggle, logo lockup (white mark + "OdrForge" + "Viewer" at `--topbar-ink-soft`), server field (solid surface, mono, connection dot), file select, "Open file…" glass button, search 220px with a `/` kbd, spacer, Map/Satellite and 2D/3D glass segmented controls (on = white segment with accent text), Flag glass button (`--warn-solid` "Click the map…" while active), fit and theme glass icon buttons. **Glass**: fill `--topbar-glass` (hover `-hover`), 1px `--topbar-glass-line`, text `--topbar-ink`. Focus ring: white with a sky gap. |
| **Status dot** | 8px circle. Connected: `--ok` with a 3px 25% halo. Error: `--err`. Idle: `--muted`. Always paired with a title or tooltip. |
| **Input** (server, search, text) | 32px, `--surface-2`, 1px `--line-strong`, radius md, padding 6/10. Hover: border `--muted`. Focus: border `--accent` plus the ring. Error: border `--err` plus help text in `--err`. Disabled: 45%. Search has a 16px search icon at 10px inset and a trailing kbd. |
| **Select** | As input, with a chevron-down at 10px right inset. Open: border accent. |
| **Button** | 32px, radius md, padding 0/12, 13/550. **Primary**: accent bg, accent-ink, hover accent-hover. **Secondary**: surface-2, 1px line-2, hover surface-3. **Ghost**: transparent, hover surface-3. **Danger**: secondary with `--err` text and an err-tinted border, hover err-soft. **Warn (flag mode)**: warn-solid with warn-ink. Small: 26px, 12px text, padding 0/9. Block: full width. Icon + label gap 6px. |
| **Icon button** | 32×32, radius md, transparent. Hover: surface-3 + 1px line. Active/on: accent-soft with an accent icon. Focus: ring. Always has an `aria-label` and a tooltip. |
| **Segmented control** | Height 32, 1px line-2 container, radius md, 2px inner padding, segments radius sm. Off: transparent, muted text. Hover: surface-3, text. On: accent bg + accent-ink + 600. The segment change animates 180ms. |
| **Tabs** | 40px, muted 13/550, 2px bottom indicator. Hover: text. Selected: text + accent indicator. A count shows as a neutral chip after the label (instead of "· 12"). Focus: ring inset. |
| **Collapsible group** | Surface-2 card, radius 10, 1px line. Summary is 36px: overline label (11/700 caps, muted), chevron-right rotating 90° when open. Hover: label goes text. Body padding 2/12/12, 6px gap. **Sub-title**: 10.5/700 caps muted at 80%, dashed top line, except when it is the first child. |
| **Checkbox row (toggle)** | 16px box with 1.5px `--line-strong` border, radius 4. Checked: accent fill + accent-ink check. Hover: border muted. Focus: ring around the box. Disabled: 45%. The label is 13 text, 4px vertical padding, and the whole row is clickable. |
| **Slider row** | Label (muted 12) + value badge (13/600 text, tabular, surface-3 pill 2/6) on the left, 150px track on the right. Track 4px line-2, fill accent, thumb 14px surface with a 2px accent border. Hover: thumb shadow-sm. Focus: ring on the thumb. Disabled: 45%. |
| **Chip / status pill** | 10.5/700 caps, radius full, padding 2/7. Tones: neutral (surface-3 / muted), ok, warn, err, info, accent (`--*-soft` bg + `--*` text). Toggle chips (compare filters) are on = tone, off = neutral with a 1px line border. Counts sit inside the chip. |
| **Stats card** | Surface-2 card, 4 columns, values 15/600 tabular, labels 11 muted. |
| **Legend swatch** | 16×10, radius 3. Fill: colour + 1px line-2 border (or its own border colour). Line: 3px solid. Dashed: 2px dashed. Double: 2× 2px with a 2px gap. Dot: 10px circle with a 2px dark ring. Traffic light: three 6px dots on `#1a1c20`. Rows are 12px text in a 2-column grid with 5/12 gaps. A group title is 11/700 muted. |
| **Inspector drawer** | 340px floating card, 12px from the map edges, radius lg, elevation 2, scrolls inside. Head: eyebrow (11 caps muted, e.g. "Lane · driving") + title 15/600 + close icon button. Sections are 12/14 padded with 1px line dividers and an overline title. KV rows: key muted left, value right (tabular, mono for ids); 3px vertical padding. Links: accent and underline on hover; a "go to road" link includes the road id. Footer: block primary/secondary action ("Flag this lane"). |
| **Flag dialog** | 440px, radius lg, elevation 2, backdrop `--backdrop` + 2px blur. Head: title 16/600 + close. "Where" line muted 12. Reply block (status chip + text) when editing. Category select, note textarea (min 90px, the initial focus), footer: Delete (danger, edit only) · spacer · Cancel (secondary) · Save (primary, disabled until there is a note; Ctrl+Enter). |
| **List item** (flag / finding / compare diff) | Surface-2, 1px line, radius md, padding 8/10, 3px gap. Hover: border line-2 + surface-3. Selected: accent border + accent-soft bg. Deleted: 55% opacity + strikethrough id. Flag: `#id` 600 · status chip · category muted · spacer · Edit link · note · location muted 12 · reply quote (2px line-2 left rule). Finding group: rule name + level chip with count, expands to small items. Diff: kind chip (changed = warn, added = ok, removed = err) + "road 12" 600 + detail muted. |
| **Toast** | Bottom centre, 20px up, surface-3, 1px line-2, radius 10, elevation 2, padding 8/14, `role=status`. Optional leading tone icon. Auto-hides after 4s; slides in 180ms. |
| **Banner** | Top centre over the map, radius 10, elevation 2. Error: err-soft bg + 1px err border + alert icon + Dismiss link. Info/mode: warn-soft + warn border (flag mode: "Click where something is wrong. Esc to stop"). |
| **Map note** | As banner, 12px text, warn border, max 560px. Used for height/terrain notes. |
| **Loading pill** | Top centre, radius full, surface, elevation 2, 14px spinner (2px line-2 ring with an accent arc, 0.8s linear) + message. |
| **Empty / error states** | Centred on the map. A 40px logo mark in accent, 22/600 title, muted 13 body (max 520), inline code. Error variant: the server is unreachable, so the body says what to run and includes a "Retry" secondary button. |
| **Map controls** | MapLibre group restyled: surface, 1px line, radius md, elevation 1, 32px buttons with Lucide plus, minus and compass icons (the icons replace the CSS-inverted sprites). Scale bar: surface at 80%, muted text, 1px muted border. Attribution and imagery credit: surface at 82%, 11px muted, radius sm. |
| **Tooltip** | `--text` bg with `--surface` text (inverted), 12px, radius sm, padding 4/8, 6px offset, 400ms delay, no arrow. Shortcuts are shown as kbd. On the map it names what is under the pointer (`map/hoverInfo.ts`): lane type, lane and road; junction kind; feature and road; a flag or finding. It follows the pointer and clears when the map moves. |
| **File drop overlay** | Full stage: `--backdrop` + 2px blur, a centred card with a 2px dashed accent border, radius lg, upload icon 32px, "Drop a .xodr, an OdrForge page, or checker results". It appears on `dragenter` with files. |
| **Kbd / code** | Mono 11, 1px line-2 border with a 2px bottom border, radius xs, surface-2. Code: mono 12 on surface-3. |
| **Status bar** | 28px, surface, 1px top line, muted 12, values in text 600, coordinates mono. Warnings use `--warn` text. |

## 6. Accessibility notes and trade-offs

- **All text and UI-control colours meet WCAG AA in both themes** (tables above), including every semantic colour on the hover surface (surface-3). The tightest light-theme pairs are `--err` on surface-3 (4.65:1) and the err chip (4.68:1). Do not put semantic text on anything darker than surface-3. Logo, top bar: white on the sky gradient is 5.75:1 or more, and the accent on a white segment is 5.75:1.
- Light-theme `--warn` is a **dark amber** (`#975400`) because the familiar `#f5b84a` reaches only 1.8:1 on white. The bright amber is kept as `--warn-solid` for fills, with dark ink on it.
- `--line` and `--line-2` are decorative and fall below 3:1 on purpose, to keep the chrome quiet. Controls whose boundary identifies them (inputs, selects, checkboxes, segment containers) use `--line-strong`, which is 3:1 or more.
- Lanes cannot all be colour-blind-safe at 12 categories. The proposal raises the worst case from ΔE 2–5 to 10–13, and the inspector and the hover tooltip always name the lane type.
- Map overlays use fixed colours in both themes, so legends and screenshots stay comparable. Contrast against the ground comes from saturation, a minimum width, halos and the dim slider. It does not come from theme switching.
- Focus is always visible: a 2px ring, never removed. Do not use colour as the only signal: chips carry text, flags carry numbers, and the dashed/solid line style matters in the legend.
- Motion is minimal and is turned off by `prefers-reduced-motion`.

## 7. Figma file structure

The Starter plan allows **3 pages** and **1 mode per variable collection**, so:

- **Variables**
  - `Primitives`: sky (incl. zenith, night-1/2), meadow, haze, leaf, sun, clay, ink. Hidden from pickers.
  - `Color / Light` and `Color / Dark`: the same `color/*` names, aliased to the primitives, with code syntax `var(--…)`.
  - `Lanes / Light` and `Lanes / Dark`
  - `Map data`: overlays, flags, findings, marks, signals.
  - `Scale`: space, radius, size, font-size.

  Components bind to `Color / Light`. The dark previews are instances rebound to the identically named `Color / Dark`
  variables. On a paid plan, merge each Light/Dark pair into one collection with two modes.
- **Styles**: text styles (Display, Heading, Body, Label, Mono) and effect styles (Elevation 1/2 × Light/Dark).
- **Pages**
  - **Foundations**: logo (mark, tile, lockups on surface, sky and dark), the colour story sampled from the reference, primitive ramps, semantic tokens in both themes, type, spacing, radius, elevation and motion.
  - **Components**: icons (28 Lucide-style), Controls (Button 25 variants, Button Small, Icon Button, Input 15, Select, Segment and segmented controls, Tab, Kbd, Link), Side panel (Checkbox Row, Slider Row, Group, Sub-title, Chip, Chip Toggle, Status Dot, Stats Card, Legend Swatch and Row, KV Row, List Item for flag, finding and diff, Finding Group), Overlays (Inspector Drawer, Flag Dialog, Toast, Banner, Map Note, Loading Pill, Empty State, Map Controls, Scale Bar, Attribution, Tooltip, File Drop Overlay), Shell (Topbar Segment, Button, Icon Button and Field, Top Bar, Status Bar, Side Panel).
  - **Map data & Patterns**: the data colours over OSM, satellite and dark-vector grounds, both lane sets, and the full app screen in light and dark (the dark screen is the light one with every variable rebound to `Color / Dark` and `Lanes / Dark`).

## 8. 3D assets and markers (what the viewer draws itself)

These rules cover everything the viewer draws itself in the map scene: furniture, objects, structures, road marks,
overlays, labels and markers. They apply to **both views**:

- **3D** shows the asset as a body.
- **2D** shows the same asset from above, as a footprint, a line or a dot.

A feature has **one colour in both views and both themes**. The scene sits on the basemap, not on the UI. The values live in
[`src/design/scene.ts`](../src/design/scene.ts), the single source for the deck.gl layers and the legend. Specimens are on
the Figma page *Map data & Patterns → 3D assets & markers*.

### Principles

1. **Low-poly clay.** Assets are simple primitives (round columns, extruded boxes, prisms) in flat matte colour: no
   textures, no gloss (`MATERIAL`: ambient .55, diffuse .55, shininess 8). Shape and size say what something is; colour
   says which family it belongs to.
2. **Families, not individual colours.** Each asset family has one hue: vegetation is meadow, metal is sky-tinted steel,
   light is sun, other objects are sandstone, and structures are sky (bridge) or haze (tunnel). Regulatory items keep their
   real-world colours: signal lamps, sign faces and road paint.
3. **Overlays win.** Asset colours are mid-saturation, so the review overlays (selection `#1e9bff`, junction amber, cross-path
   cyan, compare magenta, flags, findings) always stand out above them.
4. **Every marker has a halo.** Markers and dots carry a 1.5px `#0a1017` ring (2.5px white when selected), so they read over
   OSM, satellite and the dark map.
5. **Text is never bare on the map.** Labels are ink on a white pill.

### 3D assets (and their 2D form)

| Asset | 3D shape (defaults when the file gives no size) | 2D (top-down) | Colour |
|---|---|---|---|
| Tree / vegetation | **the logo's tree**: a big top lobe (radius .64r, centred .64r below the top) over three smaller side lobes (.53r, .47r out at 120°, .55r lower), so every side shows the logo silhouette. Trunk radius .14r. Each lobe is a stepped low-poly sphere of three columns (caps .75ρ). Defaults: r = 1.5 m crown half-width, h = 6 m. See `TREE` in `scene.ts`. | trefoil: the four lobe discs | trunk `#6b4f33` bark · crown `#588721` meadow-600 at 92% |
| Pole / post | column r 0.1 m (≤ 0.2), h 6 m; signal posts r 0.04–0.06 to `zOffset` | dot | `#8a9bb0` steel |
| Street lamp | pole + head column r 0.28, h 0.25 at the top | dot | head `#f2b544` sun-400 |
| Guard rail / wall / fence | 2 m extruded pieces along the repeat, width ≥ 3 cm, plus a `#d6dee6` line (0.25 m, 1–2 px) on a soft `#0a1017` casing (55 %, 2–3.5 px) along its top edge from 0.3 m/px in (about zoom 17.5); never wider than 2 px, so it does not outweigh the lanes, and not drawn zoomed out | line of boxes, plus the same line | `#b7c3cf` galvanised |
| Other object | its own cylinder / box / outline prism; a 0.25 m marker post when unsized | footprint or dot | `#d6b47a` sandstone (outline lines too) |
| Crosswalk | flat area | same | white 60% |
| Traffic light | housing box 0.28 × w × h (h 1 m) + three lamps r ≤ 0.11 facing the traffic | dot `#2ecc62` | housing `#141a24`; lamps `#eb3434` `#f5aa28` `#2ecc62` |
| Sign | board 6 cm thick, 0.6 m, on a post; text label above | dot (face colour) | speed / yield `#f6f6f6`, stop `#cc2028`, other `#2c62ce` |
| Stop / waiting line | flat bar 0.3 m across the lanes | same | `#fafafa` |
| Bridge | the road's cross section as a translucent volume with a wireframe edge | translucent area + edge | fill `#107cea` at 28%, edge 90% |
| Tunnel | as bridge | as bridge | fill `#5878a6` at 28%, edge 86% |
| Tunnel road under the ground (3D, terrain on) | its lane outlines where they lie under the drawn ground, dashed 3/2, 2px, drawn over the terrain and the buildings (`map/tunnelXray.ts`; Layers → Tunnel roads through terrain) | none (nothing hides it) | `#5878a6` (the tunnel edge) |
| OSM 3D buildings (context) | MapLibre extrusion | footprint (review layer) | light `#d5dde6`, dark `#24324a` at 85%; review footprint `#ffb347` 28% + `#ff9f1c` edge |

Road marks keep the OpenDRIVE paint colours: white `#f5f7fa`, yellow `#f5c442`, blue `#4682e6`, green `#3caa5a`, red
`#dc3c3c`, orange `#f09628`, violet `#965ad2` and black `#191919`. Curb marks are `#96989c`. Grass marks are `#588721`,
meadow from the reference. Lane outlines are night or ink at about 30% (`EDGE.laneDark` / `EDGE.laneLight`).

### Markers and dots

| Marker | Size | Fill | Ring | Label |
|---|---|---|---|---|
| Flag (open / fixed / question / won't fix) | 7px radius (+3 when selected) | `#f2b544` / `#7cc95a` / `#5cb6f2` / `#8c929e` | 1.5px `#0a1017`; selected 2.5px white | flag number: Inter 700 11px ink on a white pill, offset +10 / −10px |
| Finding (error / warning / info) | 5px radius (+3 when selected) | `#ff6a5c` / `#ffaa3c` / `#5cb6f2` | as flag | none (the list and the tooltip name it) |
| LLM review item (critical / major / minor / info; legitimate on request) | hollow ring 9 / 7 / 6 / 5 px (+3 selected), 2.5px stroke on a `#0a1017` centre at 59 % | stroke `#ff6a5c` / `#ff6a5c` / `#ffaa3c` / `#5cb6f2`; legitimate `#7cc95a` | selected: white stroke 3px | none: the Findings tab (Checkers \| LLM review) and the tooltip name it. Read-only, never mixed with the hand-made flags |
| 2D signal / object dots | 0.7 m, clamped to 0.5–7px | traffic light `#2ecc62`, sign `#f6f6f6`, stop `#cc2028`, object `#d6b47a` | 1px `#0a1017` | none |
| Elevation grid point | 2.5px | `#50dcc8` | 1px `#0a1017` | none |
| Hover (any pickable) | n/a | white 24% highlight | n/a | n/a |
| Selected asset | n/a | `#1e9bff` (structures at 47%) | n/a | n/a |

Static sign dots move from coral `#ff6b6b` to the sign's own face colour, because the coral was indistinguishable from
finding errors. Object dots move from violet to sandstone, so they match the 3D object and stay clear of bidirectional lanes.

### Labels

Sign text and flag numbers are billboards: Inter 600 12px (flags 700 11px) in `#0f2236` on a white pill at 92%, with
padding 4/2, radius 4, max 16px on screen, placed 0.25 m above a sign board. Use a pill on every ground. Never draw
outlined or bare text on the map.

Sign labels appear from 0.6 m per screen pixel in (about a 1:2000 view, zoom ~17; `SIGN_LABEL_MAX_MPP` in
`MapView.tsx`). Further out they piled up over the roads by the hundred. A collision filter is not used: on text it
drops single characters, so a "30" read as "3".

### Drawing order (bottom to top)

1. basemap
2. dim
3. lanes and lane outlines
4. road marks, crosswalks, flat object areas
5. junction areas and outlines
6. structures
7. 3D assets
8. reference lines, cross paths, elevation grid
9. compare B
10. labels
11. review markers (flags above findings, always on top: `depthCompare: always`)

## 9. Enforced by tests

The contract above is checked, not only written. `tests/design.test.ts` computes it from the sources the app uses
(`src/design/tokens.css`, `src/map/palette.ts`, `src/design/scene.ts`) and fails below these limits. **Do not lower a limit
to make a change pass.** Change the colour, or bring new evidence and update this section, `docs/ACCURACY.md` §7 and the
test in the same commit.

| Rule | Limit | Measured |
|---|---|---|
| Text, accent and semantic colours on bg, surface, surface-2 and surface-3, in both themes | ≥ 4.5:1 | tightest: light `--err` on surface-3, 4.65 |
| Chips (`--x` on `--x-soft`), inks on their fills, top-bar ink on the sky, the active segment (`--topbar-on-ink` on `--topbar-on`) | ≥ 4.5:1 | tightest: light err chip, 4.68 |
| `--line-strong` on surface and surface-2; `--focus` on bg, surface and surface-2 | ≥ 3:1 | tightest: dark line-strong on surface-2, 3.52 |
| `palette.ts` draws exactly the `--lane-*` colours | equal | n/a |
| Closest lane pair, dark set: normal / deuteranopia / protanopia / tritanopia | ΔE ≥ 12.5 / 12.5 / 12.5 / 9.5 | 12.9 / 12.8 / 13.0 / 9.9 |
| Closest lane pair, light set | ΔE ≥ 9.5 / 9.5 / 9.5 / 6.5 | 10.1 / 10.0 / 10.2 / 7.0 |
| Different overlay meanings (selection, junction, cross path, reference line, elevation, compare, flag and finding states) | ΔE ≥ 20, except the documented shares* | closest: selected / question 25.6 |
| Compare magenta against every lane, overlay, marker and signal colour | ΔE ≥ 30 | n/a |
| Cross-path cyan against the same | ΔE ≥ 25 | vs elevation teal 25.1 |
| Road reference-line chartreuse against the same | ΔE ≥ 40 | vs light median lane 44.2 |
| Virtual-junction iris against the same | ΔE ≥ 24 | vs violet road paint 24.7 |
| Real vs virtual junction, in every vision mode | ΔE ≥ 40 | normal 148, deuteranopia 143, protanopia 139, tritanopia 62 |
| Selection against every lane colour and overlay; `palette.ts` and `scene.ts` agree | ΔE ≥ 25 | 25.6 |
| 2D sign and object dots against every finding colour | ΔE ≥ 20 | n/a |

\* The documented shares: amber for real junction areas and open flags; the attention family (open flag, warning finding);
sky for question flags and info findings.

`DESIGN_REPORT=1 npx vitest run tests/design.test.ts --silent=false` prints the measured numbers.
