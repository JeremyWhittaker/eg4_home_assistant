# EG4 and Home Assistant analysis

Audit date: 2026-08-28 (America/Phoenix)

## Access path

The configured `netops-devices` MCP reaches Home Assistant through its authenticated REST and WebSocket APIs. Its direct `eg4_state` backend is a separate, read-only cloud reader. The MCP does not expose Lovelace CRUD as public MCP tools, so this project uses the same Home Assistant credentials through a focused standalone storage-dashboard deployer.

This division is deliberate:

- Home Assistant EG4 entities are the persistent dashboard source because they have Recorder history and long-term statistics.
- Direct EG4 cloud data is independent corroboration during analysis, not a second dashboard feed.
- Only the Lovelace dashboard is written; no helper, automation, service call, Energy preference, integration setting, or inverter control is changed.

## Installed integration and data model

The live server runs Home Assistant `2026.8.3` with the HACS `eg4_web_monitor` integration. One enabled inverter device reports model `18KPV`, and one `18KPV Battery Bank` device is linked to it with Home Assistant's `via_device_id` relationship.

Enabled telemetry includes:

- real-time PV total and PV1/PV2/PV3 power, voltage, and current;
- home consumption, AC/output/load, grid import/export/net, EPS, and generator power;
- battery power, state of charge, voltage, current, capacity, count, and BMS permissions;
- daily and lifetime solar, home consumption, grid import/export, charge, and discharge energy;
- grid voltage/frequency, inverter temperatures, power factor, mode, status, transport, runtime-data health, firmware, and fault/status code.

Station address, country, creation time, account request counters, device serials, writable `number`/`select`/`switch` entities, and disabled schedule entities are intentionally excluded.

## Cross-source validation

At the audit snapshot, the MCP's direct EG4 cloud reader and Home Assistant both showed approximately:

- 10.8–11.0 kW PV production;
- 1.8–2.2 kW home load;
- 100% battery SOC at 55.4 V with the battery standing by;
- about 8.5 kW grid export;
- 59.95 Hz grid frequency and roughly 244 V.

Small power differences are expected because the two cloud calls refresh at different moments. The topology reconciled: AC power was approximately home load plus grid export while battery power was zero.

Seven days of Home Assistant history contained 362 battery-power state changes, ranging from about `-11.8 kW` to `+4.0 kW`. That empirically confirms this installation's convention:

- positive battery power = charging;
- negative battery power = discharging.

The dashboard states that convention explicitly and never converts `unknown` or `unavailable` to zero.

## Energy configuration

Home Assistant Energy preferences already bind the same selected inverter to:

- grid import/export lifetime energy;
- solar yield lifetime energy;
- battery discharge/charge lifetime energy.

The configured sources do not define `stat_rate` power entities. Home Assistant's native `power-sankey` and `power-sources-graph` require those optional rate inputs, so this project deliberately omits both rather than installing cards with empty live flow. It also does not alter the user's existing Energy preferences.

The Live view uses direct EG4 power entities in the native distribution, tiles, narrative, and history cards. The Energy view uses the lifetime-backed `energy-sankey`, distribution, balance, self-sufficiency, usage, solar, and source-total cards. This keeps every visualization populated while remaining responsive, theme-aware, and free of HACS dependencies.

The deployer requires the lifetime binding during preflight rather than silently showing empty historical Energy cards. It also asks Home Assistant to render the dashboard's Jinja template before any dashboard write, catching server-side template errors against live entities.

## Information architecture

The panel separates questions by time horizon:

1. **Live:** What is happening now?
2. **Energy:** Where did energy flow over a selected period?
3. **Performance:** How are power, energy, PV strings, battery, temperature, voltage, and frequency trending?
4. **System:** Is the integration and equipment healthy?

Primary values are solar production, home load, grid direction, battery power/SOC, operating state, and telemetry health. Detailed electrical/BMS values are kept out of the first view to preserve an at-a-glance hierarchy.

Solar uses amber, home load uses the active Home Assistant theme, battery uses its semantic battery icons, and grid direction is always labeled as import/export. Status never relies on color alone.
