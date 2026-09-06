# Home Assistant Configuration

A working Home Assistant setup, published as a reference. Browse it for
patterns, copy what is useful.

This is a sanitized copy of my own config. Names have been changed and a few
integrations withheld (see [known gaps](#known-gaps)).

## What is here

```
configuration.yaml     entry point; packages, themes, and lovelace config
automations.yaml       UI-managed automations (see caveat below)
packages/              per-feature bundles: lights, climate, sensors, laundry
blueprints/            reusable automation, script, and template blueprints
dashboards/            three YAML-mode dashboards + streamline card templates
python_scripts/        ordered, group-aware light control for remotes
themes/                modified catppuccin theme(s)
www/                   weather icons, backgrounds, fonts
```

## Notable Components

**Pico remote light control** — `python_scripts/light_control.py` with
`blueprints/automation/light_control/pico_remote.yaml`. Lights are driven in
ordered steps: one press of *on* lights the mains, a second adds the accents,
and *off* unwinds in reverse. The dimmer moves every step together, sized from
the dimmest light going up and the brightest coming down, so lights that have
drifted apart converge instead of spreading further.

An entry can be a light group, which counts as one step while the ramp still
sees each member's own brightness. All the behavior lives in the script, so a
different remote needs only its own trigger and a button mapping. Needs
`python_script:` in `configuration.yaml`.

**Scene-scaled lights** — `blueprints/template/light_control/`. Wraps a light
so its brightness is capped by the current scene. The cap belongs to the light,
so dashboards, HomeKit and voice inherit it.

It scales the range rather than clamping the top: clamping makes a dimmer stall
once it reaches the cap, because the controller reads its own writes back
unchanged.

**Streamline card templates** — `dashboards/streamline_templates/`. Cards
defined once and reused across dashboards: a header card with the clock,
the date, a weather icon and the temperature on one line; the weather panel;
a room heading with temperature and humidity badges; a lock tile that
also shows door state; and a bubble card popup for consistent behavior and
appearance across views.

**Zone activity sensors** — `blueprints/template/activity_sensors/`. Rolls an
area's door, window and motion sensors into one that stays on for a set time
after the last event, so a zone reads as occupied rather than as a stream of
individual triggers. Each new event restarts the timeout, so continuous use
holds it on instead of flickering.

**Group state counters** — `blueprints/template/status_sensors/`. Counts how
many members of a group are in a given state, and exposes *which* ones in a
`details` attribute with timestamps. The count makes a compact badge ("2
Open", "1 Playing") and the attribute provides the entity list without
repeating the filter.

**Latching sensors** — `blueprints/template/status_sensors/`. A binary sensor
set by one event and cleared by another, holding its state in between. Both
sides read the off-to-on edge, so a momentary pulse is remembered rather than
missed: an appliance's end-of-cycle signal is on for a couple of seconds, but
the sensor reads *ready* until someone opens the door.

**Sun status sensor** — `packages/status_sensors.yaml`. One sensor whose state
reads `Sunset in 3 hours`, or `UV Index · 7` when the index is worth acting on,
with an icon to match.

## Usage

Not everything here is reusable the same way.

**Drop-in.** `blueprints/`, `python_scripts/light_control.py`, `themes/`, and
the `www/` assets. Copy them into the matching directory under your own
`config/` and they work.

**Drop-in, with dependencies.** `dashboards/`, plus the `lovelace:` block from
`configuration.yaml`. They need the [custom cards](#dependencies) below and
their entity IDs remapped to yours.

**Patterns for reuse** `packages/*`. The area light groups, the aggregate 
sensors that expose a `details` attribute listing what is open, the laundry
cycle state machine serve as a starting point, but every `entity_id` is
specific to this house and has to be rewritten.

**Reference only.** `automations.yaml`. It is UI-managed and its entries
carry generated `id:` values. Do not paste it over your own, or you will
clobber your automations.

## Dashboards

The dashboards are **YAML-mode**, registered in `configuration.yaml`:

```yaml
lovelace:
  dashboards:
    tablet-dashboard:
      mode: yaml
      filename: dashboards/tablet.yaml
      title: Tablet
```

Copying `dashboards/` without that block does nothing. Two consequences worth
knowing before adopting the pattern:

- **`mode: yaml` dashboards are read-only in the HA UI.** Visual editing means
  building in a separate storage-mode dashboard and copying the raw YAML back.
- **`dashboards/streamline_templates/` is pulled in with `!include_dir_named`**,
  which only works in YAML mode.

Adding a dashboard entry needs a full restart. Editing an already-registered
dashboard's content does not.

## Dependencies

The dashboards render blank without these. Install from HACS:

| | |
|---|---|
| Cards | `bubble-card`, `navbar-card`, `streamline-card`, `auto-entities`, `week-planner-card`, `yet-another-media-player`, `scrypted-nvr-camera`, `scrypted-nvr-events-carousel` |
| Frontend | `card-mod` (loaded via `frontend.extra_module_url`), `kiosk-mode` (every dashboard's `kiosk_mode:` block depends on it) |
| Integration | [`chore_calendar`](https://github.com/tcarney/ha-chore-calendar) (my own custom integration). It **ships the `chore-calendar-card`** used on all three dashboards, so there is no separate card to install. |
| Integration | [`Bubble Card Tools`](https://github.com/Clooos/Bubble-Card-Tools) — required for Bubble Card's module system, which the weather card uses. It stores modules as YAML under `config/bubble_card/modules/`. |

## Known Gaps

The alarm, security, and doorbell integrations are **deliberately omitted**
because they utilize private vendor APIs. Entity references to them remain in
`packages/activity_sensors.yaml`, `packages/homekit.yaml`, and the dashboards.
Those are removed integrations, not mistakes.

The weather card declares `modules: [weather_forecast]`, a Bubble Card module
distributed through its author's Patreon rather than the public Module Store.
Install it yourself, or drop the `modules:` and `weather_forecast:` keys and
the card renders without the forecast strip.

`blueprints/template/chore_tracker/` is no longer used. It predates the
`chore_calendar` integration that replaced it, and is kept for reference. Use
it if you want chore tracking without installing an integration.

## References

Dashboard examples:

 - [Rishi8078/Material-You-Dashboard](https://github.com/Rishi8078/Material-You-Dashboard)

Skills:

 - [homeassistant-ai/skills](https://github.com/homeassistant-ai/skills)
