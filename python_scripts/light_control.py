# Light Control for the python_script integration
# Converted from a pyscript class-based implementation.
#
# Ordered, group-aware light control for a five-button remote: on, off, a
# favorite level, and a dimmer that ramps in fixed steps.
#
#
# CALLING
#
#   action: python_script.light_control
#   data:
#     button: on | off | favorite | raise | lower
#     lights:
#       - light.main_group   # a light group: one step holding several lights
#       - light.accent       # a single light: one step of one
#     favorite: 0.5          # optional, fraction of full brightness
#     steps: 5               # optional, presses to cross the full range
#
# `favorite` and `steps` default to FAV and STEPS below. They are per-call so
# a room can be tuned without editing this file. For example, a bedroom might
# want a lower favorite level and a finer ramp than a kitchen.
#
# The button names are this script's own vocabulary. A caller must map its
# events onto them. Anything can call this: a remote, a dashboard button, 
# a voice command.
#
#
# STEPS
#
# `lights` is an ordered list of steps. Each entry is expanded through group
# membership to the lights behind it, so a group counts as one step while the
# ramp still sees each member's own brightness. That matters: a light group
# reports the mean of its members.
#
# Expansion stops at anything that is not a group, so a template light stays
# whole and keeps its own behavior. Entities that do not exist are dropped.
#
#
# BUTTONS
#
#   on        turn on the first step that is not already fully on, so a
#             second press adds the next step
#   off       turn off the last step that still has a light on, unwinding
#             the order "on" built up
#   favorite  set every light to the favorite level
#   raise     ramp all steps up, in `steps` increments sized from the dimmest
#             light, so lights that have drifted apart converge rather than
#             spreading further
#   lower     the same downward, sized from the brightest light
#
# A light that cannot take a brightness is treated as on/off: it switches at
# any non-zero target and sits out the ramp. Capability is read from
# supported_color_modes.
#
#
# WHAT DOES NOT BELONG HERE
#
# Brightness caps. A cap applied by a caller binds only that caller. Wrap the
# light in a scaled template light instead and every caller inherits it,
# dashboards and HomeKit included. See blueprints/template/light_control/.
#
# Waiting for lights to settle. A python_script cannot await, so a caller
# that can repeat quickly has to settle between calls itself.
# See blueprints/automation/light_control/pico_remote.yaml.

FULL = 255           # brightness value a light reports at 100%
FAV = 0.5            # default level the favorite button selects
OFF_THRESHOLD = 0.01  # below this, turn off rather than dim
STEPS = 5            # default presses to cross the full range
ROUND = 0.1          # tolerance when snapping a level onto a step
ON = 1.0
OFF = 0.0


def ceil(n):
    return int(-1 * n // 1 * -1)


def floor(n):
    return int(n // 1)


# --- Light functions ---

def expand(hass, entity_id):
    """The lights behind an entity, following group membership to the leaves."""
    st = hass.states.get(entity_id)
    if st is None:
        return []
    members = st.attributes.get('entity_id')
    if not members:
        return [entity_id]
    out = []
    for member in members:
        for leaf in expand(hass, member):
            if leaf not in out:
                out.append(leaf)
    return out


def light_level(hass, entity_id):
    """Brightness as 0.0-1.0. A light with no brightness attribute is on/off only."""
    st = hass.states.get(entity_id)
    if st is None or st.state != 'on':
        return OFF
    brightness = st.attributes.get('brightness')
    if brightness is None:
        return ON
    return brightness / FULL


def light_is_dimmable(hass, entity_id):
    """Whether a light takes a brightness.

    Home Assistant drops the brightness attribute when a light is off, so
    checking for it alone makes a dimmable light that happens to be off look
    like an on/off switch. It would then be turned on at full instead of at
    the level asked for. Fall back to the capability list, which is reported
    whatever the light is doing.
    """
    st = hass.states.get(entity_id)
    if st is None:
        return False
    if st.attributes.get('brightness') is not None:
        return True
    for mode in st.attributes.get('supported_color_modes') or []:
        if mode != 'onoff':
            return True
    return False


def light_set(hass, entity_id, src, target, steps=1):
    """Move a light one step of `steps` toward target."""
    if steps == 0:
        return

    old = light_level(hass, entity_id)
    if old == target:
        return

    if light_is_dimmable(hass, entity_id):
        new = old + (target - old) / steps
    else:
        new = OFF if target == OFF else ON

    logger.info("  %s %-30s  %.2f -> %.2f", src, entity_id, old, new)

    if new < OFF_THRESHOLD:
        hass.services.call('light', 'turn_off', {'entity_id': entity_id})
    else:
        hass.services.call('light', 'turn_on',
                           {'entity_id': entity_id, 'brightness': round(new * FULL)})


# --- Group functions ---

def group_levels(hass, group):
    """Levels of the dimmable lights in a group."""
    return [light_level(hass, e) for e in group if light_is_dimmable(hass, e)]


def group_any_on(hass, group):
    return any(light_level(hass, e) != OFF for e in group)


def group_any_off(hass, group):
    return any(light_level(hass, e) == OFF for e in group)


def group_apply(hass, group, src, target, steps=1):
    for entity_id in group:
        light_set(hass, entity_id, src, target, steps)


# --- Area functions ---

def area_on(hass, groups):
    """Light groups in order, stopping after the first that was not fully on."""
    for group in groups:
        stop = group_any_off(hass, group)
        group_apply(hass, group, 'on', ON)
        if stop:
            return


def area_off(hass, groups):
    """Unwind from the last group, stopping after the first that had a light on."""
    for group in groups[::-1]:
        stop = group_any_on(hass, group)
        group_apply(hass, group, 'off', OFF)
        if stop:
            return


def area_fav(hass, groups, level):
    for group in groups:
        stop = group_any_off(hass, group)
        group_apply(hass, group, 'fav', level)
        if stop:
            return


def area_dim(hass, groups, src, target, steps):
    """Step every group toward target, sized from the group's extreme light.

    `steps` is how many presses cross the whole range; `remaining` is how many
    are left from where the lights already sit.
    """
    levels = []
    for group in groups:
        levels.extend(group_levels(hass, group))
    if not levels:
        return

    if target == ON:
        start = min(levels)
        remaining = steps - max(0, floor(start * steps + ROUND))
    else:
        start = max(levels)
        remaining = min(steps, ceil(start * steps - ROUND))

    logger.info("  %s start %.2f steps %d", src, start, remaining)
    for group in groups:
        group_apply(hass, group, src, target, remaining)


# --- Main entry point ---

button = data.get('button')

favorite = float(data.get('favorite', FAV))
if favorite < OFF:
    favorite = OFF
if favorite > ON:
    favorite = ON

steps = int(data.get('steps', STEPS))
if steps < 1:
    steps = 1

groups = []
for entry in data.get('lights', []):
    members = expand(hass, entry)
    if members:
        groups.append(members)

if button == 'on':
    area_on(hass, groups)
elif button == 'off':
    area_off(hass, groups)
elif button == 'favorite':
    area_fav(hass, groups, favorite)
elif button == 'raise':
    area_dim(hass, groups, 'up', ON, steps)
elif button == 'lower':
    area_dim(hass, groups, 'dn', OFF, steps)
