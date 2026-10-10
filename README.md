# Home Assistant configuration

A working Home Assistant setup, published as a reference. Browse it for
patterns and copy what is useful.

This is a sanitized copy of my own config. I changed names and omitted a few
integrations (see [known gaps](#known-gaps)).

## What is here

| Resource | Description | Reuse |
|---|---|---|
| `configuration.yaml` | Entry point; packages, themes, and lovelace config | Reference. Copy the `lovelace:` block with the dashboards. |
| `automations.yaml` | UI-managed automations | Reference only. Its entries carry generated `id:` values. Pasting it over your own overwrites your automations. |
| `packages/` | One self-contained bundle per feature, described under [packages](#packages) | Patterns. Rewrite every `entity_id`, because each one is specific to this house. |
| `blueprints/` | Reusable automation and template blueprints | Drop-in. |
| `dashboards/` | Four YAML-mode dashboards and the streamline card templates | Drop-in with the [custom cards](#dependencies) installed and entity IDs remapped. |
| `python_scripts/` | Ordered, group-aware light control for remotes | Drop-in. |
| `themes/` | A modified catppuccin theme | Drop-in. |
| `www/` | Weather icons, backgrounds, fonts, `timer-face-card.js`, and `timer-face.svg` | Drop-in. |

Drop-in files work once copied into the matching directory under your own
`config/`.

## Blueprints

The blueprints are reusable and carry no entity IDs from this house. Each
entry names the files to copy.

### Pico remote light control

`python_scripts/light_control.py` with
`blueprints/automation/light_control/pico_remote.yaml`. The script drives
lights in ordered steps: one press of **On** lights the main lights, a second
adds the accents, and **Off** unwinds in reverse. The dimmer moves every step
together, sized from the dimmest light going up and the brightest coming
down, so lights that have drifted apart converge instead of spreading further.

All the behavior lives in the script, so a different remote needs only its
own trigger and a button mapping. Needs `python_script:` in
`configuration.yaml`.

### Scene-scaled lights

`blueprints/template/light_control/`. Wraps a light so its brightness is
capped by the current scene. The cap belongs to the light, so dashboards,
HomeKit, and voice inherit it.

### Zone activity sensors

`blueprints/template/activity_sensors/`. Combines an area's door, window, and
motion sensors into one that stays on for a set time after the last event, so
the zone reads as occupied.

### Group state counters

`blueprints/template/status_sensors/group_state_counter.yaml`. Counts how
many members of a group are in a given state, and exposes which ones in a
`details` attribute with timestamps.

### Latching sensors

`blueprints/template/status_sensors/latching_sensor.yaml`. A binary sensor
set by one event and cleared by another, holding its state in between. An
appliance's end-of-cycle signal is on for a couple of seconds, but the sensor
reads `ready` until someone opens the door.

### Chore tracker (unused)

`blueprints/template/chore_tracker/`. This blueprint predates the
`chore_calendar` integration that replaced it, and is kept for reference. Use
it if you want chore tracking without installing an integration.

## Packages

Each package is one file for one feature. Its header comment documents the
behavior, the tuning knobs, and the entries it expects on the host.

### Star jar

`packages/star_jar.yaml`. A reward layer for a child on top of the chores in
the [`chore_calendar`](https://github.com/tcarney/ha-chore-calendar)
integration.

The [`star_jar`](https://github.com/tcarney/ha-star-jar) integration holds
the score: read-only sensors, award, adjust, and redeem actions, and a
ledger. This package decides when a star is earned and calls award. It has
four detectors: chores, bedtime, the morning routine, and a parent's approval
of a request made from the calendar kiosk. A full jar is one reward.

### Chore rewards

`packages/chore_rewards.yaml`. Rewards tied to a chore's state.

On a school day, Morning TV is a star-jar reward that homework unlocks. Once
the child's homework chore is not overdue, a flag makes a Morning TV button
appear on the star-jar pop-up. Redeeming a full jar there turns a TV
downtime switch off.

On other days, clear homework turns downtime off directly. A fixed morning
time turns downtime off regardless. HomeKit turns downtime on at night. The
header documents the triggers, the restart handling, and why the check reads
the chore's status instead of its schedule.

### Clothing recommendation

`packages/clothing_recommendation.yaml`. When the child's **Get Dressed**
chore turns pending, an automation reads the hourly forecast for 9 AM to
6 PM on the day the chore is due. It asks the default AI task entity
(`ai_task.generate_data`) for two or three sentences on what to wear.

The automation writes the answer into the chore's description with
`chore_calendar.update_item`, so it shows on the chore list. If the AI task
fails, the description falls back to the temperature range and the highest
chance of rain. You need an AI task entity set as the default on your host.

### Dashboard timer

`packages/dashboard_timer.yaml`. One countdown for the
[calendar kiosk](#dashboards). While it runs, a 60-minute dial replaces the
kiosk's photo frame. When the countdown finishes, the dial holds at zero and
the readout turns red. A tap clears it on every dashboard.

The dial is `www/timer-face-card.js`, a plain custom card that counts down in
the browser. It chimes when a countdown starts and at each five minutes left.
Register it as a module resource at `/local/timer-face-card.js` under
**Settings** > **Dashboards** > **Resources**. The controls are a streamline
template, described under [card templates](#streamline-card-templates).

### Parent dashboard unlock

`packages/parent_dashboard.yaml`. The kiosks run unauthenticated, so the
parent controls on them open only while this binary sensor is on. Tapping an
NFC tag turns the sensor on, and it turns itself off five minutes later.

### Schedules

`packages/schedules.yaml`. Every time-of-day helper (bedtime, the morning
target, and the morning TV unlock) in one file, with `initial` values so a
restart resets them. The header lists which features read each time, so
moving one shows everything it affects.

### TV time

`packages/tv_time.yaml`. Tracks the hours each Apple TV has played today,
with one `history_stats` sensor per TV and a total that counts time with any
TV playing once. Only playback counts, and nothing says who is watching.

The sensors are `total_increasing`, so long-term statistics keep each day's
total, which the parents dashboard graphs.

### Weather and sun status sensors

`packages/status_sensors.yaml`. Three text sensors that feed the
[Bubble Card](#dependencies) sub-buttons on the weather card, with icons to
match:

- sun status reads `Sunset in 3 hours`, or `UV Index · 7` when the index is
  worth acting on;
- conditions reads `Partly Cloudy · 72° / 58°`, adding the high and low from
  the next seven hours when they differ from now by more than 2°;
- feels like reads `Feels Like · 59°`, and its icon changes to an alert when
  the apparent temperature is 5° or more from the actual temperature.

The package excludes all three from the recorder, since they only reword
entities that are already recorded.

### Laundry status

`packages/gehome_laundry_status.yaml`. Washer and dryer `ready` sensors built
on the latching blueprint: the end-of-cycle pulse sets each one, and opening
the door clears it.

## Dashboards

The four YAML-mode dashboards are registered in `configuration.yaml`. The
wall tablet and the calendar kiosk both run unauthenticated, in Fully Kiosk
Browser with [`kiosk-mode`](#dependencies).

| File | Where it runs | What it shows |
|---|---|---|
| `tablet.yaml` | Wall tablet | Home, calendar, cameras, a view per floor, and outside. [Bubble Card](#dependencies) pop-ups and a navbar. |
| `calendar.yaml` | Calendar kiosk | The family calendar and the child's chores, a stars pop-up for the jar, and a photo frame the timer dial replaces while it runs. A parents pop-up opens only while the unlock sensor is on. Nothing on the kiosk links to that pop-up. |
| `nspanel_upstairs.yaml` | Upstairs wall panel | Home, doorbell, the child's room, climate, and a read-only stars view for bedtime. |
| `parents.yaml` | Parents' phones | Award presets, adjust, the reward menu, the request queue, the timer controls, and the star ledger. |

### Streamline card templates

Templates live in `dashboards/streamline_templates/` and load with
`!include_dir_named`. Each card is defined once and reused across dashboards.
#### Display cards

##### `clock_header`

The time, the date, a weather icon, and the temperature on one line.

##### `weather_detail`

Current conditions and a five-day forecast in one card, with a sunrise/sunset
countdown that switches to a UV warning. Temperatures show `59°` without the
unit letter.

Tapping today replaces the whole card with a graph of the next 24 hours:
temperature, colored by band (indigo, blue, light blue, yellow, orange, and
red) using the theme's color variables, over chance of precipitation, with
touch or drag to read any hour. The graph is `www/forecast-graph-card.js`, a
plain custom card. Register it as a module resource at
`/local/forecast-graph-card.js`.

##### `room_heading`

A room heading with temperature and humidity badges.

##### `lock_with_door`

A lock tile that also shows door state.

##### `popup`

The Bubble Card pop-up frame, so a pop-up is the hash, the
title, and the contents.

#### Control panel groupings

##### `parent_controls`

Award presets, adjust, the reward menu, and the request queue.

##### `timer_controls`

The dashboard timer: controls to start timers, pause or resume, and cancel.

##### `star_jar`

The child's view of the jar: buttons to ask for a star, the prize-box redeem,
and the Morning TV redeem while homework has unlocked it.

##### `active_alerts`

Every entity labeled `alerts` that is on, or below 20 for sensors such as
battery levels.

#### Home badge row

The badge row on the wall tablet's and the calendar kiosk's home views is one
file, `dashboards/badges/home.yaml`, included in both with `!include`. A badge
that opens a pop-up needs that pop-up on each dashboard's home view.

### Register the dashboards in YAML mode

Register each dashboard like this:

```yaml
lovelace:
  dashboards:
    tablet-dashboard:
      mode: yaml
      filename: dashboards/tablet.yaml
      title: Tablet
```

Copying `dashboards/` without that block does nothing. Two consequences:

- `mode: yaml` dashboards are read-only in the Home Assistant UI. Visual
  editing means building in a separate storage-mode dashboard and copying the
  raw YAML back.
- `dashboards/streamline_templates/` loads with `!include_dir_named`, which
  only works in YAML mode.

Adding a dashboard entry needs a full restart. Editing an already-registered
dashboard's content does not. Home Assistant re-reads a YAML dashboard only
when the dashboard file's own modification time moves. After editing a
streamline template, the badge file, or a theme, `touch` the dashboard files
before you copy them, or copy with a tool that does not preserve timestamps.

## Dependencies

The dashboards render blank without these. Install from HACS:

| Type | Name and notes |
|---|---|
| Cards | `bubble-card`, `navbar-card`, `streamline-card`, `auto-entities`, `week-planner-card` |
| Frontend | `card-mod` (loaded via `frontend.extra_module_url`), `kiosk-mode` |
| Integration | [`chore_calendar`](https://github.com/tcarney/ha-chore-calendar) (my own custom integration). It ships the `chore-calendar-card` used on the wall tablet, calendar kiosk, and upstairs dashboards, so there is no separate card to install. |
| Integration | [`star_jar`](https://github.com/tcarney/ha-star-jar) (my own custom integration, installed as a HACS custom repository). It ships the `star-jar-card` and registers it as a resource itself. The star jar package and the stars surfaces need it. |
| Integration | [`Bubble Card Tools`](https://github.com/Clooos/Bubble-Card-Tools), required for Bubble Card's module system, which the weather card uses. It stores modules as YAML under `config/bubble_card/modules/`. |
| Integration | [`scrypted`](https://github.com/koush/ha_scrypted) connects to a Scrypted NVR and ships the `scrypted-nvr-camera` and `scrypted-nvr-events-carousel` cards. |

## Known gaps

The alarm, security, and doorbell integrations are omitted because they use
private vendor APIs. Entity references to them remain in
`packages/activity_sensors.yaml`, `packages/homekit.yaml`, and the
dashboards.

The weather card declares `modules: [weather_forecast]`, a Bubble Card module
distributed through its author's Patreon rather than the public Module Store.
Install it yourself, or drop the `modules:` and `weather_forecast:` keys and
the card renders without the forecast strip.

## See also

- [Rishi8078/Material-You-Dashboard](https://github.com/Rishi8078/Material-You-Dashboard): dashboard design examples
- [homeassistant-ai/skills](https://github.com/homeassistant-ai/skills): skills for AI agents that edit Home Assistant config
