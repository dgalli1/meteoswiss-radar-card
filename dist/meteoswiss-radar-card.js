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
    this._clockInterval = null;     // periodic re-render so "now" drifts forward
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
    this._ensureClockTicker();
  }

  disconnectedCallback() {
    if (this._clockInterval) {
      clearInterval(this._clockInterval);
      this._clockInterval = null;
    }
  }

  _ensureClockTicker() {
    // Re-render once per minute so the "now" marker and the "X min ago"
    // labels keep moving even when the integration hasn't published a
    // new state. The integration's own scan_interval is 5 min by default;
    // this is just a visual refresh.
    if (this._clockInterval) return;
    this._clockInterval = setInterval(() => {
      if (this.isConnected) this._render();
    }, 60_000);
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

  _freshnessLabel(timelineEntity) {
    if (!timelineEntity || !timelineEntity.attributes) return "no data yet";
    const last = timelineEntity.attributes.last_refresh;
    if (!last) return "no data yet";
    const ageS = Math.max(0, Math.floor(Date.now() / 1000) - last);
    if (ageS < 60) return `updated just now`;
    if (ageS < 3600) return `updated ${Math.round(ageS / 60)} min ago`;
    return `updated ${Math.round(ageS / 3600)} h ago`;
  }

  _freshnessClass(timelineEntity) {
    if (!timelineEntity || !timelineEntity.attributes) return "stale";
    const last = timelineEntity.attributes.last_refresh;
    if (!last) return "stale";
    const ageS = Math.max(0, Math.floor(Date.now() / 1000) - last);
    // Stale = the integration hasn't refreshed in more than 2x its
    // 5-minute scan interval. (Anything under that is "fine".)
    return ageS > 600 ? "stale" : "";
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
    // Detect a "no rain in window" forecast: every future entry with a
    // non-null rate sits in the lowest bin (0-1 mm/h). In that case the
    // card surfaces a clear banner instead of a wall of identical bars.
    const dryRunBanner = this._detectDryRun(entries, now);

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="card">
          <div class="header">
            <h2>
              <span class="swatch" style="background:${currentColor}"></span>
              ${this._config.title} · ${this._config.location_name || ""}
            </h2>
            <div class="header-right">
              <div class="now">${currentState}</div>
              <div class="freshness ${this._freshnessClass(timelineEntity)}">
                ${this._freshnessLabel(timelineEntity)}
              </div>
            </div>
          </div>
          ${dryRunBanner ? `<div class="banner">${dryRunBanner}</div>` : ""}
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
          ${this._renderSelection(entries)}
          ${this._config.show_legend !== false ? this._renderLegend() : ""}
        </div>
      </ha-card>
      <style>${this._styles()}</style>
    `;
    this._bindScrubber(entries, now);
  }

  _detectDryRun(entries, now) {
    // If every future entry with a real (non-null) rate sits in the
    // lowest bin, the forecast is effectively dry for the whole window.
    const future = entries.filter((e) => e.ts > now && e.rate !== null);
    if (future.length === 0) return null;
    const anyRain = future.some((e) => e.rate >= 1.0);
    if (anyRain) return null;
    const horizonH = Math.round(
      (entries[entries.length - 1].ts - now) / 3600
    );
    return `No rain expected in the next ${horizonH} h`;
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
    // then one per hour for the rest. We render one bar per entry at its
    // time position, with the bar's colour matching the MeteoSwiss legend
    // for that intensity bin. Bars with ``rate === null`` mean the upstream
    // did not publish a polygon for that point (the point is in a hole in
    // the radar mosaic); we render those as transparent ticks so the user
    // can visually distinguish "no rain reported" from "no rain claimed".
    if (entries.length === 0) {
      return `<div class="empty">No timeline data</div>`;
    }
    const minTs = entries[0].ts;
    const maxTs = entries[entries.length - 1].ts;
    const span = Math.max(1, maxTs - minTs);
    const anchorTs = Math.max(minTs, Math.min(maxTs, now));
    const nowLeft = ((anchorTs - minTs) / span) * 100;
    const selectedTs = this._selectedTimestamp;
    return `
      <div class="bars">
        ${entries.map((e) => {
          const left = ((e.ts - minTs) / span) * 100;
          const isPast = e.ts < now;
          const isSelected = selectedTs === e.ts;
          const isGap = e.rate === null;
          // Real reading: solid colour. Gap: transparent with a faint
          // dashed outline so it still parses as a step in the timeline.
          const color = isGap ? "transparent" : this._colorForBin(e.bin);
          const border = isGap
            ? "border-left:1px dashed rgba(127,127,127,0.35);"
            : "";
          const title = `${this._formatTime(e.ts)} \u2014 ${e.bin} (${this._formatRate(e.rate)})`;
          return `<div class="bar ${isPast ? "past" : "future"} ${isGap ? "gap" : ""} ${isSelected ? "selected" : ""}"
                       data-ts="${e.ts}"
                       title="${title}"
                       style="left:${left}%;background:${color};${border}"></div>`;
        }).join("")}
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
      ["0–1 mm/h", "trace"],
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
        <div class="legend-item">
          <span class="swatch small gap-swatch"></span>
          <span>no reading <em>(radar mosaic has no polygon at this point)</em></span>
        </div>
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
      // Toggle off if the user clicks the already-selected bar; otherwise
      // pin the new selection so the readout below the chart stays open.
      this._selectedTimestamp = this._selectedTimestamp === ts ? null : ts;
      this._render();
    });
    const clear = this.shadowRoot.getElementById("selection-clear");
    if (clear) {
      clear.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._selectedTimestamp = null;
        this._render();
      });
    }
  }

  _renderSelection(entries) {
    if (this._selectedTimestamp === null) return "";
    const e = entries.find((x) => x.ts === this._selectedTimestamp);
    if (!e) return "";
    const dateStr = new Date(e.ts * 1000).toLocaleString([], {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const isPast = e.ts < Math.floor(Date.now() / 1000);
    const phase = isPast ? "Past reading" : "Forecast";
    const rate = e.rate === null ? "—" : `${e.rate.toFixed(1)} mm/h`;
    return `
      <div class="selection" id="selection">
        <div class="selection-main">
          <span class="selection-phase">${phase}</span>
          <span class="selection-date">${dateStr}</span>
        </div>
        <div class="selection-detail">
          <span class="selection-bin">${e.bin}</span>
          <span class="selection-rate">${rate}</span>
        </div>
        <button class="selection-clear" id="selection-clear">Clear</button>
      </div>
    `;
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
      .header-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
      .freshness { font-size: 11px; color: var(--secondary-text-color); }
      .freshness.stale { color: #c46b1f; }
      .banner { background: rgba(154,126,149,0.18); color: var(--primary-text-color); padding: 8px 12px; border-radius: 6px; margin-bottom: 12px; font-size: 14px; text-align: center; }
      .summary { display: flex; gap: 12px; margin-bottom: 16px; }
      .metric { flex: 1; background: rgba(127,127,127,0.1); padding: 8px 12px; border-radius: 8px; text-align: center; }
      .metric .value { font-size: 20px; font-weight: 600; }
      .metric .label { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
      .chart { height: 80px; position: relative; margin-bottom: 8px; }
      .bars { position: relative; height: 60px; background: rgba(127,127,127,0.1); border-radius: 4px; overflow: hidden; }
      .bar { position: absolute; top: 0; height: 100%; width: 3px; cursor: pointer; transition: transform 0.1s ease, width 0.1s ease; opacity: 0.85; }
      .bar.gap { width: 1px; opacity: 1; }
      .bar.past { opacity: 0.55; }
      .bar:hover, .bar.selected { transform: scaleX(2.5); width: 4px; opacity: 1; }
      .now-marker { position: absolute; top: 0; height: 100%; width: 2px; background: var(--primary-text-color); pointer-events: none; }
      .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--secondary-text-color); padding: 0 2px; }
      .legend { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 12px; margin-top: 12px; font-size: 12px; }
      .legend-item { display: flex; align-items: center; gap: 6px; }
      .gap-swatch { background: transparent !important; border-left: 1px dashed rgba(127,127,127,0.6); }
      .empty { color: var(--secondary-text-color); padding: 16px; text-align: center; }
      .selection { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; margin-top: 8px; background: rgba(127,127,127,0.08); border-radius: 6px; }
      .selection-main { display: flex; flex-direction: column; gap: 2px; }
      .selection-phase { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color); }
      .selection-date { font-size: 15px; font-weight: 600; }
      .selection-detail { display: flex; flex-direction: column; gap: 2px; margin-left: auto; text-align: right; }
      .selection-bin { font-size: 13px; color: var(--secondary-text-color); }
      .selection-rate { font-size: 16px; font-weight: 600; }
      .selection-clear { background: transparent; border: 1px solid var(--divider-color, rgba(127,127,127,0.4)); color: var(--primary-text-color); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
      .selection-clear:hover { background: rgba(127,127,127,0.12); }
      .selection { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; margin-top: 8px; background: rgba(127,127,127,0.08); border-radius: 6px; }
      .selection-main { display: flex; flex-direction: column; gap: 2px; }
      .selection-phase { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color); }
      .selection-date { font-size: 15px; font-weight: 600; }
      .selection-detail { display: flex; flex-direction: column; gap: 2px; margin-left: auto; text-align: right; }
      .selection-bin { font-size: 13px; color: var(--secondary-text-color); }
      .selection-rate { font-size: 16px; font-weight: 600; }
      .selection-clear { background: transparent; border: 1px solid var(--divider-color, rgba(127,127,127,0.4)); color: var(--primary-text-color); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
      .selection-clear:hover { background: rgba(127,127,127,0.12); }
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
