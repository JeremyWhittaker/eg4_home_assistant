# EG4 Solar & Battery dashboard

A professional, native Home Assistant equipment dashboard for an EG4 18KPV inverter and its battery bank. It is read-only, responsive, dependency-free, and installs as a dedicated **EG4 Solar & Battery** sidebar panel.

This page intentionally reports the EG4 inverter's own measurements. In Jeremy's dual-array property, EG4 **Consumption Power** is an AC-bus-derived value and does not include the separate Enphase array correctly as whole-property load. Use the dedicated **Home Energy** dashboard for the Enphase-corrected whole-home balance; use this page for EG4 inverter, strings, grid CT, battery, BMS, and equipment diagnostics.

The installer discovers entities by their Home Assistant device relationship and semantic original names. Inverter serial numbers, station addresses, access tokens, and live state dumps never enter this repository.

## What it provides

Nine responsive Sections views, every one of them read-only:

- **Live** (`/live`) — the at-a-glance view. A narrative summary of what the system is doing right now, a live power distribution across solar, load, grid import, grid export, and battery, primary-power tiles, a battery state-of-charge gauge, today's four energy counters, and a 24-hour power history. Badges carry solar, home, battery, grid, and operating mode.
- **Energy** (`/energy`) — Home Assistant's own Energy cards driven by a private date-selection collection: energy distribution, grid balance, a self-sufficiency gauge, a solar-consumed gauge, the usage and solar graphs, the Energy Sankey, a 24-hour power detail chart, and a friendly-named lifetime totals card.
- **Solar** (`/solar`) — the PV arrays. Current contribution across the three strings, per-string power tiles, a telemetry card per string with its power, voltage, and current, today's and lifetime yield, a 24-hour per-string chart, and a 30-day daily-generation chart.
- **Battery** (`/battery`) — the bank, plus the note explaining why there is only one of it. Bank state-of-charge gauge, bank power/voltage/current/charge-rate tiles, the five reported capacity figures with the module count and bank status, the three BMS permission sensors, the inverter's independent DC-terminal readings, today's and lifetime charge and discharge, a seven-day state-of-charge history, and a 30-day battery-energy chart.
- **Grid & AC** (`/grid`) — everything on the AC side. Net/import/export power and energy, grid voltage including the R/S/T legs, frequency, grid type, power factor and off-grid state, the AC bus and load counters, the internal conversion stage (rectifier power and the two DC bus rails), the EPS protected-load outputs, and the generator input registers. Each group carries a note saying what the measurement actually is.
- **Trends** (`/performance`) — 48-hour power, 30-day daily energy, 72-hour inverter temperature, 24-hour grid voltage and frequency, and a seven-day battery-bank chart.
- **Equipment** (`/system`) — health and identity. Cloud status, connection-lost, runtime-data, transport, dongle connectivity and off-grid state; the three inverter temperatures with their explanatory note; operating state, status code, inverter family, device type code and power rating; and the firmware version alongside the firmware `update` entity, shown for awareness only.
- **Configuration** (`/settings`) — the whole setup at a glance, still not a control panel. Every configuration entity the integration publishes, grouped by what it governs into seven sections, each showing its live value on a tile that carries no control feature and has every interaction pinned, so a tap opens the entity's details and changes nothing. Links to the Home Assistant device pages, where a setting is changed deliberately. A second section explains the entities the integration registers but disables.
- **Station** (`/station`) — the plant registration the cloud account holds, and the cloud API budget: request rate, peak request rate, requests today, and a 24-hour rate history. Every reading on this dashboard arrives over that rate-limited API, so these counters are the early warning that polling has become too aggressive.

The contract covers all 137 enabled EG4 entities, and all 137 are on a card. 98 of them — every `sensor` and `binary_sensor` plus the firmware `update` entity — are laid out across the telemetry views. The other 39 are control-domain entities (`number`, `select`, `switch`, `button`), and the Configuration view shows each one's live value on a deliberately inert tile: no `features` key, so no toggle, slider, or dropdown is mounted, and `tap_action`, `icon_tap_action`, and `hold_action` all pinned to `more-info` or `none`, so neither the card nor its icon can send a command. That shape is the only one in which the page may name a control entity, and the deployer enforces it. `node deploy.mjs --check` prints those figures as `entities=137 cards=232 views=9`, where `cards` counts every typed object in the configuration — the nine views, their 36 sections, 168 cards, and 19 badges. The 168 includes the two `entities` cards nested inside the two `entity-filter` cards.

Only built-in Home Assistant cards are used. There are no HACS frontend dependencies, and no card on any view can switch a mode, move a limit, edit a schedule, start a quick charge, or install firmware.

Nothing silently disappears. Discovery returns a reason for every entity it cannot resolve instead of failing the whole page, and Live and Equipment both carry a card that names those entities and says why they are absent.

## Battery reporting: two modules, one reported bank

This is the most common question the page has to answer, so it is stated plainly here and repeated on the **Battery** view itself.

Two physical battery modules of roughly 14 kWh each are installed. The `eg4_web_monitor` integration does not report them separately. It publishes one aggregate **Battery Bank** device, so every battery figure on the **Battery** view is the pair combined: bank state of charge, bank voltage, bank current, bank power, the five capacity readings, and the BMS charge/discharge permissions. The one exception is the "Measured at the inverter" section, which is the inverter's own reading of its DC terminals — also the pair combined, but measured independently of what the BMS reports, so a persistent disagreement between the two is itself worth noticing.

- `Battery Count` reads `2`. That is the only per-module fact the integration publishes on this installation.
- There is **no per-battery temperature, no per-cell voltage, and no per-module state of charge**. Those entities do not exist in the Home Assistant registry, so the page cannot show them and does not pretend to.
- The three temperatures on the page — **Inverter internal**, **Inverter radiator 1 (heatsink)**, and **Inverter radiator 2 (heatsink)**, grouped on the **Equipment** view under their own explanatory note — are the inverter's own sensors. All three report healthy live values. **None of them is a battery sensor**, and radiator 1 and radiator 2 are the inverter's two heatsinks, not one per battery module. A cool or warm heatsink reading says nothing about either battery module.

The integration does support per-battery entities. Its `sensor.py` iterates `device_data["batteries"]` and builds a full set of entities for each module it finds. That array is empty here because this config entry is cloud-only — it authenticates against the EG4 monitoring cloud with a username, password, and plant id. The integration's `coordinator_http.py` states that per-battery cell voltages and temperatures come from the local Modbus transport, not from the cloud API, so a cloud-only entry receives the aggregate bank and nothing beneath it.

The plausible way to unlock per-battery telemetry is therefore to add a local dongle or Modbus connection alongside the existing cloud entry. **That is an untested next step, not a promise.** It has not been tried on this installation, and nothing here verifies that the local transport would populate `device_data["batteries"]` for this hardware. See [docs/analysis.md](docs/analysis.md) for how the limitation was verified three separate ways.

## Entities the integration disables by default

The integration ships 28 entities disabled. A disabled entity holds no state at all, so a card pointing at one would render an error rather than a value, and discovery refuses to emit a reference it cannot find in live state. None of these appears anywhere on the page:

- **Six voltage set-points** (`number`): system charge voltage limit, on-grid cut-off voltage, off-grid cut-off voltage, AC charge start voltage, AC charge end voltage, and stop discharge voltage. Their enabled SOC-based equivalents carry their values on the **Configuration** view.
- **Eighteen schedule times** (`time`) forming nine start/end windows: three AC charge, three forced charge, and three forced discharge.
- **One switch**, `Share Battery`.
- **Three `Last Polled` diagnostics**, one each on the inverter, the battery bank, and the station.

The **Configuration** view says the same thing on the page, in its "Not registered for use" section.

To enable one, open **Settings → Devices & services → EG4 Web Monitor**, pick the device, find the entity in its list, and turn on **Enabled** in its settings. Home Assistant starts recording it within a minute or two. Putting it on this dashboard is a second, separate step: the discovery contract in `src/discovery.mjs` has to name it, because every reference on the page is resolved by device relationship and semantic name rather than written down as an entity id. A newly enabled `number`, `switch`, `select`, or `time` entity would join the Configuration view as another inert value tile, the same shape as the rest of its group.

## Live environment analyzed

A complete entity-registry inventory of the `eg4_web_monitor` platform was taken on 2026-09-15:

- 165 registry entities in total, 137 enabled and 28 disabled by the integration;
- three EG4 devices: the `18KPV` inverter with 138 entities, its linked battery bank with 16, and the station with 11;
- by domain: 98 `sensor`, 21 `number`, 19 `switch`, 18 `time`, 4 `select`, 2 `binary_sensor`, 2 `button`, and 1 `update`;
- no per-battery device, no per-cell entity, and no battery temperature entity of any kind.

The earlier 2026-08-28 audit established the rest of the environment and still holds: Home Assistant `2026.8.3`; Energy sources already bound to the selected inverter's lifetime grid-import, grid-export, solar-yield, battery-charge, and battery-discharge counters; an independent EG4 cloud snapshot agreeing with Home Assistant on PV, load, battery SOC/voltage/power, and grid frequency/voltage; and no relevant custom Lovelace card installed, which is what makes the native-only design workable.

The dashboard that audit produced resolved 64 entities and showed 60 of them across four views. Seventy-seven enabled entities were on no view at all. This revision closes that gap: the discovery contract now names all 137 enabled entities, discovery resolves all 137 against the live registry, and every one of them is on a card — the reporting domains across the telemetry views, the 39 configuration entities as inert value tiles on the Configuration view.

## Requirements

- Node.js 22 or newer.
- Home Assistant 2026.8 or newer for the current native Energy Sankey and distribution cards.
- An administrator long-lived token supplied through `HA_TOKEN` or `EG4_HA_TOKEN`.
- `HA_BASE_URL` set to the reachable Home Assistant origin.
- EG4 Web Monitor entities and grid/solar/battery Energy sources already configured.

The existing `netops-devices` MCP container has the required Home Assistant URL and token. On the netops host, load them without copying secrets:

```bash
set -a
. /home/jeremy/projects/observability/netops-devices-mcp/.env
set +a
```

## Validate and deploy

Run all static and unit checks:

```bash
npm run check
```

Run live preflight. This performs discovery, administrator verification, candidate validation, read-only Home Assistant template rendering, Energy-source validation, collision checks, and a create/update/unchanged plan without writing Home Assistant:

```bash
node deploy.mjs --check
```

Deploy:

```bash
node deploy.mjs
```

The deployer is idempotent. An unchanged dashboard causes no write and no backup. Before any create or update, it writes a random mode-0600 backup below `/tmp/eg4-ha-dashboard-*`, then round-trips the live dashboard after saving. A failed write automatically restores the previous storage dashboard or deletes only the newly created panel.

Open:

```text
<HA_BASE_URL>/eg4-energy/live
```

### Multiple EG4 inverters

Automatic discovery intentionally fails rather than choosing between multiple inverters. Select one by its Home Assistant device-registry ID:

```bash
export EG4_INVERTER_DEVICE_ID='<Home Assistant device id>'
node deploy.mjs --check
```

## Roll back

Use the exact backup path printed by a deployment:

```bash
node deploy.mjs --restore /tmp/eg4-ha-dashboard-*/backup.json
```

Restore refuses to overwrite a dashboard that changed after deployment. After reviewing that drift, an intentional override is explicit:

```bash
node deploy.mjs --restore /tmp/eg4-ha-dashboard-*/backup.json --force-restore
```

## Visual QA

After deployment, the headless QA runner authenticates with the same long-lived token and visits the dashboard's views at desktop and mobile sizes. It captures overlapping screenshots from top through bottom, repeats Live and Energy in light and dark modes, verifies the sidebar route, and fails on Lovelace or browser errors. Its temporary Chromium profile contains the token only in ephemeral local storage and is removed on exit.

`scripts/visual-qa.mjs` enumerates the routes it visits as a literal list, and that list still holds the four routes of the previous design. It has to be extended to all nine before its report can be read as full coverage; until then it will pass while never opening Solar, Battery, Grid & AC, Configuration, or Station.

```bash
npm run qa:visual -- --output-dir /tmp/eg4-home-assistant-qa
```

The runner defaults to `/usr/bin/chromium-browser`; override with `CHROMIUM_BIN` when needed. Screenshots and reports stay outside the repository by default.

## Safety model

- Storage-mode Lovelace is the only Home Assistant state this project mutates.
- The deployer refuses a YAML-mode dashboard collision.
- Candidate entity references are checked against live state before any write.
- A control-domain entity (`number`, `select`, `switch`, `time`, `button`, `script`, `automation`, or an `input_*` helper) may be referenced only as the `entity` of an inert tile: no `features` key, and `tap_action`, `icon_tap_action`, and `hold_action` all pinned to `more-info` or `none`. The deployer rejects a control reference in any other position, and rejects any mutating card action anywhere.
- That rule is enforced by counting, not by an allow-list of ids: the deployer counts how many inert tiles hold each control entity and how many times the same id occurs textually anywhere in the configuration, and refuses to deploy if the two disagree. An entity that has a legitimate tile *and* is named in a markdown or entities card fails the same way as one with no tile at all.
- REST reads have bounded timeouts/retries. WebSocket commands have timeouts and writes are never blindly retried.
- Tokens are read only from environment variables and are absent from logs and backups.
- Backup restore includes checksum and drift guards.

See [QA_CHECKLIST.md](QA_CHECKLIST.md) for release evidence and [docs/analysis.md](docs/analysis.md) for the live data-model analysis and design rationale.
