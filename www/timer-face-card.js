/**
 * Timer face card.
 *
 * A 60-minute dial for the dashboard timer, drawn the way a kitchen timer
 * is: marks and labels clockwise from 0 at the top like a clock, a wedge
 * from 0 round to the minute that is left so it drains counter-clockwise
 * as time passes, and the mm:ss readout in the middle with what the
 * countdown is for above it and "Paused" below it while it is. Done is the
 * readout disc turning red with "Done" below the time, the label still
 * above it. It fills whatever height it is given and stays square, so put
 * it in a tall grid slot.
 *
 *   type: custom:timer-face-card
 *   entity: timer.dashboard                          # required
 *   label_entity: input_text.dashboard_timer_label   # optional
 *   done_entity: binary_sensor.dashboard_timer_done  # optional
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
 * Loaded by `frontend.extra_module_url` in configuration.yaml; bump the
 * version query there after editing this.
 */

const FACE_URL = "/local/timer-face.svg";

const STYLE = `
  ha-card {
    position: relative;
    height: 100%;
    min-height: 320px;
    aspect-ratio: 1 / 1;
    margin: 0 auto;
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
    row-gap: 8px;
    width: 150px;
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    color: var(--card-background-color);
    background: color-mix(in srgb, var(--secondary-text-color) 80%, var(--primary-color));
  }
  .readout.done {
    background: var(--red-color, #e53935);
  }
  .time {
    font-size: 42px;
    font-weight: 680;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .label, .state {
    font-size: 15px;
    font-weight: 600;
    line-height: 1;
    max-width: 126px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    min-height: 1em;
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
      wedge: root.querySelector(".wedge"),
      readout: root.querySelector(".readout"),
      label: root.querySelector(".label"),
      time: root.querySelector(".time"),
      state: root.querySelector(".state"),
    };
  }

  _update() {
    if (!this._hass || !this._els) {
      return;
    }
    const timer = this._hass.states[this._config.entity];
    const label = this._config.label_entity ? this._hass.states[this._config.label_entity] : undefined;
    const done = this._config.done_entity ? this._hass.states[this._config.done_entity] : undefined;
    this._timer = timer;

    const labelText = label?.state;
    this._els.label.textContent = labelText && labelText !== "unknown" && labelText !== "unavailable" ? labelText : "";
    const finished = done?.state === "on" && timer?.state === "idle";
    this._els.state.textContent = timer?.state === "paused" ? "Paused" : finished ? "Done" : "";
    this._els.readout.classList.toggle("done", finished);

    this._tick();
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
