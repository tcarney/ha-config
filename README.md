# Home Assistant Configuration

A working Home Assistant setup, published as a reference. Browse it for
patterns, copy what is useful.

This is a sanitized copy of my own config. Names have been changed and a few
integrations withheld (see [known gaps](#known-gaps)).

## What is here

| Resource | Description |
|---|---|
| `configuration.yaml` | entry point; packages, themes, and lovelace config |
| `automations.yaml` | UI-managed automations (see caveat below) |
| `packages/` | per-feature bundles: lights, climate, sensors, laundry, star jar, timer |
| `blueprints/ ` | reusable automation and template blueprints |
| `dashboards/` | four YAML-mode dashboards + streamline card templates |
| `python_scripts/` | ordered, group-aware light control for remotes |
| `themes/` | modified catppuccin theme(s) |
| `www/` | weather icons, backgrounds, fonts, the timer dial face |

The components are grouped below by where they live: [blueprints](#blueprints),
[packages](#packages), and [dashboards](#dashboards).

## Blueprints

**Pico remote light control.** `python_scripts/light_control.py` with
`blueprints/automation/light_control/pico_remote.yaml`. Lights are driven in
ordered steps: one press of *on* lights the mains, a second adds the accents,
and *off* unwinds in reverse. The dimmer moves every step together, sized from
the dimmest light going up and the brightest coming down, so lights that have
drifted apart converge instead of spreading further.

All the behavior lives in the script, so a different remote needs only its
own trigger and a button mapping. Needs `python_script:` in
`configuration.yaml`.

**Scene-scaled lights.** `blueprints/template/light_control/`. Wraps a light
so its brightness is capped by the current scene. The cap belongs to the light,
so dashboards, HomeKit and voice inherit it.

**Zone activity sensors.** `blueprints/template/activity_sensors/`. Rolls an
area's door, window and motion sensors into one that stays on for a set time
after the last event, so the zone reads as occupied.

**Group state counters.** `blueprints/template/status_sensors/`. Counts how
many members of a group are in a given state, and exposes *which* ones in a
`details` attribute with timestamps.

**Latching sensors.** `blueprints/template/status_sensors/`. A binary sensor
set by one event and cleared by another, holding its state in between: an
appliance's end-of-cycle signal is on for a couple of seconds, but the sensor
reads *ready* until someone opens the door.

## Packages

**Star jar.** `packages/star_jar.yaml`. A reward layer for a child on top of
the chores in the [`chore_calendar`](https://github.com/tcarney/ha-chore-calendar)
integration. The [`star_jar`](https://github.com/tcarney/ha-star-jar)
integration holds the score: read-only sensors, the award, adjust and redeem
services, and a ledger. This package decides *when* a star is earned and
calls award, from four detectors: chores, bedtime, the morning routine, and
a parent's approval of a request made from the kiosk. A full jar is one
reward. The file's header documents each detector, the tuning knobs, and the
entries it expects on the host.

**Dashboard timer.** `packages/dashboard_timer.yaml`. One countdown for the
calendar kiosk. A parent starts it. While it runs, the kiosk's photo frame
gives way to a 60-minute dial, and for a minute after it finishes the dial
holds at zero with the readout turned red. The dial and the controls are
streamline templates, described under [dashboards](#dashboards).

**Parent dashboard unlock.** `packages/parent_dashboard.yaml`. The kiosks run
unauthenticated, so the parent controls on them open only while this binary
sensor is on. A tap of an NFC tag turns it on and it clears itself five
minutes later.

**Sun status sensor.** `packages/status_sensors.yaml`. One sensor whose state
reads `Sunset in 3 hours`, or `UV Index · 7` when the index is worth acting on,
with an icon to match.

**Laundry status.** `packages/gehome_laundry_status.yaml`. Washer and dryer
*ready* sensors built on the latching blueprint: set by the end-of-cycle
pulse, cleared when the door opens.

## Dashboards

Four YAML-mode dashboards, registered in `configuration.yaml`:

| File | Where it runs | What it shows |
|---|---|---|
| `tablet.yaml` | Wall tablet, kiosk mode | Home, calendar, cameras, a view per floor, and outside. Bubble Card pop-ups and a navbar. |
| `calendar.yaml` | Shared tablet, unauthenticated | The family calendar and the child's chores, a stars pop-up for the jar, a photo frame the timer dial replaces while it runs, and a parents pop-up that opens only while the unlock sensor is on. Nothing on the kiosk links to that pop-up. |
| `nspanel_upstairs.yaml` | Upstairs wall panel | Home, doorbell, the child's room, climate, and a read-only stars view for bedtime. |
| `parents.yaml` | Parents' phones | Award presets, adjust, the reward menu, the request queue, the timer controls, and the star ledger. |

### Streamline card templates

`dashboards/streamline_templates/`, pulled in with `!include_dir_named`. Each
card is defined once and reused across dashboards:

- `clock_header`: the time, the date, a weather icon and the temperature on
  one line.
- `weather_detail`: current conditions, an hourly strip and a five-day
  outlook, with a sunrise/sunset countdown that switches to a UV warning.
- `room_heading`: a room heading with temperature and humidity badges.
- `lock_with_door`: a lock tile that also shows door state.
- `popup`: the Bubble Card pop-up chrome, so a pop-up is the hash, the title
  and the contents.
- `parent_controls`: award presets, adjust, the reward menu and the request
  queue. The same YAML backs the parents dashboard and the kiosk's parents
  pop-up.
- `timer_controls`: what is left, four preset starts, pause or resume, and
  cancel.
- `timer_face`: the 60-minute dial, a wedge that drains counter-clockwise
  with the mm:ss readout in the middle. Its face is an SVG used as a CSS
  mask.

### YAML mode

The dashboards are registered like this:

```yaml
lovelace:
  dashboards:
    tablet-dashboard:
      mode: yaml
      filename: dashboards/tablet.yaml
      title: Tablet
```

Copying `dashboards/` without that block does nothing. Two consequences:

- **`mode: yaml` dashboards are read-only in the HA UI.** Visual editing means
  building in a separate storage-mode dashboard and copying the raw YAML back.
- **`dashboards/streamline_templates/` is pulled in with `!include_dir_named`**,
  which only works in YAML mode.

Adding a dashboard entry needs a full restart. Editing an already-registered
dashboard's content does not, with one catch: Home Assistant re-reads a YAML
dashboard only when the dashboard file's own modification time moves. After
editing a streamline template or a theme, `touch` the dashboard files before
you copy them, or copy with a tool that does not preserve timestamps.

## Usage

Four tiers of reuse:

**Drop-in.** `blueprints/`, `python_scripts/light_control.py`, `themes/`, and
the `www/` assets. Copy them into the matching directory under your own
`config/` and they work.

**Drop-in, with dependencies.** `dashboards/`, plus the `lovelace:` block from
`configuration.yaml`. They need the [custom cards](#dependencies) below and
their entity IDs remapped to yours.

**Patterns for reuse.** `packages/*`. The area light groups, the aggregate
sensors that expose a `details` attribute listing what is open, the star jar
detectors, and the dashboard timer serve as starting points, but every
`entity_id` is specific to this house and has to be rewritten.

**Reference only.** `automations.yaml`. It is UI-managed and its entries
carry generated `id:` values. Do not paste it over your own, or you will
clobber your automations.

## Dependencies

The dashboards render blank without these. Install from HACS:

| | |
|---|---|
| Cards | `bubble-card`, `navbar-card`, `streamline-card`, `auto-entities`, `week-planner-card`, `yet-another-media-player`, `scrypted-nvr-camera`, `scrypted-nvr-events-carousel` |
| Frontend | `card-mod` (loaded via `frontend.extra_module_url`), `kiosk-mode` (every dashboard's `kiosk_mode:` block depends on it) |
| Integration | [`chore_calendar`](https://github.com/tcarney/ha-chore-calendar) (my own custom integration). It **ships the `chore-calendar-card`** used on the tablet, calendar and upstairs dashboards, so there is no separate card to install. |
| Integration | [`star_jar`](https://github.com/tcarney/ha-star-jar) (my own custom integration, installed as a HACS custom repository). It **ships the `star-jar-card`** and registers it as a resource itself. The star jar package and the stars surfaces need it. |
| Integration | [`Bubble Card Tools`](https://github.com/Clooos/Bubble-Card-Tools), required for Bubble Card's module system, which the weather card uses. It stores modules as YAML under `config/bubble_card/modules/`. |

## Known Gaps

The alarm, security, and doorbell integrations are **deliberately omitted**
because they use private vendor APIs. Entity references to them remain in
`packages/activity_sensors.yaml`, `packages/homekit.yaml`, and the dashboards.
Those references are expected.

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
