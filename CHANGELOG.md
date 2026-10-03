# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- An entity in the state `error` - a vacuum stuck somewhere - showed the
  active accent, as if it were cleaning. It now gets a red dashed outline and
  no longer counts as active.

## [1.1.1] - 2026-09-30

### Fixed

- A name too long for its cell was split anywhere in the word -
  "Wohnzimm / er" - which shows most with a large `name_size`. It is now
  hyphenated at a syllable, in the language Home Assistant sets for the page.

## [1.1.0] - 2026-09-30

### Changed

- **`label_size` now sizes the line under the name** - the state, a value or
  a `label` - and no longer the name itself; the name has `name_size`. The
  key now means what its name says, matching `name` and `label`. A config
  that set `label_size` for the name needs `name_size` instead. This changes
  the meaning of a 1.0.0 key, which would call for a major version; it is a
  minor one because the card has no other users yet.

### Added

- `name_size`, and `name_weight` and `label_weight` (100-900), for every
  item type - in `item:`, a type's block or on the item.
- `show_icon: false` leaves the icon out, and its room with it: name and
  state line move to the middle of the cell.

## [1.0.0] - 2026-09-30

The first release of Tessera Card: buttons, countdowns, progress rings and
graphs in one mosaic grid, tuned for wall-mounted dashboards.

### Added

- **A grid that lays itself out.** The column count follows the measured
  width, rows are balanced so no item is left alone beside empty space, and
  `colspan` spans exactly as many slots as it says. `layout.mode: grid` keeps
  a stated raster instead. In a sections view the card asks for the rows it
  needs and takes the height it is given.
- **One cell for every kind of item.** `item:` sets corners, surfaces, accent,
  sizes of icon and name, icon colour and press feedback for all items; a
  type's block (`button:`, `ring:` …) and the item itself override it.
- **Item types:**
  - `button` - icon, name and state line; toggles, more-info, services,
    navigation, assist; state-keyed icons, `state_display`, animations.
  - `ring`, `bar`, `segments`, `digits` - a timer, a timestamp, a sensor
    reporting the time left, a percentage, a number on a scale, an attribute
    or a template, drawn as a proportion. Thresholds, gradients, `on_complete`,
    `label` placeholders, and one clock shared by every card that ticks at the
    millisecond a countdown's digits change.
  - `graph` - a sensor's history from `history/stream`, full-bleed along the
    bottom of the cell, split or behind the text; line or bars, several lines,
    a secondary axis, soft and hard bounds, thresholds.
- **`active_when`** decides by template when an item counts as active, and
  **`show_drawing`** whether a ring, bar or graph is drawn - always, while
  active, or by template - without the row moving.
- **Visibility** in Home Assistant's own condition grammar; the layout
  rebalances around hidden items, and a card with nothing to show hides itself.
- **Confirmation** per gesture: the gesture arms the item, a tap within four
  seconds of letting go runs it.
- **Templates** `[[[ ... ]]]` in presentation fields, with the card's
  `variables:`.
- **A visual editor**: card options, one page per item with the options its
  type has, a type chooser under **+ Add item**, type switching that keeps
  what the other type had while the editor is open, Home Assistant's own
  conditions editor, and a YAML view per item.
