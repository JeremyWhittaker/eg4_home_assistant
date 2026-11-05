# EG4 Solar & Battery dashboard

A native Home Assistant equipment dashboard for an EG4 18KPV inverter and its battery bank. It is read-only, responsive, dependency-free, and installs as a dedicated **EG4 Solar & Battery** sidebar panel.

This page intentionally reports the EG4 inverter's own measurements. In Jeremy's dual-array property, EG4 **Consumption Power** is an AC-bus-derived value and does not include the separate Enphase array correctly as whole-property load. Use the dedicated **Home Energy** dashboard for the Enphase-corrected whole-home balance; use this page for EG4 inverter, strings, grid CT, battery, BMS, and equipment diagnostics.

The installer discovers entities by their Home Assistant device relationship and semantic original names. Inverter serial numbers, station addresses, access tokens, and live state dumps never enter this repository.

This repository now holds two cooperating pieces. The first is the dashboard deployer (`src/`, `deploy.mjs`) described throughout this document. The second is **`custom_components/eg4_local`**, a local-dongle Home Assistant integration that reads the EG4 WiFi dongle directly over TCP port 8000 — no EG4 cloud account — and publishes a BMS summary including cell-voltage extremes and their difference. The dashboard renders both sources side by side. See [Two data sources: EG4 cloud and the local dongle](#two-data-sources-eg4-cloud-and-the-local-dongle) below.

## What it provides

Up to eleven responsive Sections views, every one of them read-only. Eight equipment views use the EG4 cloud integration. **Energy** uses Home Assistant's global Energy configuration; **Battery Cells** and **Local Inverter** show local dongle telemetry when its integration is installed:

- **Live** (`/live`) — the at-a-glance view. A narrative summary of what the system is doing right now, a live power distribution across solar, load, grid import, grid export, and battery, primary-power tiles, a battery state-of-charge gauge, today's four energy counters, and a 24-hour power history. Badges carry solar, home, battery, grid, and operating mode.
- **Energy** (`/energy`) — Home Assistant's configured source table and Energy charts, with a separate date-selection key. This key does not isolate an EG4-only set of meters. For a property with Enphase as a separate array, the global Energy configuration must include that array once and exclude overlapping Tigo production before distribution and self-sufficiency percentages describe complete property accounting.
- **Solar** (`/solar`) — the PV arrays. Current contribution across the three strings, per-string power tiles, a telemetry card per string with its power, voltage, and current, today's and lifetime yield, a 24-hour per-string chart, and a 30-day daily-generation chart.
- **Battery** (`/battery`) — the bank, plus the note explaining why there is only one of it. Bank state-of-charge gauge, bank power/voltage/current/charge-rate tiles, the five reported capacity figures with the module count and bank status, the three BMS permission sensors, the inverter's independent DC-terminal readings, today's and lifetime charge and discharge, a seven-day state-of-charge history, and a 30-day battery-energy chart. This view is the aggregate **bank** as the cloud reports it; the per-cell detail lives on **Battery Cells**.
- **Battery Cells** (`/cells`) — a BMS summary from the local dongle: reported cell-voltage maximum, minimum, and difference, pack capacity, module count, and clearly marked provisional fields. It does not show individual cell voltages. A dynamic status checks numeric HA reports, the integration's stale flag, and report timestamps; an installed integration alone is not called connected. The main delta readout shows unavailable/stale text instead of a failing gauge.
- **Local Inverter** (`/local`) — local PV, battery, grid/AC, energy, temperature, and status readings. The route stays present when a local integration is discovered, including while its telemetry is unavailable. SOC uses a freshness-checked text readout; raw source tiles retain their reported values. A short status links to Equipment diagnostics for source and freshness details.
- **Grid & AC** (`/grid`) — everything on the AC side. Net/import/export power and energy, grid voltage including the R/S/T legs, frequency, grid type, power factor and off-grid state, the AC bus and load counters, the internal conversion stage (rectifier power and the two DC bus rails), the EPS protected-load outputs, and the generator input registers. Each group carries a note saying what the measurement actually is.
- **Trends** (`/performance`) — 48-hour power, 30-day daily energy, 72-hour inverter temperature, 24-hour grid voltage and frequency, and a seven-day battery-bank chart.
- **Equipment** (`/system`) — health and identity. Cloud status, connection-lost, runtime-data, transport, dongle connectivity and off-grid state; the three inverter temperatures with their explanatory note; operating state, status code, inverter family, device type code and power rating; and the firmware version alongside the firmware `update` entity, shown for awareness only.
- **Configuration** (`/settings`) — the whole setup at a glance, still not a control panel. Every configuration entity the integration publishes, grouped by what it governs into seven sections, each showing its live value on a tile that carries no control feature and has every interaction pinned, so a tap opens the entity's details and changes nothing. Links to the Home Assistant device pages, where a setting is changed deliberately. A second section explains the entities the integration registers but disables.
- **Station** (`/station`) — plant registration and cloud API request counters. These counters describe cloud polling only; local dongle reads use a separate transport.

The contract covers all 137 enabled EG4 entities, and all 137 are on a card. 98 of them — every `sensor` and `binary_sensor` plus the firmware `update` entity — are laid out across the telemetry views. The other 39 are control-domain entities (`number`, `select`, `switch`, `button`), and the Configuration view shows each one's live value on a deliberately inert tile: no `features` key, so no toggle, slider, or dropdown is mounted, and `tap_action`, `icon_tap_action`, and `hold_action` all pinned to `more-info` or `none`, so neither the card nor its icon can send a command. That shape is the only one in which the page may name a control entity, and the deployer enforces it. `node deploy.mjs --check` prints the live `entities`, `cards`, and `views` totals for whatever it resolves. Those totals now move with the local dongle: the deployer adds the **Battery Cells** view unconditionally and the **Local Inverter** view when the `eg4_local` integration is present, so the view count is ten on a cloud-only server and eleven once the local integration is discovered. This count does not establish a current connection. Read the check's own output as the source of truth rather than a fixed number quoted here.

Only built-in Home Assistant cards are used. There are no HACS frontend dependencies, and no card on any view can switch a mode, move a limit, edit a schedule, start a quick charge, or install firmware.

Nothing silently disappears. Discovery returns a reason for every entity it cannot resolve instead of failing the whole page, and Live and Equipment both carry a card that names those entities and says why they are absent.

## November 4 interface correction

The source now distinguishes **installed/discovered local capability** from **currently reporting local telemetry**. `local.installed` and `local.hasEntities` describe discovery; the retained `local.available` compatibility field has the same capability meaning. Runtime templates check four representative numeric readings, reject integration-marked cached data and future timestamps, and expire HA reports after five minutes. HA report time is not independent proof of every field's acquisition time after a partial poll.

Consumption from the inverter AC-bus equation is labeled **calculated**, never an independently metered panel or whole-home load. The utility CT remains the whole-service exchange measurement. Internal inverter identities do not calibrate that CT against SRP.

Energy charts use the global Energy preferences. The deployer verifies that the selected EG4 lifetime counters remain present even when other solar sources are configured, regardless of source order. It does not certify complete Enphase coverage, counter continuity, or a closed whole-property balance; those require separate validation before updating preferences.

The deployed `2751509` dashboard passed the full native browser matrix on November 4, 2026:
all **11 routes**, desktop/mobile and light/dark, **44 cases and 164 full-scroll screenshots**.
This verifies rendering with the observed source states, including unavailable local data; it
does not establish a working dongle or live cell measurements.

The November 5 copy correction keeps one short local status and a Diagnostics link, moves
technical detail to Equipment, and hides local tile update ages that could be mistaken for
outage durations. Numeric values, freshness checks and read-only controls are unchanged.
The deployed correction passed twelve desktop/mobile light/dark cases across Battery Cells,
Local Inverter and Equipment, with 44 screenshots and no browser errors. After shortening a
clipped Battery summary title, the four Cells cases passed again with ten screenshots.
Representative actual captures were inspected. See [the dated acceptance checklist](QA_CHECKLIST.md).

## Two data sources: EG4 cloud and the local dongle

This system can be read two ways, and the dashboard is built to show either one or both. They are complementary, not redundant.

- **EG4 cloud** — the third-party `eg4_web_monitor` integration, authenticated with an EG4 account, plant id, and inverter serial. It is the breadth source: it publishes the plant, the aggregate battery bank, and the full set of configuration and schedule entities (charge/discharge windows, SOC cut-offs, grid code) that only the cloud can read. It aggregates the two battery modules into one bank and never returns per-cell detail. This is the source for the cloud equipment views; the Energy view uses shared HA Energy configuration.
- **Local dongle** — the `eg4_local` integration in this repo (`custom_components/eg4_local`). It reads the EG4/LuxPower WiFi dongle on the LAN over **TCP port 8000**, without a cloud account. It reports cell-voltage maximum, minimum and difference, pack capacity, module count, and provisional cell temperatures, cycle count and pack current. It can operate without EG4 cloud service when the dongle and LAN are reachable; an installed local integration alone does not prove that connection is healthy.

**Settings are cloud-only.** The dongle's *hold / parameter* registers — the inverter's settings — are **not** locally readable on this firmware. The local integration reads live telemetry (input registers) only and never synthesizes a settings value. To see or change settings you use the cloud integration and the Home Assistant device pages. This dashboard stays read-only either way.

**Choosing a source is done in each integration's own setup, not on the page.** There is no toggle on the dashboard: Home Assistant's data source is whichever integration is enabled, and the page renders what is present. You enter EG4 cloud credentials in the cloud integration, and/or a local dongle IP and serials in the `eg4_local` config flow — which can also **scan the local subnet** to find the dongle for you (a bounded, passive LuxPower discovery of the host's own /24). The dongle is DHCP-reserved at `172.16.108.30` on this network, but that is only the config flow's editable default; the address moves on lease renewal and is never a hardcoded sole source. The same rule the cloud side follows holds here: no inverter or dongle serial and no dongle IP is baked into shipped code as the only source — the config entry supplies them, and discovery resolves the local device by its model name (`EG4 18kPV (local dongle)`) and the entities' semantic names, exactly as it resolves the cloud entities.

**Local field confidence.** Each sensor carries its decoder's confidence label. Earlier checks against EG4 cloud telemetry are related-source comparisons, not independent meter calibration. Provisional fields include cell temperatures, cycle count, pack current, state of health, and remaining capacity; the dashboard labels them accordingly, and optional BMS fields are created only when the integration's provisional-fields option is enabled. Register 67 is not presented as a confirmed battery-temperature measurement. This interface correction does not independently revalidate register meanings or the physical BMS.

The raw local API, the reverse-engineered wire protocol, and the full 381-register map with per-register confidence flags live in the companion project **[eg4-local-monitor](https://github.com/JeremyWhittaker/eg4-local-monitor)** (`docs/PROTOCOL.md` and `docs/REGISTERS.md` there). The `eg4_local` integration vendors that project's protocol, client, and decoder under `custom_components/eg4_local/eg4_lib/`, so the two stay in step. Install the integration by copying `custom_components/eg4_local/` into Home Assistant's `/config/custom_components/`, then add it under **Settings → Devices & services**; its offline test suite runs against a captured register snapshot and never touches the live dongle.

## Battery reporting: two modules, one reported bank

This is the most common question the page has to answer, so it is stated plainly here and repeated on the **Battery** view itself.

Two physical battery modules of roughly 14 kWh each are installed. The `eg4_web_monitor` integration does not report them separately. It publishes one aggregate **Battery Bank** device, so every battery figure on the **Battery** view is the pair combined: bank state of charge, bank voltage, bank current, bank power, the five capacity readings, and the BMS charge/discharge permissions. The one exception is the "Measured at the inverter" section, which is the inverter's own reading of its DC terminals — also the pair combined, but measured independently of what the BMS reports, so a persistent disagreement between the two is itself worth noticing.

- `Battery Count` reads `2`. That is the only per-module fact the integration publishes on this installation.
- There is **no per-battery temperature, no per-cell voltage, and no per-module state of charge**. Those entities do not exist in the Home Assistant registry, so the page cannot show them and does not pretend to.
- The three temperatures on the page — **Inverter internal**, **Inverter radiator 1 (heatsink)**, and **Inverter radiator 2 (heatsink)**, grouped on the **Equipment** view under their own explanatory note — are the inverter's own sensors. **None of these cloud temperature entities is a battery sensor**, and radiator 1 and radiator 2 are the inverter's two heatsinks, not one per battery module. A cool or warm heatsink reading says nothing about either battery module.

The integration does support per-battery entities. Its `sensor.py` iterates `device_data["batteries"]` and builds a full set of entities for each module it finds. That array is empty here because this config entry is cloud-only — it authenticates against the EG4 monitoring cloud with a username, password, and plant id. The integration's `coordinator_http.py` states that per-battery cell voltages and temperatures come from the local Modbus transport, not from the cloud API, so a cloud-only entry receives the aggregate bank and nothing beneath it.

A BMS cell summary is available, but by a different path than feeding the cloud integration's local transport. The `eg4_local` integration in this repo reads the WiFi dongle directly over TCP/8000 and publishes max/min cell voltage, cell delta, pack capacity, and module count as their own `sensor.eg4_local_*` entities, shown on the **Battery Cells** view (see [Two data sources](#two-data-sources-eg4-cloud-and-the-local-dongle) above). Two honest qualifications remain. First, those figures are separate local sensors, **not** new members of the cloud integration's empty `device_data["batteries"]` array — a cloud-only entry still shows only the aggregate bank described here. Second, some of the BMS fields the dongle exposes — cell temperatures, cycle count, pack current — are **provisional**, and register 67 is still not a battery temperature. The local integration was unavailable in the November 4 and early November 5 checks. After the November 5 Core restart, a fresh direct read recovered 254 of 381 registers, including key PV/SOC/cell summaries; the third bank remains missing. Offline decoder tests and a rendered dashboard do not prove full current coverage; see the dated recovery below. See [docs/analysis.md](docs/analysis.md) for how the cloud-side limitation was verified three separate ways.

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

The historical 2026-08-28 audit recorded the following baseline; it is not a current health or configuration claim: Home Assistant `2026.8.3`; Energy sources already bound to the selected inverter's lifetime grid-import, grid-export, solar-yield, battery-charge, and battery-discharge counters; an independent EG4 cloud snapshot agreeing with Home Assistant on PV, load, battery SOC/voltage/power, and grid frequency/voltage; and no relevant custom Lovelace card installed, which is what makes the native-only design workable.

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

After deployment, the headless QA runner authenticates with the same long-lived token and captures overlapping desktop/mobile screenshots from top to bottom. Its temporary Chromium profile contains the token only in ephemeral local storage and is removed on exit.

`scripts/visual-qa.mjs` still enumerates four routes, with dark coverage for Live and Energy.
Its pass alone is partial coverage. The November 4 deployed acceptance used a separate
read-only native harness that selected all 11 actual deployed routes and checked both themes
at both widths. That full 44-case result is recorded above; future releases also need full
coverage rather than treating the standard four-route runner as sufficient.

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

### Local read recovery — November 5, 2026

After the supported Core restart, all 59 local sensor entities became numeric. A new direct
TCP client with no saved register cache returned 254 of 381 input registers in 20 seconds,
including PV, battery charge and cell-voltage summary fields; the third bank (starting at 254)
was missing. This confirms recovery of those key reads, not a complete harvest or independent
calibration. Partial polls can retain older fields, as described in the local-source diagnostics.
Seasonal programming remains on the verified cloud interface; no local-register writes were made.
