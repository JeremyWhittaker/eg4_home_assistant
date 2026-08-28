# EG4 Solar & Storage dashboard

A professional, native Home Assistant dashboard for an EG4 18KPV inverter and its battery bank. It is read-only, responsive, dependency-free, and installs as a dedicated **Solar & Storage** sidebar panel.

The installer discovers entities by their Home Assistant device relationship and semantic original names. Inverter serial numbers, station addresses, access tokens, and live state dumps never enter this repository.

## What it provides

- **Live** — real-time power balance, solar/home/grid/battery KPIs, battery SOC, today's energy, and a 24-hour power chart.
- **Energy** — native Energy date selection, energy distribution, grid balance, self-sufficiency, solar use, usage/solar graphs, Sankey flow, and source totals.
- **Performance** — 48-hour power, 30-day energy, PV string contribution, battery trends, temperatures, voltage, and frequency.
- **System** — connection/runtime health, inverter status, BMS detail, electrical telemetry, firmware, and daily counters.

Only built-in Home Assistant cards are used. There are no HACS frontend dependencies and no controls for inverter switches, modes, limits, schedules, quick charge, or firmware.

## Live environment analyzed

The 2026-08-28 audit found:

- Home Assistant `2026.8.3`;
- one enabled EG4 Web Monitor `18KPV` inverter and one linked battery-bank device;
- 137 enabled EG4 entities across the station, inverter, and battery bank;
- Energy sources already configured to the selected inverter's lifetime grid-import, grid-export, solar-yield, battery-charge, and battery-discharge counters;
- the MCP's independent EG4 cloud snapshot agreeing with Home Assistant on PV, load, battery SOC/voltage/power, and grid frequency/voltage;
- no relevant custom Lovelace card installed, which supports the native-only design.

The dashboard resolves 60 live entities into 79 native cards across four responsive Sections views.

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

After deployment, the headless QA runner authenticates with the same long-lived token and visits all four views at desktop and mobile sizes. It captures overlapping screenshots from top through bottom, repeats Live and Energy in light and dark modes, verifies the sidebar route, and fails on Lovelace or browser errors. Its temporary Chromium profile contains the token only in ephemeral local storage and is removed on exit.

```bash
npm run qa:visual -- --output-dir /tmp/eg4-home-assistant-qa
```

The runner defaults to `/usr/bin/chromium-browser`; override with `CHROMIUM_BIN` when needed. Screenshots and reports stay outside the repository by default.

## Safety model

- Storage-mode Lovelace is the only Home Assistant state this project mutates.
- The deployer refuses a YAML-mode dashboard collision.
- Candidate entity references are checked against live state before any write.
- Every referenced entity is a `sensor` or `binary_sensor`; mutating card actions and control domains are rejected.
- REST reads have bounded timeouts/retries. WebSocket commands have timeouts and writes are never blindly retried.
- Tokens are read only from environment variables and are absent from logs and backups.
- Backup restore includes checksum and drift guards.

See [QA_CHECKLIST.md](QA_CHECKLIST.md) for release evidence and [docs/analysis.md](docs/analysis.md) for the live data-model analysis and design rationale.
