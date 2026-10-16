# OdrForge Viewer design system: "Sky & Meadow"

Status: **proposal for review**. The app is not restyled yet. `src/design/tokens.css` exists but nothing imports it.

- Figma library: https://www.figma.com/design/u5MEzgyVJr6K5EGnJ3oQ5t (Starter plan draft, owner sagar_goruru_gst's team)
- Tokens: [`src/design/tokens.css`](../src/design/tokens.css)

## 1. Rationale

The viewer is a review tool that sits on a map. The map, the lanes and the findings carry the information, and the chrome
around them should stay quiet: low-contrast surfaces, one accent, and colour only where it means something.

The identity comes from a calm landscape: a sky that runs from deep to pale blue, soft white clouds, a single dark tree and
a bright yellow-green meadow.

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
- **Neutrals (haze)** are cool greys with a slight sky bias: cloud-white by day, a night-sky blue-black by night.
- **Semantic colours** are leaf (ok), sun (warn), clay (error) and sky (info). Each has a text-safe foreground and a soft tint for chips and banners.

## 2. Colour tokens

All ratios are WCAG 2.x contrast ratios. The AA thresholds are 4.5:1 for text and 3:1 for UI component boundaries.

### Light theme

| Token | Value | Notes / contrast |
|---|---|---|
| `--bg` | `#f3f6f9` | app background |
| `--surface` | `#ffffff` | panel, top bar, drawer, dialog |
| `--surface-2` | `#f6f8fb` | inputs, cards, list items |
| `--surface-3` | `#eaeff4` | hover, code, neutral chip |
| `--line` | `#dbe3ea` | dividers (decorative) |
| `--line-2` | `#c3cfda` | card / segment borders (decorative) |
| `--line-strong` | `#7d8fa1` | **input & checkbox borders: 3.33:1 on surface, 3.13:1 on surface-2** |
| `--text` | `#14202c` | 16.5:1 on surface, 14.3:1 on surface-3 |
| `--muted` | `#556372` | 6.15:1 on surface, 5.32:1 on surface-3 |
| `--accent` | `#0a65c2` | 5.75:1 on surface; white text on it 5.75:1 |
| `--accent-hover` | `#0857a8` | white on it 7.15:1 |
| `--accent-soft` | `#e3effb` | selected row tint; text on it 14.2:1 |
| `--secondary` | `#3f7a16` | 5.24:1 on surface; white on it 5.24:1 |
| `--ok` / `--ok-soft` | `#2f7a1a` / `#e6f2e0` | 5.36:1 on surface; chip 4.63:1 |
| `--warn` / `--warn-soft` | `#975400` / `#fbefdc` | 5.86:1; chip 5.16:1 |
| `--warn-solid` / `--warn-ink` | `#f2b544` / `#2a1a00` | Flag-mode button, 9.2:1 |
| `--err` / `--err-soft` | `#c42b2b` / `#fbe5e4` | 5.63:1; chip 4.68:1 |
| `--info` / `--info-soft` | `#0a65c2` / `#e3effb` | 5.75:1; chip 4.93:1 |
| `--focus` | `#0a65c2` | 2px ring, 5.75:1 against surface |

### Dark theme (default)

| Token | Value | Notes / contrast |
|---|---|---|
| `--bg` | `#0a1017` | |
| `--surface` | `#10181f` | |
| `--surface-2` | `#16202a` | |
| `--surface-3` | `#1e2a36` | |
| `--line` / `--line-2` | `#25313e` / `#344352` | decorative |
| `--line-strong` | `#5f7387` | **3.66:1 on surface, 3.37:1 on surface-2** |
| `--text` | `#e6edf3` | 15.2:1 on surface, 12.3:1 on surface-3 |
| `--muted` | `#93a2b1` | 6.86:1 on surface, 5.59:1 on surface-3 |
| `--accent` | `#5cb6f2` | 8.04:1; ink `#061626` on it 8.2:1 |
| `--accent-hover` | `#7cc5f5` | ink on it 9.7:1 |
| `--accent-soft` | `#15324a` | |
| `--secondary` | `#8cc63f` | 8.75:1; ink `#0d1a05` on it 8.8:1 |
| `--ok` / `--ok-soft` | `#7cc95a` / `#1b3320` | 8.84:1; chip 6.72:1 |
| `--warn` / `--warn-soft` | `#f2b544` / `#3a2e14` | 9.78:1; chip 7.25:1 |
| `--err` / `--err-soft` | `#ff7b70` / `#3d1f22` | 7.10:1; chip 5.87:1 |
| `--info` / `--info-soft` | `#5cb6f2` / `#15324a` | 8.04:1; chip 5.94:1 |

### Primitives

| Ramp | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| sky | `#eef6fc` | `#d9ecf8` | `#aed0e6` | `#7cc5f5` | `#5cb6f2` | `#107cea` | `#0a65c2` | `#0857a8` | `#0b3f78` | `#15324a` | `#0a1b2c` |
| meadow | `#f2f8ea` | `#e8f2dc` | `#c9e3a4` | `#a8d46e` | `#8cc63f` | `#79ad32` | `#588721` | `#3f7a16` | `#2f4f17` | `#1e3315` | `#121d0d` |

The haze neutrals are `0 #ffffff · 25 #f6f8fb · 50 #f3f6f9 · 100 #eaeff4 · 200 #dbe3ea · 300 #c3cfda · 400 #93a2b1 · 500 #7d8fa1 ·
600 #5f7387 · 700 #556372 · 750 #344352 · 800 #25313e · 850 #1e2a36 · 900 #16202a · 925 #10181f · 950 #0a1017`, plus ink
`#14202c` and snow `#e6edf3`.

The semantic hues are:

- leaf: `100 #e6f2e0 · 400 #7cc95a · 700 #2f7a1a · 900 #1b3320`
- sun: `100 #fbefdc · 400 #f2b544 · 700 #975400 · 900 #3a2e14`
- clay: `100 #fbe5e4 · 400 #ff7b70 · 700 #c42b2b · 900 #3d1f22`

The brand gradient (logo mark and empty-state hero only) runs zenith → sky-500 → sky-300 → sky-200.

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

1. Import `tokens.css` before `styles.css` and delete the two `:root` blocks there.
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
3. **Each overlay hue has one meaning.** Magenta is only compare-B. Cyan is only cross paths. Amber is only junction areas and open flags.
4. **Road marks and signals keep real-world colours**: white, yellow, and the red/amber/green signal heads.

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
| junction area fill / outline | `#f5b84a` at α .28 / 1 | ✔ | ✔ | ✔ |
| cross path (dashed) | `#00cdff` | ✔ | ✔ | ✔ |
| junction reference line (dashed) | `#eb4034` | ✔ | ✔ | ✔ |
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
| ◆ | brand mark (sky gradient diamond) | ◐ | `sun-moon` |
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
| **Top bar** | 52px high, surface, 1px bottom `--line`, 12px padding, 8px gaps. Left to right: panel toggle (icon button), brand (gradient diamond + "OdrForge" 600 + "Viewer" muted), source group (status dot, server field mono 190px, file select, "Open file…" secondary button), search 220px with a `/` kbd hint, spacer, Map/Satellite segmented, 2D/3D segmented, Flag button (secondary; turns `--warn-solid` "Click the map…" while active), fit icon button, theme icon button. |
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
| **Empty / error states** | Centred on the map. A 40px brand-gradient diamond, 22/600 title, muted 13 body (max 520), inline code. Error variant: the server is unreachable, so the body says what to run and includes a "Retry" secondary button. |
| **Map controls** | MapLibre group restyled: surface, 1px line, radius md, elevation 1, 32px buttons with Lucide plus, minus and compass icons (the icons replace the CSS-inverted sprites). Scale bar: surface at 80%, muted text, 1px muted border. Attribution and imagery credit: surface at 82%, 11px muted, radius sm. |
| **Tooltip** | `--text` bg with `--surface` text (inverted), 12px, radius sm, padding 4/8, 6px offset, 400ms delay, no arrow. Shortcuts are shown as kbd. |
| **File drop overlay** | Full stage: `--backdrop` + 2px blur, a centred card with a 2px dashed accent border, radius lg, upload icon 32px, "Drop a .xodr, an OdrForge page, or checker results". It appears on `dragenter` with files. |
| **Kbd / code** | Mono 11, 1px line-2 border with a 2px bottom border, radius xs, surface-2. Code: mono 12 on surface-3. |
| **Status bar** | 28px, surface, 1px top line, muted 12, values in text 600, coordinates mono. Warnings use `--warn` text. |

## 6. Accessibility notes and trade-offs

- **All text and UI-control colours meet WCAG AA in both themes** (tables above). The tightest light-theme pairs are `--ok` on surface-3 (4.63:1) and the ok and secondary chips (4.53–4.63:1). Do not put them on anything darker than surface-3.
- Light-theme `--warn` is a **dark amber** (`#975400`) because the familiar `#f5b84a` reaches only 1.8:1 on white. The bright amber is kept as `--warn-solid` for fills, with dark ink on it.
- `--line` and `--line-2` are decorative and fall below 3:1 on purpose, to keep the chrome quiet. Controls whose boundary identifies them (inputs, selects, checkboxes, segment containers) use `--line-strong`, which is 3:1 or more.
- Lanes cannot all be colour-blind-safe at 12 categories. The proposal raises the worst case from ΔE 2–5 to 10–13, and the inspector and the hover tooltip always name the lane type.
- Map overlays use fixed colours in both themes, so legends and screenshots stay comparable. Contrast against the ground comes from saturation, a minimum width, halos and the dim slider. It does not come from theme switching.
- Focus is always visible: a 2px ring, never removed. Do not use colour as the only signal: chips carry text, flags carry numbers, and the dashed/solid line style matters in the legend.
- Motion is minimal and is turned off by `prefers-reduced-motion`.

## 7. Figma file structure

The Starter plan allows **3 pages** and **1 mode per variable collection**, so:

- **Variables**
  - `Primitives`: sky, meadow, haze, leaf, sun, clay, ink. Hidden from pickers.
  - `Color / Light` and `Color / Dark`: the same `color/*` names, aliased to the primitives, with code syntax `var(--…)`.
  - `Lanes / Light` and `Lanes / Dark`
  - `Map data`: overlays, flags, findings, marks, signals.
  - `Scale`: space, radius, size, font-size.

  Components bind to `Color / Light`. The dark previews are instances rebound to the identically named `Color / Dark`
  variables. On a paid plan, merge each Light/Dark pair into one collection with two modes.
- **Styles**: text styles (Display, Heading, Body, Label, Mono) and effect styles (Elevation 1/2 × Light/Dark).
- **Pages**
  - **Foundations**: palette, semantic tokens in both themes, type, spacing, radius, elevation and motion.
  - **Components**: every component above, with its variants and states.
  - **Map data & Patterns**: lane/overlay swatches over OSM-like, satellite-like and dark grounds, plus composed screens (top bar, side panel tabs, inspector, dialog) in light and dark.
