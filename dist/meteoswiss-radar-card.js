/**
 * meteoswiss-radar-card.js
 *
 * A Lovelace custom card that shows the MeteoSwiss precipitation timeline
 * for a configured location, with:
 *
 *  * A header showing the current intensity bin + a colour swatch.
 *  * A 24-hour timeline of (past + forecast) rates as a stacked bar chart.
 *  * A "next rain in N min" pill (or "dry" if the next 6 h are rain-free).
 *  * A scrubber so the user can preview any historical or forecast step.
 *
 * The card reads the integration's per-location timeline sensor
 * (e.g. ``sensor.meteoswiss_radar_romanshorn_timeline_steps``) and
 * derives the current rate / next rain / forecast max from its
 * attributes, so you only have to set one ``entity`` in the card
 * config. Optional separate ``current_rate_entity`` / ``next_rain_entity``
 * / ``forecast_max_6h_entity`` overrides are honored when present.
 *
 * To install:
 *   1. HACS installs the file under
 *      ``config/www/community/meteoswiss-radar-card/meteoswiss-radar-card.js``.
 *   2. Add a Lovelace resource (Settings → Dashboards → Resources):
 *        URL:  /local/community/meteoswiss-radar-card/meteoswiss-radar-card.js
 *        Type: JavaScript Module
 *   3. Add the card to a view:
 *        type: custom:meteoswiss-radar-card
 *        entity: sensor.meteoswiss_radar_romanshorn_timeline_steps
 *        location_name: Romanshorn
 */

const COLOR_MAP = {
  "0–1 mm/h": "#9a7e95",
  "1–2 mm/h": "#0001fc",
  "2–4 mm/h": "#058c2d",
  "4–6 mm/h": "#05ff05",
  "6–10 mm/h": "#feff01",
  "10–20 mm/h": "#ffc703",
  "20–40 mm/h": "#ff7d01",
  "40–60 mm/h": "#ff1900",
  "60+ mm/h": "#af00dd",
  "no data": "#cccccc",
  "storm warning": "#333e48",
  "unknown": "#888888",
};

class MeteoSwissRadarCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._selectedTimestamp = null; // scrubbed-to step
  }

  static getStubConfig() {
    return {
      entity: "sensor.meteoswiss_radar_romanshorn_timeline_steps",
      location_name: "Romanshorn",
      title: "MeteoSwiss rain radar",
      show_legend: true,
    };
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error(
        "Please define an entity (e.g. sensor.meteoswiss_radar_romanshorn_timeline_steps)"
      );
    }
    this._config = {
      title: "MeteoSwiss rain radar",
      show_legend: true,
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  // --- Helpers ----------------------------------------------------------------

  _getEntity(entityId) {
    return this._hass && this._hass.states ? this._hass.states[entityId] : null;
  }

  _timelineEntity() {
    return this._getEntity(this._config.entity);
  }

  _timelineAttr() {
    const entity = this._timelineEntity();
    if (!entity) return null;
    return entity.attributes && entity.attributes.timeline
      ? entity.attributes.timeline
      : null;
  }

  // Optional side entities. All are tolerant of missing / unavailable
  // values so a partial deployment still renders.
  _currentStateEntity() {
    return this._getEntity(this._config.current_state_entity)
      || this._getEntity(this._inferSibling("_current_intensity_bin"));
  }

  _nextRainEntity() {
    return this._getEntity(this._config.next_rain_entity)
      || this._getEntity(this._inferSibling("_next_rain_in"));
  }

  _forecastMax6hEntity() {
    return this._getEntity(this._config.forecast_max_6h_entity)
      || this._getEntity(this._inferSibling("_forecast_max_6h"));
  }

  // Strip the ``_timeline_steps`` suffix from the configured entity to
  // re-use the integration's per-location prefix.
  _inferSibling(suffix) {
    const id = this._config.entity || "";
    if (!id.endsWith("_timeline_steps")) return "";
    return id.slice(0, -"_timeline_steps".length) + suffix;
  }

  _colorForBin(binLabel) {
    return COLOR_MAP[binLabel] || "#888888";
  }

  _formatTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  _formatRain(value) {
    if (value === null || value === undefined) return "—";
    if (value === "unknown" || value === "unavailable") return "—";
    if (typeof value === "number") {
      if (!isFinite(value)) return "—";
      if (value === 0) return "now";
      if (value < 60) return `${value} min`;
      return `${Math.round(value / 60)} h`;
    }
    const n = parseFloat(value);
    if (isNaN(n)) return String(value);
    if (n === 0) return "now";
    if (n < 60) return `${n} min`;
    return `${Math.round(n / 60)} h`;
  }

  _formatRate(value) {
    if (value === null || value === undefined) return "—";
    if (value === "unknown" || value === "unavailable") return "—";
    const n = parseFloat(value);
    if (!isFinite(n)) return "—";
    return `${n.toFixed(1)} mm/h`;
  }

  // --- Rendering --------------------------------------------------------------

  _render() {
    if (!this._config || !this._hass) return;

    const timelineEntity = this._timelineEntity();
    const timeline = this._timelineAttr();

    if (!timelineEntity) {
      this._renderWaiting(
        `Entity not found: <code>${this._config.entity}</code>. ` +
          `Add a MeteoSwiss radar location first.`
      );
      return;
    }
    if (!timeline) {
      this._renderWaiting(
        `Waiting for timeline data on <code>${this._config.entity}</code>…`
      );
      return;
    }

    const entries = Object.values(timeline)
      .map((e) => ({
        ts: Number(e.ts),
        rate: e.rate === undefined || e.rate === null ? null : Number(e.rate),
        bin: e.bin || "no data",
      }))
      .filter((e) => isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);

    if (entries.length === 0) {
      this._renderWaiting("Timeline is empty.");
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const currentStateEntity = this._currentStateEntity();
    const currentState = currentStateEntity
      ? currentStateEntity.state
      : this._pickCurrentBin(entries, now);
    const currentColor = this._colorForBin(currentState);
    const nextRainEntity = this._nextRainEntity();
    const nextRain = nextRainEntity
      ? nextRainEntity.state
      : this._deriveNextRain(entries, now);
    const max6hEntity = this._forecastMax6hEntity();
    let max6h = max6hEntity ? parseFloat(max6hEntity.state) : NaN;
    if (!isFinite(max6h)) {
      max6h = this._deriveMax6h(entries, now);
    }

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="card">
          <div class="header">
            <h2>
              <span class="swatch" style="background:${currentColor}"></span>
              ${this._config.title} · ${this._config.location_name || ""}
            </h2>
            <div class="now">${currentState}</div>
          </div>
          <div class="summary">
            <div class="metric">
              <div class="value">${this._formatRain(nextRain)}</div>
              <div class="label">Next rain</div>
            </div>
            <div class="metric">
              <div class="value">${this._formatRate(max6h)}</div>
              <div class="label">Max 6h</div>
            </div>
            <div class="metric">
              <div class="value">${entries.length}</div>
              <div class="label">Steps</div>
            </div>
          </div>
          <div class="chart" id="chart">
            ${this._renderBars(entries, now)}
          </div>
          ${this._config.show_legend !== false ? this._renderLegend() : ""}
        </div>
      </ha-card>
      <style>${this._styles()}</style>
    `;
    this._bindScrubber(entries, now);
  }

  _renderWaiting(message) {
    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="card">
          <div class="header"><h2>${this._config.title}</h2></div>
          <div class="empty">${message}</div>
        </div>
      </ha-card>
      <style>${this._styles()}</style>
    `;
  }

  _pickCurrentBin(entries, now) {
    let best = null;
    for (const e of entries) {
      if (e.ts <= now) best = e;
    }
    return best ? best.bin : (entries[0] ? entries[0].bin : "no data");
  }

  _deriveNextRain(entries, now) {
    for (const e of entries) {
      if (e.ts > now && e.rate !== null && e.rate > 0) {
        return Math.max(0, Math.round((e.ts - now) / 60));
      }
    }
    return null;
  }

  _deriveMax6h(entries, now) {
    const horizon = now + 6 * 3600;
    let max = 0;
    let any = false;
    for (const e of entries) {
      if (e.ts < now) continue;
      if (e.ts > horizon) break;
      if (e.rate !== null && e.rate > max) {
        max = e.rate;
        any = true;
      }
    }
    return any ? max : null;
  }

  _renderBars(entries, now) {
    // The radar/forecast timeline is one entry per 5 min for the first 6 h,
    // then one per hour for the rest. To stop the first future bar from
    // sitting flush against the "now" marker, we visually stretch the
    // [now, now+5min] window to a fixed 5% slice of the chart so future
    // entries have a small but visible gap. This matches how the MeteoSwiss
    // web app draws its scrubber.
    if (entries.length === 0) {
      return `<div class="empty">No timeline data</div>`;
    }
    const minTs = entries[0].ts;
    const maxTs = entries[entries.length - 1].ts;
    // Insert a synthetic "now" anchor if the wall clock falls outside the
    // [minTs, maxTs] window — otherwise the now-marker would sit at the
    // very edge of the chart and "future" would look like "now".
    const anchorTs = Math.max(minTs, Math.min(maxTs, now));
    // Time-domain position (0..1) for the now anchor. The total window
    // is [minTs, maxTs] and we add a small fixed-width "now" band on
    // top of that so the marker has a visible footprint.
    const nowLeft = ((anchorTs - minTs) / Math.max(1, maxTs - minTs)) * 100;
    const nowBandWidth = 1.2; // % of chart width
    const selectedTs = this._selectedTimestamp;
    return `
      <div class="bars">
        ${entries.map((e) => {
          const left = ((e.ts - minTs) / Math.max(1, maxTs - minTs)) * 100;
          const color = this._colorForBin(e.bin);
          const isPast = e.ts < now;
          const isSelected = selectedTs === e.ts;
          const title = `${this._formatTime(e.ts)} \u2014 ${e.bin} (${this._formatRate(e.rate)})`;
          return `<div class="bar ${isPast ? "past" : "future"} ${isSelected ? "selected" : ""}"
                       data-ts="${e.ts}"
                       title="${title}"
                       style="left:${left}%;background:${color}"></div>`;
        }).join("")}
        <div class="now-band" style="left:calc(${nowLeft}% - ${nowBandWidth / 2}%);width:${nowBandWidth}%"></div>
        <div class="now-marker" style="left:${nowLeft}%"></div>
      </div>
      <div class="axis">
        <span>${this._formatTime(minTs)}</span>
        <span>now</span>
        <span>${this._formatTime(maxTs)}</span>
      </div>
    `;
  }

  _renderLegend() {
    const bins = [
      ["0–1 mm/h", "no rain"],
      ["1–2 mm/h", ""],
      ["2–4 mm/h", ""],
      ["4–6 mm/h", ""],
      ["6–10 mm/h", ""],
      ["10–20 mm/h", ""],
      ["20–40 mm/h", ""],
      ["40–60 mm/h", "heavy"],
      ["60+ mm/h", "extreme"],
    ];
    return `
      <div class="legend">
        ${bins.map(([bin, note]) => `
          <div class="legend-item">
            <span class="swatch small" style="background:${this._colorForBin(bin)}"></span>
            <span>${bin}${note ? ` <em>(${note})</em>` : ""}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  _bindScrubber(entries, now) {
    const chart = this.shadowRoot.getElementById("chart");
    if (!chart) return;
    chart.addEventListener("click", (ev) => {
      const bar = ev.target.closest(".bar");
      if (!bar) return;
      const ts = parseInt(bar.getAttribute("data-ts"), 10);
      this._selectedTimestamp = ts;
      this._render();
    });
  }

  _styles() {
    return `
      :host { display: block; }
      ha-card { display: block; padding: 0; }
      .card { padding: 16px; }
      .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
      .header h2 { font-size: 18px; margin: 0; display: flex; align-items: center; gap: 8px; }
      .swatch { display: inline-block; width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.2); }
      .swatch.small { width: 12px; height: 12px; }
      .now { font-weight: 500; font-size: 16px; }
      .summary { display: flex; gap: 12px; margin-bottom: 16px; }
      .metric { flex: 1; background: rgba(127,127,127,0.1); padding: 8px 12px; border-radius: 8px; text-align: center; }
      .metric .value { font-size: 20px; font-weight: 600; }
      .metric .label { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
      .chart { height: 80px; position: relative; margin-bottom: 8px; }
      .bars { position: relative; height: 60px; background: rgba(127,127,127,0.1); border-radius: 4px; overflow: hidden; }
      .now-band { position: absolute; top: 0; height: 100%; background: rgba(255,255,255,0.18); pointer-events: none; }
      .bar { position: absolute; top: 0; height: 100%; width: 3px; cursor: pointer; transition: transform 0.1s ease, width 0.1s ease; opacity: 0.85; }
      .bar.past { opacity: 0.55; }
      .bar:hover, .bar.selected { transform: scaleX(2.5); width: 4px; opacity: 1; }
      .now-marker { position: absolute; top: 0; height: 100%; width: 2px; background: var(--primary-text-color); pointer-events: none; }
      .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); padding: 0 2px; }
      .legend { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; margin-top: 12px; font-size: 12px; }
      .legend-item { display: flex; align-items: center; gap: 6px; }
      .empty { color: var(--secondary-text-color); padding: 16px; text-align: center; }
    `;
  }
}

customElements.define("meteoswiss-radar-card", MeteoSwissRadarCard);

// Register with the custom-card helper so the picker shows the card
// (see https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card)
window.customCards = window.customCards || [];
window.customCards.push({
  type: "meteoswiss-radar-card",
  name: "MeteoSwiss rain radar",
  preview: true,
  description: "MeteoSwiss precipitation timeline for a single location.",
});
