/**
 * Timer face card.
 *
 * A 60-minute dial for the dashboard timer, drawn the way a kitchen timer
 * is: marks and labels clockwise from 0 at the top like a clock, a wedge
 * from 0 round to the minute that is left so it drains counter-clockwise
 * as time passes, and the mm:ss readout in the middle with what the
 * countdown is for above it and "Paused" below it while it is. Done is the
 * readout disc turning red with "Done" below the time, the label still
 * above it, until the dial is tapped: that turns `shown_entity` off, which
 * is what every dashboard watches, so one tap clears them all. It draws the largest square that fits its slot, centred, so it
 * works in a tall kiosk slot or a phone column alike.
 *
 *   type: custom:timer-face-card
 *   entity: timer.dashboard                          # required
 *   label_entity: input_text.dashboard_timer_label   # optional
 *   shown_entity: input_boolean.dashboard_timer_shown # optional: on from
 *                                                     # start to acknowledged
 *   chime: true                                      # optional, default true
 *   grid_options:
 *     columns: full
 *     rows: 9
 *
 * The countdown is computed here, the way Home Assistant's own tile does
 * it: while the timer is active, the seconds left are `finishes_at` minus
 * the browser's clock, recomputed on a timer that fires on each second
 * boundary; paused, they are the timer's `remaining` attribute; idle, zero.
 * Nothing on the backend ticks. The face is `timer-face.svg` used as a mask
 * over a theme color, so the marks follow the theme and the SVG stays a
 * single black shape. The wedge is a conic gradient whose angle is one CSS
 * variable.
 *
 * Everything scales with the dial, which is sized in container units of
 * the host. The readout disc is READOUT_PX (its size on the kiosk's 568px
 * dial, nine grid rows) and holds that as the dial shrinks, so it takes a
 * growing share of the dial, until it reaches READOUT_MAX_PCT of the dial
 * and shrinks with it from there; on dials larger than the kiosk it keeps
 * its kiosk share, READOUT_MIN_PCT. The time, the gap and the
 * "Paused"/"Done" line are fixed fractions of the disc. The label above the
 * time starts at the same size as the line below and shrinks to fit its
 * text within the disc, so "Ready for school" is a little smaller than
 * "Homework". Either label is dropped, rather than squeezed, once it would
 * be under LABEL_FLOOR_PX; the time re-centres.
 *
 * The card chimes, a short bell synthesised with the Web Audio API, when a
 * countdown starts (idle to active; a resume is silent) and as each whole
 * five minutes left goes by, 5:00 down to 55:00 but never 0:00: what
 * happens when the timer finishes is for an automation, which can reach the
 * house's speakers. Every browser showing the card chimes, so set
 * `chime: false` where it should not. The chime needs the browser to allow
 * audio without a touch: in Fully Kiosk that is Web Content Settings →
 * Autoplay Videos and Autoplay Audio. Failing that, the first touch on the
 * page unlocks it, and a chime that could not play logs one warning.
 *
 * Registered as a Lovelace resource (Settings → Dashboards → Resources).
 * Bump the query on the resource URL, or clear the kiosk's cache, after
 * editing this.
 */

const FACE_URL = "/local/timer-face.svg";

// Readout disc: its size on the kiosk, and the share of the dial it is
// held between on dials larger (min) and smaller (max) than that.
const READOUT_PX = 160;
const READOUT_MIN_PCT = 28.2;
const READOUT_MAX_PCT = 55;

// Labels drop out once they would be smaller than this.
const LABEL_FLOOR_PX = 10;

// The chime: a bell at CHIME_HZ made of [harmonic, level, seconds to fade]
// partials, at CHIME_GAIN overall. Chimes fall every CHIME_EVERY_S left.
const CHIME_HZ = 880;
const CHIME_PARTIALS = [[1, 1, 0.9], [2, 0.35, 0.5], [3, 0.12, 0.3]];
const CHIME_GAIN = 0.3;
const CHIME_EVERY_S = 300;
// Two chimes closer than this collapse into one: a countdown started on a
// five-minute mark would otherwise ring for the start and the mark both.
const CHIME_GAP_MS = 2000;

const STYLE = `
  :host {
    display: grid;
    place-items: center;
    height: 100%;
    min-height: 160px;
    container-type: size;
  }
  ha-card {
    position: relative;
    width: min(100cqw, 100cqh);
    height: min(100cqw, 100cqh);
    box-sizing: border-box;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 50%;
    background: color-mix(in srgb, var(--card-background-color) 70%, transparent);
  }
  .wedge, .face {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    aspect-ratio: 1 / 1;
    pointer-events: none;
  }
  .wedge {
    height: 80%;
    border-radius: 50%;
    background: conic-gradient(
      color-mix(in srgb, var(--primary-color) 70%, transparent) 0deg var(--angle),
      transparent var(--angle) 360deg);
  }
  .face {
    height: 100%;
    background-color: var(--secondary-text-color);
    -webkit-mask: var(--timer-face-url, url(${FACE_URL})) center / contain no-repeat;
    mask: var(--timer-face-url, url(${FACE_URL})) center / contain no-repeat;
  }
  .readout {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    align-content: center;
    --readout: max(${READOUT_MIN_PCT}cqmin, min(${READOUT_PX}px, ${READOUT_MAX_PCT}cqmin));
    row-gap: calc(var(--readout) * 0.053);
    width: var(--readout);
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    color: var(--card-background-color);
    background: color-mix(in srgb, var(--secondary-text-color) 80%, var(--primary-color));
  }
  .readout.done {
    background: var(--red-color, #e53935);
  }
  ha-card.done {
    cursor: pointer;
  }
  .time {
    font-size: calc(var(--readout) * 0.28);
    font-weight: 680;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .label, .state {
    font-size: calc(var(--readout) * 0.1);
    font-weight: 600;
    line-height: 1;
    max-width: calc(var(--readout) * 0.75);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-height: 1em;
  }
  .label {
    font-size: calc(var(--readout) * 0.1 * var(--label-scale, 1));
  }
  .label.dropped, .state.dropped {
    display: none;
  }
`;

class TimerFaceCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "timer.dashboard" };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("timer-face-card: `entity` (the timer) is required");
    }
    this._config = config;
    this._build();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() {
    return 6;
  }

  disconnectedCallback() {
    this._stop();
  }

  connectedCallback() {
    this._update();
  }

  _build() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="wedge"></div>
        <div class="face"></div>
        <div class="readout">
          <div class="label"></div>
          <div class="time"></div>
          <div class="state"></div>
        </div>
      </ha-card>
    `;
    this._els = {
      card: root.querySelector("ha-card"),
      wedge: root.querySelector(".wedge"),
      readout: root.querySelector(".readout"),
      label: root.querySelector(".label"),
      time: root.querySelector(".time"),
      state: root.querySelector(".state"),
    };
    // Refit the label whenever the disc changes size (first layout included).
    this._observer?.disconnect();
    this._observer = new ResizeObserver(() => this._fit());
    this._observer.observe(this._els.readout);
    if (this._config.chime !== false) {
      audioSetup();
    }
    this._els.card.addEventListener("click", () => this._acknowledge());
  }

  _update() {
    if (!this._hass || !this._els) {
      return;
    }
    const timer = this._hass.states[this._config.entity];
    const label = this._config.label_entity ? this._hass.states[this._config.label_entity] : undefined;
    const shown = this._config.shown_entity ? this._hass.states[this._config.shown_entity] : undefined;
    const was = this._timer?.state;
    this._timer = timer;
    if (timer?.state !== was) {
      // A fresh count: the five-minute check starts over from the next tick.
      this._lastLeft = undefined;
      if (was === "idle" && timer?.state === "active") {
        this._chime();
      }
    }

    const labelText = label?.state;
    this._els.label.textContent = labelText && labelText !== "unknown" && labelText !== "unavailable" ? labelText : "";
    const finished = shown?.state === "on" && timer?.state === "idle";
    this._finished = finished;
    this._els.state.textContent = timer?.state === "paused" ? "Paused" : finished ? "Done" : "";
    this._els.readout.classList.toggle("done", finished);
    this._els.card.classList.toggle("done", finished);

    this._fit();
    this._tick();
  }

  // Shrinks the label to fit the disc, and drops either line once it would
  // be too small to read. Needs layout, so it is a no-op until the card is
  // on screen; the ResizeObserver calls it again then.
  _fit() {
    const { label, state } = this._els;
    label.style.removeProperty("--label-scale");
    label.classList.remove("dropped");
    state.classList.remove("dropped");
    if (label.clientWidth === 0 && state.clientWidth === 0) {
      return;
    }
    const base = parseFloat(getComputedStyle(state).fontSize);
    state.classList.toggle("dropped", base < LABEL_FLOOR_PX);
    // Measure the text unclipped, in fractional pixels (the clipped width
    // rounds up and leaves the ellipsis showing), and go round again if it
    // still overflows: text width is not quite linear in font size once
    // hinting and optical sizing come into it.
    const limit = parseFloat(getComputedStyle(label).maxWidth);
    let scale = 1;
    for (let pass = 0; pass < 3; pass++) {
      label.style.maxWidth = "none";
      const full = label.getBoundingClientRect().width;
      label.style.removeProperty("max-width");
      if (full <= limit) {
        break;
      }
      scale *= (limit / full) * 0.98;
      label.style.setProperty("--label-scale", scale.toFixed(3));
    }
    if (base * scale < LABEL_FLOOR_PX) {
      label.classList.add("dropped");
    }
  }

  // Draws the seconds left and, while the timer is active, books the next
  // draw for the moment the count changes, so the digits flip on the
  // timer's own second boundaries rather than the page's.
  _tick() {
    this._stop();
    const timer = this._timer;
    let left = 0;
    if (timer?.state === "active") {
      const ms = new Date(timer.attributes.finishes_at).getTime() - Date.now();
      left = Math.max(Math.ceil(ms / 1000), 0);
      if (ms > 0) {
        const untilFlip = ((ms % 1000) + 1000) % 1000 || 1000;
        this._timeout = window.setTimeout(() => this._tick(), untilFlip + 20);
      }
      // Chime once per whole five minutes passed since the last tick, so a
      // tick that arrives late (a throttled tab) still rings, once. Zero is
      // left out: finishing is an automation's to announce.
      if (this._lastLeft !== undefined && left > 0
          && Math.floor((this._lastLeft - 1) / CHIME_EVERY_S) > Math.floor((left - 1) / CHIME_EVERY_S)) {
        this._chime();
      }
      this._lastLeft = left;
    } else if (timer?.state === "paused") {
      left = parseDuration(timer.attributes.remaining);
    }
    this._els.time.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    this._els.wedge.style.setProperty("--angle", `${(left / 10).toFixed(2)}deg`);
  }

  _stop() {
    if (this._timeout) {
      window.clearTimeout(this._timeout);
      this._timeout = undefined;
    }
  }

  // A tap on the finished screen clears it everywhere by switching the
  // shown entity off; a tap at any other time does nothing.
  _acknowledge() {
    if (this._finished && this._config.shown_entity) {
      this._hass.callService("homeassistant", "turn_off", { entity_id: this._config.shown_entity });
    }
  }

  _chime() {
    const now = Date.now();
    if (this._config.chime !== false && now - (this._chimedAt ?? 0) >= CHIME_GAP_MS) {
      this._chimedAt = now;
      chime();
    }
  }
}

// One AudioContext for the page, made when the first card is built so it is
// running by the time a chime is due, if the browser allows audio without a
// touch. If it does not, the first touch or key on the page starts it, and
// a chime before then is skipped with one warning rather than played late.
let audio;
let audioWarned = false;

function audioSetup() {
  if (audio) {
    return;
  }
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return;
  }
  audio = new Context();
  const unlock = () => {
    if (audio.state === "suspended") {
      audio.resume();
    }
  };
  unlock();
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, unlock, { passive: true });
  }
}

function chime() {
  if (!audio || audio.state !== "running") {
    if (!audioWarned) {
      audioWarned = true;
      console.warn("timer-face-card: chime skipped, audio not allowed until the page is touched");
    }
    return;
  }
  const t = audio.currentTime;
  const out = audio.createGain();
  out.gain.value = CHIME_GAIN;
  out.connect(audio.destination);
  for (const [harmonic, level, fade] of CHIME_PARTIALS) {
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = CHIME_HZ * harmonic;
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + fade);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + fade);
  }
}

// "0:09:30" (a timer's remaining attribute) to whole seconds.
function parseDuration(value) {
  if (!value) {
    return 0;
  }
  const parts = String(value).split(":").map((part) => parseInt(part, 10) || 0);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

customElements.define("timer-face-card", TimerFaceCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "timer-face-card",
  name: "Timer face",
  description: "A 60-minute kitchen-timer dial for a timer entity.",
  preview: false,
});
