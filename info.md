# MeteoSwiss rain radar — dashboard card

A Lovelace custom card that shows the MeteoSwiss rain radar timeline
produced by the [MeteoSwiss rain radar integration](../meteoswiss-radar).

## Install

1. HACS → Frontend → ⋮ → Custom repositories → add this repo (type: **Dashboard**).
2. Refresh the frontend (Settings → ⋮ → "Hard refresh browser cache").
3. In a Lovelace view, add a card and pick **MeteoSwiss rain radar** from the
   custom cards list.

## Configuration

```yaml
- type: custom:meteoswiss-radar-card
  entity: sensor.meteoswiss_radar_romanshorn_timeline
  location_name: Romanshorn
  title: MeteoSwiss rain radar
  show_legend: true
```

* `entity` (required) — the timeline sensor from the integration.
* `location_name` (optional) — shown in the card title.
* `title` (optional) — overrides the default "MeteoSwiss rain radar".
* `show_legend` (optional, default `true`) — show the colour-scale legend at the bottom.

## What the card shows

* The current intensity bin (with colour swatch).
* Three summary tiles: **Next rain in**, **Max 6 h**, **Steps**.
* A bar-chart of the timeline, with past steps dimmed and the "now" marker.
* A click-to-scrub interaction: click any bar to highlight that step.
* The colour scale legend (8 bins from "no rain" to "extreme").
