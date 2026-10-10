/**
 * Forecast graph card.
 *
 * Wraps another card, normally the daily Bubble Weather forecast, and swaps
 * it for a graph of the next 24 hours when the first day (today) is
 * tapped. The graph is two panes on one time axis: temperature as a smoothed
 * line with a faint fill, and chance of precipitation as bars on a fixed
 * 0-100% scale. The close button in the corner swaps the wrapped card back.
 *
 *   type: custom:forecast-graph-card
 *   entity: weather.home_weather   # required
 *   hours: 24                      # optional, default 24
 *   icon_size: 26                  # optional, px, default 26
 *   card:                          # required: the card shown until tapped
 *     type: custom:bubble-card
 *     ...
 *
 * Touch or drag across the graph to pick an hour: it snaps to the nearest
 * one, draws a line through both panes, and shows that hour's time,
 * condition icon, temperature, and chance of precipitation in the header.
 * The pick stays after the finger lifts. Dragging sideways scrubs; dragging
 * up or down still scrolls the page.
 *
 * The hours are the forecast from the current hour on (an entry up to 30
 * minutes old still counts, the rule the Bubble Weather module uses for its
 * hourly strip), the first `hours` of them. The hour labels
 * thin out to every second, third, fourth, or sixth hour so each label gets
 * LABEL_PX of width. The forecast is pushed by `weather/subscribe_forecast`
 * while the graph is open, and the hours are recounted each minute so the
 * graph moves on with the clock.
 *
 * The condition icon is the one the Bubble Weather strip shows: Bubble
 * Card's `getWeatherIcon`, which the module leaves on `window.__bcwfCtx`,
 * with WEATHER_ICONS (the same map) as the fallback before the module has
 * run. The strip sizes its icons itself, up to 26px on a card as tall as the
 * `weather_detail` one; `icon_size` matches that by default.
 *
 * The temperature line and fill are colored by band, following the Apple
 * Weather order (cold blues, then yellow, orange, and red, with no green),
 * in HA's theme color variables so the colors follow the theme. The colors
 * blend rather than step: each band's color sits at the middle of the band
 * (BAND_ANCHORS_F, from the °F cut points in BANDS_F) and the gradient runs
 * between them. The gradient is laid out in temperature, not across the
 * pane, so a given temperature is the same color whatever the day's range.
 * The dot and the header temperature take the blended color at their value,
 * with `color-mix`. °C forecasts are converted to °F to find their color.
 *
 * The tap is found from the click's composed path, which crosses the
 * wrapped card's open shadow root; the first `.bc-weather-day` in the
 * Bubble Weather grid is today. The module makes its whole strip
 * `pointer-events: none`, so today's cell only shows up in the path when
 * the wrapped card's styles give it `pointer-events: auto`. Failing that,
 * the click point is checked against the cell's box. The graph takes the
 * wrapped card's height when it opens, with GRAPH_MIN_PX as a floor, so the
 * layout below moves as little as it can.
 *
 * Registered as a Lovelace resource (Settings → Dashboards → Resources).
 * Bump the query on the resource URL, or clear the kiosk's cache, after
 * editing this.
 */

// Band cut points in °F: under 32 is band 0, 87 and over is band 5.
const BANDS_F = [32, 45, 65, 77, 87];
const BAND_COLORS = [
  "var(--indigo-color)",
  "var(--blue-color)",
  "var(--light-blue-color)",
  "var(--yellow-color)",
  "var(--orange-color)",
  "var(--red-color)",
];

// Where each band's color sits, in °F: the middle of the band, and for the
// open-ended bands at either end, half the neighboring band's width past
// the cut.
const BAND_ANCHORS_F = BAND_COLORS.map((_, index) => {
  if (index === 0) {
    return BANDS_F[0] - (BANDS_F[1] - BANDS_F[0]) / 2;
  }
  if (index === BANDS_F.length) {
    return BANDS_F[index - 1] + (BANDS_F[index - 1] - BANDS_F[index - 2]) / 2;
  }
  return (BANDS_F[index - 1] + BANDS_F[index]) / 2;
});

// Condition to icon, as Bubble Card's getWeatherIcon maps it.
const WEATHER_ICONS = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  exceptional: "mdi:alert-circle-outline",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
};

// Forecast entries older than this still count as the current hour.
const STALE_MS = 30 * 60 * 1000;

// The graph never opens smaller than this, whatever the wrapped card's
// height.
const GRAPH_MIN_PX = 200;

// Width each hour label needs; LABEL_STEPS are the spacings tried, in hours.
const LABEL_PX = 44;
const LABEL_STEPS = [1, 2, 3, 4, 6];

// Share of the plot height given to the temperature pane; precipitation
// gets the rest, less PANE_GAP_PX.
const TEMP_SHARE = 0.62;
const PANE_GAP_PX = 10;

let instances = 0;

const STYLE = `
  :host {
    display: block;
  }
  .graph {
    display: none;
    flex-direction: column;
    box-sizing: border-box;
    padding: 10px 12px 8px;
    overflow: hidden;
    border-radius: var(--bubble-border-radius, var(--ha-card-border-radius, 12px));
    background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
  }
  :host([open]) .graph {
    display: flex;
  }
  :host([open]) .wrapped {
    display: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
  }
  .readout {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 18px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--primary-text-color);
  }
  .readout .when {
    color: var(--secondary-text-color);
  }
  .readout .rain {
    color: var(--blue-color);
  }
  .readout .cond {
    --mdc-icon-size: var(--fgc-icon-size);
    width: var(--fgc-icon-size);
    height: var(--fgc-icon-size);
    line-height: 0;
  }
  .readout .cond:not([icon]) {
    display: none;
  }
  .readout .rain ha-icon {
    --mdc-icon-size: 16px;
    margin-right: 2px;
  }
  .readout .rain:empty,
  .readout .temp:empty {
    display: none;
  }
  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--secondary-text-color);
    background: color-mix(in srgb, var(--secondary-text-color) 15%, transparent);
    cursor: pointer;
  }
  .close ha-icon {
    --mdc-icon-size: 20px;
  }
  .plot {
    position: relative;
    flex: 1;
    min-height: 0;
    margin-top: 6px;
    touch-action: pan-y;
    cursor: crosshair;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .hours {
    display: grid;
    margin-top: 4px;
    font-size: 12px;
    text-align: center;
    white-space: nowrap;
    color: var(--secondary-text-color);
  }
  .hours .picked {
    color: var(--primary-text-color);
    font-weight: 600;
  }
`;

class ForecastGraphCard extends HTMLElement {
  static getStubConfig() {
    return { entity: "weather.home", hours: 24, card: { type: "weather-forecast", entity: "weather.home" } };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("forecast-graph-card: `entity` (the weather entity) is required");
    }
    if (!config.card) {
      throw new Error("forecast-graph-card: `card` (the card shown until tapped) is required");
    }
    this._config = { ...config, hours: Number(config.hours) || 24 };
    this.style.setProperty("--fgc-icon-size", `${Number(config.icon_size) || 26}px`);
    this._id = `fgc${++instances}`;
    this._pick = null;
    this._build();
    this._buildWrapped();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._wrapped) {
      this._wrapped.hass = hass;
    }
  }

  getCardSize() {
    return this._wrapped?.getCardSize?.() ?? 3;
  }

  connectedCallback() {
    if (this.hasAttribute("open")) {
      this._subscribe();
    }
  }

  disconnectedCallback() {
    this._unsubscribe();
  }

  _build() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card class="graph">
        <div class="head">
          <div class="readout">
            <span class="when"></span>
            <ha-icon class="cond"></ha-icon>
            <span class="temp"></span>
            <span class="rain"></span>
          </div>
          <button class="close" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        <div class="plot"><svg></svg></div>
        <div class="hours"></div>
      </ha-card>
      <div class="wrapped"></div>
    `;
    this._els = {
      graph: root.querySelector(".graph"),
      when: root.querySelector(".when"),
      cond: root.querySelector(".cond"),
      temp: root.querySelector(".temp"),
      rain: root.querySelector(".rain"),
      plot: root.querySelector(".plot"),
      svg: root.querySelector("svg"),
      hours: root.querySelector(".hours"),
      wrapped: root.querySelector(".wrapped"),
    };
    root.querySelector(".close").addEventListener("click", () => this._close());
    // Capture, so the tap is seen before anything inside the wrapped card
    // can stop it.
    this._els.wrapped.addEventListener("click", (event) => this._tapped(event), true);

    const plot = this._els.plot;
    const pick = (event) => this._pickAt(event.clientX);
    plot.addEventListener("pointerdown", (event) => {
      plot.setPointerCapture?.(event.pointerId);
      pick(event);
    });
    plot.addEventListener("pointermove", (event) => {
      if (event.buttons || event.pointerType === "touch") {
        pick(event);
      }
    });
    new ResizeObserver(() => this._render()).observe(plot);
  }

  async _buildWrapped() {
    const helpers = await window.loadCardHelpers();
    const card = helpers.createCardElement(this._config.card);
    card.addEventListener("ll-rebuild", (event) => {
      event.stopPropagation();
      this._buildWrapped();
    }, { once: true });
    if (this._hass) {
      card.hass = this._hass;
    }
    this._wrapped = card;
    this._els.wrapped.replaceChildren(card);
  }

  // Opens the graph when the click landed on the first day of the
  // Bubble Weather grid.
  _tapped(event) {
    let day = event.composedPath().find((node) => node.classList?.contains("bc-weather-day"));
    if (day) {
      if (day.parentElement?.firstElementChild === day) {
        this._open();
      }
      return;
    }
    day = this._wrapped?.shadowRoot?.querySelector(".bc-weather-grid > .bc-weather-day");
    const box = day?.getBoundingClientRect();
    if (box && event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom) {
      this._open();
    }
  }

  _open() {
    const height = this._els.wrapped.getBoundingClientRect().height;
    this._els.graph.style.height = `${Math.max(height, GRAPH_MIN_PX)}px`;
    this._pick = null;
    this.setAttribute("open", "");
    this._subscribe();
    this._render();
  }

  _close() {
    this.removeAttribute("open");
    this._unsubscribe();
  }

  _subscribe() {
    if (this._unsub || !this._hass) {
      return;
    }
    this._unsub = this._hass.connection.subscribeMessage(
      (message) => {
        this._forecast = message.forecast || [];
        this._render();
      },
      { type: "weather/subscribe_forecast", entity_id: this._config.entity, forecast_type: "hourly" },
    ).catch((error) => {
      console.error("forecast-graph-card: forecast subscription failed", error);
      this._unsub = null;
    });
    this._clock = window.setInterval(() => this._render(), 60 * 1000);
  }

  _unsubscribe() {
    this._unsub?.then((unsub) => unsub?.());
    this._unsub = null;
    window.clearInterval(this._clock);
    this._clock = null;
  }

  // The hours on show: from the current hour on, the first `hours`.
  _hoursShown() {
    const since = Date.now() - STALE_MS;
    return (this._forecast || [])
      .filter((entry) => new Date(entry.datetime).getTime() >= since)
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .slice(0, this._config.hours);
  }

  _render() {
    this._points = this._hoursShown();
    if (this._pick !== null && this._pick >= this._points.length) {
      this._pick = null;
    }
    const format = this._hourFormat();
    const count = this._points.length;
    const width = this._els.hours.clientWidth;
    const step = LABEL_STEPS.find((each) => (count / each) * LABEL_PX <= width) ?? LABEL_STEPS.at(-1);
    this._els.hours.style.gridTemplateColumns = `repeat(${Math.max(count, 1)}, minmax(0, 1fr))`;
    this._els.hours.replaceChildren(...this._points.map((entry, index) => {
      const label = document.createElement("div");
      label.textContent = index % step === 0 ? format.format(new Date(entry.datetime)) : "";
      label.classList.toggle("picked", index === this._pick);
      return label;
    }));
    this._draw();
    this._readout();
  }

  // "3 PM" or "15", in the time zone and clock the user's profile asks for.
  _hourFormat() {
    const locale = this._hass?.locale || {};
    const key = `${locale.language}|${locale.time_format}|${locale.time_zone}`;
    if (this._formatKey !== key) {
      const options = { hour: "numeric" };
      if (locale.time_zone !== "local" && this._hass?.config?.time_zone) {
        options.timeZone = this._hass.config.time_zone;
      }
      if (locale.time_format === "12" || locale.time_format === "24") {
        options.hour12 = locale.time_format === "12";
      }
      this._formatKey = key;
      this._format = new Intl.DateTimeFormat(locale.language || undefined, options);
    }
    return this._format;
  }

  _celsius() {
    return (this._hass?.states?.[this._config.entity]?.attributes?.temperature_unit || "°C") === "°C";
  }

  // A °F anchor in the entity's unit.
  _fromF(f) {
    return this._celsius() ? (f - 32) * 5 / 9 : f;
  }

  // The blended band color at a temperature in the entity's unit.
  _tempColor(value) {
    const f = this._celsius() ? value * 9 / 5 + 32 : value;
    const last = BAND_ANCHORS_F.length - 1;
    if (f <= BAND_ANCHORS_F[0]) {
      return BAND_COLORS[0];
    }
    if (f >= BAND_ANCHORS_F[last]) {
      return BAND_COLORS[last];
    }
    const index = BAND_ANCHORS_F.findIndex((anchor) => f < anchor) - 1;
    const share = (f - BAND_ANCHORS_F[index]) / (BAND_ANCHORS_F[index + 1] - BAND_ANCHORS_F[index]);
    return `color-mix(in srgb, ${BAND_COLORS[index + 1]} ${(share * 100).toFixed(1)}%, ${BAND_COLORS[index]})`;
  }

  _draw() {
    const svg = this._els.svg;
    const points = this._points || [];
    const { width, height } = this._els.plot.getBoundingClientRect();
    if (!width || !height) {
      return;
    }
    if (!points.length) {
      svg.innerHTML = "";
      return;
    }
    const n = points.length;
    const column = width / n;
    const x = (index) => column * (index + 0.5);

    // Temperature pane, with headroom so the line and dot stay inside.
    const tempHeight = (height - PANE_GAP_PX) * TEMP_SHARE;
    const temps = points.map((entry) => Number(entry.temperature));
    let low = Math.min(...temps);
    let high = Math.max(...temps);
    const pad = Math.max((high - low) * 0.2, 2);
    low -= pad;
    high += pad;
    const top = 6;
    const bottom = tempHeight - 2;
    const y = (value) => bottom - ((value - low) / (high - low)) * (bottom - top);
    const line = points.map((_, index) => [x(index), y(temps[index])]);
    const path = smoothPath(line);
    const area = `${path} L${x(n - 1)},${tempHeight} L${x(0)},${tempHeight} Z`;

    // Band gradient laid out in temperature: it runs from the hottest
    // anchor to the coldest, wherever those fall relative to the pane, so
    // the stretch the pane shows is the blend for the day's range.
    const hot = BAND_ANCHORS_F[BAND_ANCHORS_F.length - 1];
    const cold = BAND_ANCHORS_F[0];
    const gradientTop = y(this._fromF(hot));
    const gradientBottom = y(this._fromF(cold));
    const gradient = BAND_ANCHORS_F
      .map((anchor, index) => [((hot - anchor) / (hot - cold)).toFixed(4), BAND_COLORS[index]])
      .reverse()
      .map(([offset, stop]) => `<stop offset="${offset}" style="stop-color:${stop}"/>`)
      .join("");

    // Precipitation pane: bars on 0-100%.
    const rainTop = tempHeight + PANE_GAP_PX;
    const rainHeight = height - rainTop;
    const barWidth = Math.min(column * 0.5, 28);
    const bars = points.map((entry, index) => {
      const chance = Math.min(Math.max(Number(entry.precipitation_probability) || 0, 0), 100);
      const h = Math.max((chance / 100) * rainHeight, chance > 0 ? 2 : 0);
      const picked = this._pick === null || this._pick === index;
      return `<rect x="${x(index) - barWidth / 2}" y="${height - h}" width="${barWidth}" height="${h}"
        rx="${Math.min(barWidth / 4, h / 2)}" style="fill:var(--blue-color)" opacity="${picked ? 1 : 0.45}"/>`;
    }).join("");

    let cursor = "";
    if (this._pick !== null) {
      const [px, py] = line[this._pick];
      cursor = `
        <line x1="${px}" x2="${px}" y1="0" y2="${height}"
          style="stroke:var(--primary-text-color)" stroke-opacity="0.35" stroke-width="1.5"/>
        <circle cx="${px}" cy="${py}" r="5.5" stroke-width="2.5"
          style="fill:${this._tempColor(temps[this._pick])};stroke:var(--ha-card-background, var(--card-background-color, #1c1c1c))"/>`;
    }

    const id = this._id;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      <defs>
        <linearGradient id="${id}-band" gradientUnits="userSpaceOnUse" x1="0" y1="${gradientTop}" x2="0" y2="${gradientBottom}">
          ${gradient}
        </linearGradient>
        <linearGradient id="${id}-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <mask id="${id}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${tempHeight}">
          <rect x="0" y="0" width="${width}" height="${tempHeight}" fill="url(#${id}-fade)"/>
        </mask>
      </defs>
      <path d="${area}" fill="url(#${id}-band)" mask="url(#${id}-mask)"/>
      <path d="${path}" fill="none" stroke="url(#${id}-band)" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="0" x2="${width}" y1="${height - 0.5}" y2="${height - 0.5}"
        style="stroke:var(--divider-color)"/>
      ${bars}
      ${cursor}
    `;
  }

  _readout() {
    const { when, cond, temp, rain } = this._els;
    const points = this._points || [];
    cond.removeAttribute("icon");
    if (!points.length) {
      when.textContent = this._forecast ? "No hourly forecast" : "Loading…";
      temp.textContent = "";
      rain.replaceChildren();
      return;
    }
    if (this._pick === null) {
      const format = this._hourFormat();
      when.textContent = `${format.format(new Date(points[0].datetime))} – ${format.format(new Date(points[points.length - 1].datetime))}`;
      temp.textContent = "";
      rain.replaceChildren();
      return;
    }
    const entry = points[this._pick];
    const value = Number(entry.temperature);
    when.textContent = this._hourFormat().format(new Date(entry.datetime));
    const condition = String(entry.condition || "").toLowerCase();
    if (condition) {
      const lookup = window.__bcwfCtx?.getWeatherIcon;
      cond.setAttribute("icon", (typeof lookup === "function" && lookup(condition)) || WEATHER_ICONS[condition] || "mdi:weather-cloudy");
    }
    temp.textContent = Number.isFinite(value) ? `${Math.round(value)}°` : "";
    temp.style.color = Number.isFinite(value) ? this._tempColor(value) : "";
    const chance = Number(entry.precipitation_probability);
    if (Number.isFinite(chance)) {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:water");
      rain.replaceChildren(icon, `${Math.round(chance)}%`);
    } else {
      rain.replaceChildren();
    }
  }

  _pickAt(clientX) {
    const points = this._points || [];
    if (!points.length) {
      return;
    }
    const { left, width } = this._els.plot.getBoundingClientRect();
    const index = Math.min(Math.max(Math.floor(((clientX - left) / width) * points.length), 0), points.length - 1);
    if (index !== this._pick) {
      this._pick = index;
      this._render();
    }
  }
}

// A monotone cubic through the points (Fritsch-Carlson), so the curve never
// overshoots a high or a low the forecast does not have.
function smoothPath(points) {
  const n = points.length;
  if (n === 1) {
    return `M${points[0][0]},${points[0][1]}`;
  }
  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    slopes.push((points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0]));
  }
  const tangents = [slopes[0]];
  for (let i = 1; i < n - 1; i++) {
    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
  }
  tangents.push(slopes[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slopes[i];
    const b = tangents[i + 1] / slopes[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      tangents[i] = t * a * slopes[i];
      tangents[i + 1] = t * b * slopes[i];
    }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += ` C${x0 + h},${y0 + tangents[i] * h} ${x1 - h},${y1 - tangents[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

customElements.define("forecast-graph-card", ForecastGraphCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "forecast-graph-card",
  name: "Forecast graph",
  description: "Wraps a forecast card and swaps in an hourly temperature and precipitation graph when today is tapped.",
  preview: false,
});
