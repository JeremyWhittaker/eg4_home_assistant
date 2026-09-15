# EG4 Solar & Battery dashboard

A professional, native Home Assistant equipment dashboard for an EG4 18KPV inverter and its battery bank. It is read-only, responsive, dependency-free, and installs as a dedicated **EG4 Solar & Battery** sidebar panel.

This page intentionally reports the EG4 inverter's own measurements. In Jeremy's dual-array property, EG4 **Consumption Power** is an AC-bus-derived value and does not include the separate Enphase array correctly as whole-property load. Use the dedicated **Home Energy** dashboard for the Enphase-corrected whole-home balance; use this page for EG4 inverter, strings, grid CT, battery, BMS, and equipment diagnostics.

The installer discovers entities by their Home Assistant device relationship and semantic original names. Inverter serial numbers, station addresses, access tokens, and live state dumps never enter this repository.

This repository now holds two cooperating pieces. The first is the dashboard deployer (`src/`, `deploy.mjs`) described throughout this document. The second is **`custom_components/eg4_local`**, a local-dongle Home Assistant integration that reads the EG4 WiFi dongle directly over TCP port 8000 — no EG4 cloud account — and publishes the per-cell battery detail the cloud never exposes. The dashboard renders both sources side by side. See [Two data sources: EG4 cloud and the local dongle](#two-data-sources-eg4-cloud-and-the-local-dongle) below.

## What it provides

Up to eleven responsive Sections views, every one of them read-only. Nine are driven by the EG4 cloud integration; two more — **Battery Cells** and **Local Inverter** — surface the local dongle when the `eg4_local` integration is installed:

- **Live** (`/live`) — the at-a-glance view. A narrative summary of what the system is doing right now, a live power distribution across solar, load, grid import, grid export, and battery, primary-power tiles, a battery state-of-charge gauge, today's four energy counters, and a 24-hour power history. Badges carry solar, home, battery, grid, and operating mode.
- **Energy** (`/energy`) — Home Assistant's own Energy cards driven by a private date-selection collection: energy distribution, grid balance, a self-sufficiency gauge, a solar-consumed gauge, the usage and solar graphs, the Energy Sankey, a 24-hour power detail chart, and a friendly-named lifetime totals card.
- **Solar** (`/solar`) — the PV arrays. Current contribution across the three strings, per-string power tiles, a telemetry card per string with its power, voltage, and current, today's and lifetime yield, a 24-hour per-string chart, and a 30-day daily-generation chart.
- **Battery** (`/battery`) — the bank, plus the note explaining why there is only one of it. Bank state-of-charge gauge, bank power/voltage/current/charge-rate tiles, the five reported capacity figures with the module count and bank status, the three BMS permission sensors, the inverter's independent DC-terminal readings, today's and lifetime charge and discharge, a seven-day state-of-charge history, and a 30-day battery-energy chart. This view is the aggregate **bank** as the cloud reports it; the per-cell detail lives on **Battery Cells**.
- **Battery Cells** (`/cells`) — the per-cell BMS detail the EG4 cloud hides, read from the local dongle. Its header always renders: a plain cloud-vs-local explainer and a live line stating whether the dongle is currently detected. When the `eg4_local` integration is connected, the cards below show max and min **cell voltage**, the max−min **cell delta** that reads pack balance and health, pack capacity, module count, and the provisional cell temperatures and cycle count — each provisional field labelled *(provisional)*. On a cloud-only install the header still explains the model and the data cards stay empty rather than inventing numbers.
- **Local Inverter** (`/local`) — a full inverter view built entirely from the local dongle, for a local-only or dual-source setup: PV strings, battery, grid/AC, energy counters, temperatures, and status/identity as the dongle reports them. It is present only when the `eg4_local` integration is connected; with no local source the whole view drops rather than showing an empty shell.
- **Grid & AC** (`/grid`) — everything on the AC side. Net/import/export power and energy, grid voltage including the R/S/T legs, frequency, grid type, power factor and off-grid state, the AC bus and load counters, the internal conversion stage (rectifier power and the two DC bus rails), the EPS protected-load outputs, and the generator input registers. Each group carries a note saying what the measurement actually is.
- **Trends** (`/performance`) — 48-hour power, 30-day daily energy, 72-hour inverter temperature, 24-hour grid voltage and frequency, and a seven-day battery-bank chart.
- **Equipment** (`/system`) — health and identity. Cloud status, connection-lost, runtime-data, transport, dongle connectivity and off-grid state; the three inverter temperatures with their explanatory note; operating state, status code, inverter family, device type code and power rating; and the firmware version alongside the firmware `update` entity, shown for awareness only.
- **Configuration** (`/settings`) — the whole setup at a glance, still not a control panel. Every configuration entity the integration publishes, grouped by what it governs into seven sections, each showing its live value on a tile that carries no control feature and has every interaction pinned, so a tap opens the entity's details and changes nothing. Links to the Home Assistant device pages, where a setting is changed deliberately. A second section explains the entities the integration registers but disables.
- **Station** (`/station`) — the plant registration the cloud account holds, and the cloud API budget: request rate, peak request rate, requests today, and a 24-hour rate history. Every reading on this dashboard arrives over that rate-limited API, so these counters are the early warning that polling has become too aggressive.

The contract covers all 137 enabled EG4 entities, and all 137 are on a card. 98 of them — every `sensor` and `binary_sensor` plus the firmware `update` entity — are laid out across the telemetry views. The other 39 are control-domain entities (`number`, `select`, `switch`, `button`), and the Configuration view shows each one's live value on a deliberately inert tile: no `features` key, so no toggle, slider, or dropdown is mounted, and `tap_action`, `icon_tap_action`, and `hold_action` all pinned to `more-info` or `none`, so neither the card nor its icon can send a command. That shape is the only one in which the page may name a control entity, and the deployer enforces it. `node deploy.mjs --check` prints the live `entities`, `cards`, and `views` totals for whatever it resolves. Those totals now move with the local dongle: the deployer adds the **Battery Cells** view unconditionally and the **Local Inverter** view when the `eg4_local` integration is present, so the view count is ten on a cloud-only server and eleven once the dongle is connected. Read the check's own output as the source of truth rather than a fixed number quoted here.

Only built-in Home Assistant cards are used. There are no HACS frontend dependencies, and no card on any view can switch a mode, move a limit, edit a schedule, start a quick charge, or install firmware.

Nothing silently disappears. Discovery returns a reason for every entity it cannot resolve instead of failing the whole page, and Live and Equipment both carry a card that names those entities and says why they are absent.

## Two data sources: EG4 cloud and the local dongle

This system can be read two ways, and the dashboard is built to show either one or both. They are complementary, not redundant.

- **EG4 cloud** — the third-party `eg4_web_monitor` integration, authenticated with an EG4 account, plant id, and inverter serial. It is the breadth source: it publishes the plant, the aggregate battery bank, and the full set of configuration and schedule entities (charge/discharge windows, SOC cut-offs, grid code) that only the cloud can read. It aggregates the two battery modules into one bank and never returns per-cell detail. This is the source behind the nine cloud views.
- **Local dongle** — the `eg4_local` integration in this repo (`custom_components/eg4_local`). It talks straight to the EG4/LuxPower WiFi dongle on your own LAN over **TCP port 8000**, with no cloud account and no internet dependency, and surfaces the data the cloud hides: per-cell voltage **max**, **min**, and the max−min **delta** that reads pack balance and health, plus pack capacity, module count, and provisional cell temperatures, cycle count, and pack current. Because it reads the dongle directly, it also keeps working when EG4's servers do not — when the EG4 cloud went down on **2026-09-12**, automation that depended on it went blind and car charging stopped; a local reader survives that.

**Settings are cloud-only.** The dongle's *hold / parameter* registers — the inverter's settings — are **not** locally readable on this firmware. The local integration reads live telemetry (input registers) only and never synthesizes a settings value. To see or change settings you use the cloud integration and the Home Assistant device pages. This dashboard stays read-only either way.

**Choosing a source is done in each integration's own setup, not on the page.** There is no toggle on the dashboard: Home Assistant's data source is whichever integration is enabled, and the page renders what is present. You enter EG4 cloud credentials in the cloud integration, and/or a local dongle IP and serials in the `eg4_local` config flow — which can also **scan the local subnet** to find the dongle for you (a bounded, passive LuxPower discovery of the host's own /24). The dongle is DHCP-reserved at `172.16.108.30` on this network, but that is only the config flow's editable default; the address moves on lease renewal and is never a hardcoded sole source. The same rule the cloud side follows holds here: no inverter or dongle serial and no dongle IP is baked into shipped code as the only source — the config entry supplies them, and discovery resolves the local device by its model name (`EG4 18kPV (local dongle)`) and the entities' semantic names, exactly as it resolves the cloud entities.

**The confidence discipline carries over.** Every local field is tagged **confirmed** (scale and unit cross-checked live against the EG4 cloud's own numbers) or **provisional** (read correctly, but its scale or meaning is reasoned rather than independently confirmed on this unit). Provisional fields — cell temperatures, cycle count, pack current, state of health, remaining capacity — say so in a `confidence` attribute (the entity name itself is the clean canonical name the dashboard resolves by, and the dashboard adds its own *(provisional)* label on the card), and the gated BMS ones are only created when the integration's "expose provisional BMS fields" option is on. In particular, register 67 is **not** a trustworthy battery temperature and is treated as provisional; the credible battery temperatures come from the BMS cell-temperature registers, and even those are labelled provisional until confirmed. Nothing provisional is ever presented as fact.

The raw local API, the reverse-engineered wire protocol, and the full 381-register map with per-register confidence flags live in the companion project **[eg4-local-monitor](https://github.com/JeremyWhittaker/eg4-local-monitor)** (`docs/PROTOCOL.md` and `docs/REGISTERS.md` there). The `eg4_local` integration vendors that project's protocol, client, and decoder under `custom_components/eg4_local/eg4_lib/`, so the two stay in step. Install the integration by copying `custom_components/eg4_local/` into Home Assistant's `/config/custom_components/`, then add it under **Settings → Devices & services**; its offline test suite runs against a captured register snapshot and never touches the live dongle.

## Battery reporting: two modules, one reported bank

This is the most common question the page has to answer, so it is stated plainly here and repeated on the **Battery** view itself.

Two physical battery modules of roughly 14 kWh each are installed. The `eg4_web_monitor` integration does not report them separately. It publishes one aggregate **Battery Bank** device, so every battery figure on the **Battery** view is the pair combined: bank state of charge, bank voltage, bank current, bank power, the five capacity readings, and the BMS charge/discharge permissions. The one exception is the "Measured at the inverter" section, which is the inverter's own reading of its DC terminals — also the pair combined, but measured independently of what the BMS reports, so a persistent disagreement between the two is itself worth noticing.

- `Battery Count` reads `2`. That is the only per-module fact the integration publishes on this installation.
- There is **no per-battery temperature, no per-cell voltage, and no per-module state of charge**. Those entities do not exist in the Home Assistant registry, so the page cannot show them and does not pretend to.
- The three temperatures on the page — **Inverter internal**, **Inverter radiator 1 (heatsink)**, and **Inverter radiator 2 (heatsink)**, grouped on the **Equipment** view under their own explanatory note — are the inverter's own sensors. All three report healthy live values. **None of them is a battery sensor**, and radiator 1 and radiator 2 are the inverter's two heatsinks, not one per battery module. A cool or warm heatsink reading says nothing about either battery module.

The integration does support per-battery entities. Its `sensor.py` iterates `device_data["batteries"]` and builds a full set of entities for each module it finds. That array is empty here because this config entry is cloud-only — it authenticates against the EG4 monitoring cloud with a username, password, and plant id. The integration's `coordinator_http.py` states that per-battery cell voltages and temperatures come from the local Modbus transport, not from the cloud API, so a cloud-only entry receives the aggregate bank and nothing beneath it.

Per-cell telemetry is now unlocked, but by a different path than feeding the cloud integration's local transport. The `eg4_local` integration in this repo reads the WiFi dongle directly over TCP/8000 and publishes max/min cell voltage, cell delta, pack capacity, and module count as their own `sensor.eg4_local_*` entities, shown on the **Battery Cells** view (see [Two data sources](#two-data-sources-eg4-cloud-and-the-local-dongle) above). Two honest qualifications remain. First, those figures are separate local sensors, **not** new members of the cloud integration's empty `device_data["batteries"]` array — a cloud-only entry still shows only the aggregate bank described here. Second, some of the BMS fields the dongle exposes — cell temperatures, cycle count, pack current — are **provisional**, and register 67 is still not a battery temperature. The local integration is included and tested offline against a captured register snapshot; deploying and verifying it against this live server is a separate, deliberate step. See [docs/analysis.md](docs/analysis.md) for how the cloud-side limitation was verified three separate ways.

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
