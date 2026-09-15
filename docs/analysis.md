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

At that date the station metadata, the account request counters, the writable `number`/`select`/`switch` entities, and the disabled schedule entities were all excluded. The 2026-09-15 revamp changed the first three: station registration and the cloud API budget now have their own view, and the configuration entities carry their live values on the Configuration view, each on a tile that cannot actuate it. Device serials and the disabled entities remain excluded.

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

The Live view uses direct EG4 power entities in the native distribution, tiles, narrative, and history cards. The Energy view uses the lifetime-backed `energy-sankey`, distribution, balance, self-sufficiency, usage, and solar cards, plus a friendly-name lifetime totals card. This keeps every visualization populated without exposing serial-heavy statistics labels, while remaining responsive, theme-aware, and free of HACS dependencies.

The deployer requires the lifetime binding during preflight rather than silently showing empty historical Energy cards. It also asks Home Assistant to render the dashboard's Jinja template before any dashboard write, catching server-side template errors against live entities.

## Information architecture

The panel separates questions by time horizon:

1. **Live:** What is happening now?
2. **Energy:** Where did energy flow over a selected period?
3. **Performance:** How are power, energy, PV strings, battery, temperature, voltage, and frequency trending?
4. **System:** Is the integration and equipment healthy?

Primary values are solar production, home load, grid direction, battery power/SOC, operating state, and telemetry health. Detailed electrical/BMS values are kept out of the first view to preserve an at-a-glance hierarchy.

Solar uses amber, home load uses the active Home Assistant theme, battery uses its semantic battery icons, and grid direction is always labeled as import/export. Status never relies on color alone.

That four-view structure was superseded on 2026-09-15. The color and labeling rules below it still hold; the view list is now the nine described under "Full-inventory revamp".

## Live deployment and verification

The `eg4-energy` storage dashboard was created and then polished transactionally on 2026-08-28. Each write produced a mode-0600 rollback backup, round-tripped the saved metadata/configuration, and a final preflight reported `action=unchanged`.

The final browser gate rendered all four routes at desktop and mobile widths, repeated Live and Energy in light and dark modes, and captured 37 overlapping screenshots covering each view from top to bottom. The report found the sidebar link, at least 57 rendered dashboard elements per capture, no login redirects, no Lovelace error cards, and no actionable browser errors. Home Assistant's system log contained no dashboard-, Lovelace-, template-, or relevant energy-card error entry after deployment.

Five frontend errors were classified as pre-existing external HACS-resource noise: duplicate `focus-trap` registration from the globally loaded Frigate card and its associated source-map 404. The dashboard itself uses only native cards and does not load or reference that resource.

## Full-inventory revamp

Revamp date: 2026-09-15 (America/Phoenix)

The 2026-08-28 build was deliberately narrow. It answered "how is the system behaving?" and left everything else out. The request that prompted this revision was the opposite: show the inverter, the battery, and every sensor the system actually publishes, so the whole machine is legible from one panel.

### What the entity registry actually contains

A complete Home Assistant entity-registry inventory of the `eg4_web_monitor` platform was taken on 2026-09-15:

- 165 registry entities in total;
- 137 enabled and 28 disabled by the integration itself;
- by device: 138 on the `18KPV` inverter, 16 on its linked battery bank, and 11 on the station;
- by domain: 98 `sensor`, 21 `number`, 19 `switch`, 18 `time`, 4 `select`, 2 `binary_sensor`, 2 `button`, and 1 `update`;
- by entity category: 73 primary, 60 `config`, and 32 `diagnostic`.

The previous dashboard resolved 64 entities through discovery and placed 60 of them on a card. That left 77 enabled entities off the panel entirely: 73 that discovery never asked for, plus four it resolved and then never referenced. The gap included the EPS and generator detail, the per-phase grid and EPS voltages, the DC bus voltages, AC-couple and rectifier power, load energy, the dongle connectivity binary sensor, the battery bank's capacity and capacity-percent readings, the station's API rate diagnostics, and the full set of `number`, `switch`, `select`, and `time` settings entities. Closing that gap is the whole point of this revision.

### Two batteries, one reported bank

Jeremy has two physical battery modules of roughly 14 kWh each. The integration does not report them separately. It publishes a single aggregate `Battery Bank` device carrying 16 entities: bank state of charge, voltage, current, and power; max, full, remaining, and current capacity; capacity percent; charge rate; battery count; bank status; three BMS permission sensors; and a disabled `Last Polled` diagnostic.

`Battery Count` reads `2`. That is the only per-module fact the integration publishes on this installation. There are no per-battery entities, no per-cell voltages, and no battery temperature of any kind.

That conclusion was reached three independent ways:

1. The device registry holds exactly three EG4 devices — the station, the inverter, and the one battery bank. There are no per-battery child devices linked to the bank or to the inverter.
2. The integration builds per-battery entity ids from a known pattern (`base_entity.py:557`, `sensor.{prefix}_{model}_{serial}_battery_{id}_{key}`). No entity in the registry matches that pattern.
3. The inventory contains no battery temperature entity at all — not on the bank, not on the inverter, not on the station.

The integration is capable of creating those entities. `sensor.py:566` iterates `device_data["batteries"]` and builds one set of entities per module. That array is empty here because this config entry is cloud-only: it is configured with the EG4 monitoring cloud as its base URL plus a username, password, and plant id, and with no local transport. `coordinator_http.py:1004` documents that per-battery cell voltages and temperatures arrive over the local Modbus transport, not over the cloud API. A cloud-only entry therefore gets the aggregate bank and nothing below it.

Adding a local dongle or Modbus connection alongside the cloud entry is the plausible route to per-battery telemetry. Nobody has tried it on this installation, so the dashboard and the README present it as an untested next step rather than a promise, and the battery view carries a note explaining the limitation in place of per-module cards that would have to be invented.

### The three temperatures are the inverter's

The only temperature entities that exist are `Internal Temperature`, `Radiator 1 Temperature`, and `Radiator 2 Temperature`, all on the inverter device and all in the `diagnostic` category. At the 2026-09-15 snapshot they read approximately 50 °C, 60 °C, and 59 °C respectively — three healthy, live readings.

Radiator 1 and Radiator 2 are the inverter's two heatsinks. They are not one sensor per battery. The question that prompted this revision was whether one battery's temperature sensor had failed; the answer is that neither battery has a temperature sensor, and neither radiator reading belongs to a battery. Every label on the page names these as inverter temperatures so that reading cannot recur.

### Entities the integration disables by default

Twenty-eight entities arrive disabled and therefore carry no state:

- six `number` voltage set-points — system charge voltage limit, on-grid and off-grid cut-off voltage, AC charge start and end voltage, and stop discharge voltage;
- eighteen `time` entities forming nine start/end schedule windows — three AC charge, three forced charge, and three forced discharge;
- one `switch`, `Share Battery`;
- three `Last Polled` diagnostics, one each on the inverter, the battery bank, and the station.

None are referenced by the dashboard. A disabled entity has no live state, so a card pointing at one would render an error rather than a value, and discovery is built to report the gap on the page rather than emit a dead reference. They can be enabled individually from the entity's settings in Home Assistant, after which a future revision could surface them.

### Naming collisions in the settings entities

Five `switch` names appear twice on the inverter device: `AC Charge Mode`, `Battery Backup Mode`, `Forced Discharge Mode`, `Grid Peak Shaving Mode`, and `PV Charge Priority Mode`. The integration publishes each as both an inverter-scoped and an accessory-scoped entity, and Home Assistant disambiguates the second with a `_2` suffix on the entity id while leaving the original name identical.

That breaks a resolver that requires exactly one match per name, which is what the original contract did. The revamped contract handles it explicitly: a specification may carry `index` and `of`, and the resolver sorts the matching entity ids and takes the one at that index. Sorting by entity id rather than by registry order is what makes the pin stable, so a given contract key means the same register across a Home Assistant restart. Five names carry the pin; every other name in the contract still resolves on the strict one-match rule.

### What the revamp ships

The discovery contract now names all 137 enabled entities: 112 on the inverter, 15 on the battery bank, and 10 on the station. Against the live registry it resolves all 137 with an empty unresolved list.

The page is nine Sections views — Live, Energy, Solar, Battery, Grid & AC, Trends, Equipment, Configuration, and Station — holding 36 sections, 168 cards, and 19 badges. `node deploy.mjs --check` summarizes that as `entities=137 cards=232 views=9`; `cards` is the deployer's count of every typed object in the configuration, so it includes the views, sections, and badges as well as the cards themselves, and the 168 counts the two `entities` cards nested inside the two `entity-filter` cards.

All 137 resolved entities are referenced. The 98 that only report — every `sensor` and `binary_sensor` plus the firmware `update` entity — are laid out across the telemetry views. The other 39 are `number`, `select`, `switch`, and `button` entities, each of which is a live actuator, and the first design of this revamp left them off the page entirely for that reason. That was the wrong trade: the owner could not see what any setting was actually set to without opening 39 device pages. They are now on the Configuration view, grouped by what they govern, each as an inert tile.

Inert is a specific claim about the card, not a hope about the reader. A Home Assistant tile mounts an operable control only through its `features` key — that is what adds the toggle, the slider, the dropdown, the press button — so a tile with no `features` renders a name, an icon, and a state and nothing that can be operated. The remaining path to an action is an interaction, and `icon_tap_action` defaults to `toggle` on a toggleable domain, so all three of `tap_action`, `icon_tap_action`, and `hold_action` are pinned to `more-info` or `none`. A tap opens the entity's details dialog, which is Home Assistant's own read view, and nothing on the page can write.

`validateDashboard` enforces exactly that shape, by counting rather than by allowing. It counts, per control entity, how many inert tiles hold it and how many times its id occurs textually anywhere in the configuration. An inert tile contributes exactly one textual occurrence — its own `entity` field — so equal counts mean every occurrence is accounted for by a legitimate tile, and any disagreement means the id is also named somewhere the rule does not cover. An allow-set keyed by entity id would have missed that second case: it would see a good tile and wave through an unrelated mention of the same entity in a markdown card or an entities row.

Three design decisions follow from the inventory rather than from taste:

- Discovery no longer fails the whole page when one entity cannot be resolved. With 137 entities in the contract, the chance that the integration renames or drops one is real, and a hard failure would take down the entire panel instead of reporting the single gap. Each failure is returned as a reason and surfaced on the page.
- Those reasons never quote an entity id. The deployer treats any dotted lowercase token in the configuration as an entity reference and requires it to exist in live state, so a diagnostic message naming a missing entity would fail the deployment it was written to explain.
- The R/S/T voltage legs, the generator registers, and the EPS phase readings are shown with a note saying why they read zero on this split-phase, generator-less installation. They are real registers publishing real zeros, not broken sensors, and a page that shows them without saying so invites exactly the misreading this revision was written to correct.

## Local-dongle coverage: the per-cell detail the cloud hides

Addition date: 2026-09-15 (America/Phoenix)

The revamp above closed the gap on the cloud integration. It did not, and could not, close the gap the cloud integration itself has: the EG4 monitoring cloud aggregates the two battery modules into one bank and never returns per-cell data. That data does exist on the hardware. The sibling project `~/projects/eg4_local_monitor` reverse-engineered the WiFi dongle's LuxPower/Modbus protocol and validated a decoder that harvests all 381 input registers, including the BMS block the cloud drops: cell voltage max and min, the max−min delta that reads pack balance and health, pack capacity, module count, and — provisionally — cell temperatures, cycle count, pack current, and state of health. On this firmware the dongle exposes that telemetry but not the hold/settings registers, so a local view can report but never control.

A sibling agent is packaging that decoder as a Home Assistant integration, `eg4_local`, that publishes those decoded fields as `sensor` entities on a device modelled **EG4 18kPV (local dongle)**. This dashboard was extended to show them, so that a cloud-only, a local-only, or a both-installed system each gets a coherent panel.

### How the local entities are resolved

The local entities are resolved exactly the way the cloud entities are: by the Home Assistant device relationship plus the integration's own semantic original name, never by a written-down entity id. The `LOCAL_ENTITIES` contract in `src/discovery.mjs` lists `[domain, originalName, options]` for each field; the local device is whichever enabled device carries `eg4_local`-platform entities (the integration domain is a stable, configuration-independent identifier, unlike a serial or an entity id), with a `"local dongle"` model/name hint only to break ties. Resolving by name rather than by id is deliberate: it keeps the repo free of id literals (the lint test forbids them in `src/`), and it is drift-tolerant across two repositories built in parallel — if the sibling ships a slightly different original name, that one field reports as unresolved and its card degrades, rather than the page breaking.

The integration is contracted to publish deterministic object ids so the two repos can be reconciled by inspection. The 43 fields, their expected original names, and the entity ids they produce (`sensor.eg4_local_<slug-of-original-name>`) are:

| field / original name | expected entity id | confidence |
| --- | --- | --- |
| Cell Voltage Delta | `sensor.eg4_local_cell_voltage_delta` | confirmed — the headline |
| Cell Voltage Max | `sensor.eg4_local_cell_voltage_max` | confirmed |
| Cell Voltage Min | `sensor.eg4_local_cell_voltage_min` | confirmed |
| Pack Capacity | `sensor.eg4_local_pack_capacity` | confirmed |
| Battery Modules | `sensor.eg4_local_battery_modules` | confirmed |
| Cell Temperature Max | `sensor.eg4_local_cell_temperature_max` | provisional |
| Cell Temperature Min | `sensor.eg4_local_cell_temperature_min` | provisional |
| BMS Pack Current | `sensor.eg4_local_bms_pack_current` | provisional |
| Cycle Count | `sensor.eg4_local_cycle_count` | provisional |
| State of Health | `sensor.eg4_local_state_of_health` | provisional |
| Remaining Capacity | `sensor.eg4_local_remaining_capacity` | provisional |
| State of Charge | `sensor.eg4_local_state_of_charge` | confirmed |
| Battery Voltage | `sensor.eg4_local_battery_voltage` | confirmed |
| Battery Charge Power | `sensor.eg4_local_battery_charge_power` | confirmed |
| Battery Discharge Power | `sensor.eg4_local_battery_discharge_power` | confirmed |
| PV1/PV2/PV3 Voltage | `sensor.eg4_local_pv{1,2,3}_voltage` | confirmed |
| PV1/PV2/PV3 Power | `sensor.eg4_local_pv{1,2,3}_power` | confirmed |
| Grid Voltage R | `sensor.eg4_local_grid_voltage_r` | confirmed (L1–L2 on split-phase) |
| Grid Frequency | `sensor.eg4_local_grid_frequency` | confirmed |
| Inverter Power | `sensor.eg4_local_inverter_power` | confirmed |
| Power to Grid | `sensor.eg4_local_power_to_grid` | confirmed |
| Power to User | `sensor.eg4_local_power_to_user` | confirmed |
| Power Factor | `sensor.eg4_local_power_factor` | confirmed |
| Inverter Internal Temperature | `sensor.eg4_local_inverter_internal_temperature` | confirmed |
| Radiator 1/2 Temperature | `sensor.eg4_local_radiator_{1,2}_temperature` | confirmed |
| Charge/Discharge/Export/Import Energy Today | `sensor.eg4_local_{charge,discharge,export,import}_energy_today` | confirmed |
| Charge/Discharge/Export/Import Energy Total | `sensor.eg4_local_{charge,discharge,export,import}_energy_total` | confirmed |
| Inverter State | `sensor.eg4_local_inverter_state` | provisional |
| Runtime | `sensor.eg4_local_runtime` | confirmed |
| Fault Code | `sensor.eg4_local_fault_code` | confirmed |
| Warning Code | `sensor.eg4_local_warning_code` | confirmed |
| Inverter Serial | `sensor.eg4_local_inverter_serial` | confirmed |

The inverter-side "battery temp" register (reg67) is deliberately **not** in this contract. The decoder demoted it as untrustworthy — it reads an implausible value on this unit — so the reading that reflects the modules is the BMS cell temperature, and nothing on the page claims a battery temperature from the inverter probe.

### Honesty about confidence

Every field the `eg4_local_monitor` decoder marks provisional carries `provisional: true` in the contract, and the dashboard labels it **(provisional)** in the card name — the cell temperatures, cycle count, pack current, state of health, remaining capacity, and inverter state. The confirmed per-cell figures — cell voltage max, min, delta, pack capacity, module count — carry no such tag. This mirrors the source project's confidence discipline exactly: a value that was read correctly but whose scale or meaning is reasoned rather than cross-confirmed is shown because hiding it would be worse, but is never presented as fact.

### Two new views, and graceful degradation

The addition ships two Sections views:

- **Battery Cells** (`/cells`) — the star. It leads with a markdown header that explains, in plain language, that the page shows two independent integrations (`eg4_web_monitor` and `eg4_local`), that the local dongle exposes the per-cell detail the cloud does not, and that either can run alone — Home Assistant's data source is simply whichever integration is enabled, so there is no runtime switch to flip. The cell-balance section is built around a gauge on the cell voltage **delta**, banded green/yellow/red on typical LiFePO4 balance thresholds, because the delta is the single most useful health number the cloud cannot show. Below it are the confirmed cell voltages and capacity, a clearly-flagged provisional section, and a 24-hour cell trend.
- **Local Inverter** (`/local`) — the standalone local view: PV strings, battery, grid & AC, the inverter's own temperatures, energy today and lifetime, and status/identity, all read from the dongle. It exists so a local-only installation has a complete inverter panel of its own.

Graceful degradation is by construction and mirrors the existing missing-telemetry pattern. When the `eg4_local` integration is not installed, the local device does not exist, so every local field resolves as unresolved with a reason, `discovery.local.available` is false, and no local entity id is referenced anywhere. The **Local Inverter** view has no unconditional card, so it drops out entirely. The **Battery Cells** view keeps only its header, which now reads "**Local dongle: not detected**" and tells the reader how to get the data — the page still builds, cloud-only, with the cloud-vs-local story intact. The local unresolved entries are tagged `source: "local"` so they never pollute the cloud "did not find" report; local absence is the expected state until the integration is installed, not an error. `discovery.local` is a separate namespace from the cloud `entities`/`catalog`/`unresolved`, so every count and guarantee the rest of the code asserts against the 137-entity cloud contract is untouched.
