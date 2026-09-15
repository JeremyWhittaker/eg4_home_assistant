const ENERGY_COLLECTION = "energy_eg4";

// Home Assistant device pages are linked from the Configuration view. A device id
// is a registry key, never a serial, and it is checked before it reaches a card.
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// The order configuration groups are presented in. Anything the discovery contract adds
// later falls in alphabetically after these.
const CONFIGURATION_GROUP_ORDER = [
  "Battery limits",
  "Charging",
  "Discharge and export",
  "Backup and off-grid",
  "Operating mode",
  "Station",
  "Actions",
];

const CONFIGURATION_GROUP_ICONS = Object.freeze({
  "Battery limits": "mdi:battery-lock",
  Charging: "mdi:battery-charging",
  "Discharge and export": "mdi:transmission-tower-export",
  "Backup and off-grid": "mdi:home-lightning-bolt",
  "Operating mode": "mdi:state-machine",
  Station: "mdi:map-marker-radius",
  Actions: "mdi:gesture-tap-button",
});

// The domain of a configuration entity is what makes it a control, so it is worth
// saying on the tile. These icons are the only place the page distinguishes one.
const CONFIGURATION_DOMAIN_ICONS = Object.freeze({
  number: "mdi:numeric",
  select: "mdi:form-dropdown",
  switch: "mdi:toggle-switch-outline",
  button: "mdi:gesture-tap-button",
});

const CONFIGURATION_FALLBACK_ICON = "mdi:tune-variant";

// The same rule the deployer uses to find an entity reference: any dotted lowercase
// token in any string. Mirrored here so this module can answer, on its own, which of
// the entities discovery resolved its own page actually puts on a card.
const RENDERED_REFERENCE_PATTERN = /\b[a-z_][a-z0-9_]*\.[a-z0-9_]+\b/g;

function noControlActions() {
  return {
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    icon_tap_action: { action: "more-info" },
  };
}

// Free text rendered into a card is neutralised first. The deployer treats any
// dotted lowercase token as an entity reference and requires it to exist in live
// state, so a diagnostic message that happened to quote an entity id would fail the
// whole deployment instead of reporting the problem it was written to report.
function safeText(value) {
  return String(value ?? "").replace(/\./g, "·");
}

function has(entities, key) {
  return typeof entities[key] === "string" && entities[key].length > 0;
}

function compact(cards) {
  return cards.filter(Boolean);
}

function heading(text, icon, style = "title") {
  return { type: "heading", heading: text, heading_style: style, icon };
}

function tile(entities, key, name, icon, columns = 6) {
  if (!has(entities, key)) return null;
  return {
    type: "tile",
    entity: entities[key],
    name,
    icon,
    vertical: true,
    state_content: ["state", "last_updated"],
    grid_options: { columns, rows: 2 },
    ...noControlActions(),
  };
}

function tiles(entities, specifications, columns = 6) {
  return compact(specifications.map(([key, name, icon]) => tile(entities, key, name, icon, columns)));
}

function entityRow(entities, key, name, icon) {
  if (!has(entities, key)) return null;
  return { entity: entities[key], name, ...(icon ? { icon } : {}) };
}

function entityRows(entities, specifications) {
  return compact(specifications.map(([key, name, icon]) => entityRow(entities, key, name, icon)));
}

function entitiesCard(title, rows, { stateColor = false, rowsHint = null } = {}) {
  if (!rows.length) return null;
  return {
    type: "entities",
    title,
    show_header_toggle: false,
    ...(stateColor ? { state_color: true } : {}),
    entities: rows,
    grid_options: { columns: "full", rows: rowsHint ?? Math.max(4, rows.length + 1) },
  };
}

function historyGraph(title, hoursToShow, rows, gridRows) {
  if (!rows.length) return null;
  return {
    type: "history-graph",
    title,
    hours_to_show: hoursToShow,
    entities: rows,
    grid_options: { columns: "full", rows: gridRows },
  };
}

function statisticsGraph(title, rows, { days = 30, gridRows = 7 } = {}) {
  if (!rows.length) return null;
  return {
    type: "statistics-graph",
    title,
    entities: rows,
    stat_types: ["change"],
    period: "day",
    days_to_show: days,
    chart_type: "bar",
    hide_legend: false,
    grid_options: { columns: "full", rows: gridRows },
  };
}

function distribution(title, series) {
  const present = series.filter((item) => item.entity);
  if (present.length < 2) return null;
  return { type: "distribution", title, entities: present, grid_options: { columns: "full" } };
}

function series(entities, key, name, color) {
  return has(entities, key) ? { entity: entities[key], name, color } : { entity: null };
}

function markdown(content) {
  if (!content) return null;
  return { type: "markdown", content, grid_options: { columns: "full" } };
}

// A grid section that holds nothing but headings is dropped, so a view never shows a
// title with an empty space under it when the integration stops publishing a group.
function gridSection(cards) {
  const present = compact(cards);
  if (!present.some((card) => card.type !== "heading")) return null;
  return { type: "grid", cards: present };
}

function view({ title, path, icon, badges = [], sections }) {
  const present = compact(sections);
  if (!present.length) return null;
  return {
    title,
    path,
    icon,
    type: "sections",
    max_columns: 2,
    dense_section_placement: true,
    ...(badges.length ? { badges } : {}),
    sections: present,
  };
}

function badge(entities, key, name, icon) {
  if (!has(entities, key)) return null;
  return { type: "entity", entity: entities[key], name, icon, ...noControlActions() };
}

function badges(entities, specifications) {
  return compact(specifications.map(([key, name, icon]) => badge(entities, key, name, icon)));
}

function devicePageLink(label, deviceId) {
  if (!deviceId || !DEVICE_ID_PATTERN.test(deviceId)) return null;
  return `[${label}](/config/devices/device/${deviceId})`;
}

function renderedEntityIds(config) {
  return new Set(JSON.stringify(config).match(RENDERED_REFERENCE_PATTERN) ?? []);
}

// The entities discovery resolved that the page then puts on no card at all. Every
// domain in the contract now has a home: the reporting domains are laid out across the
// telemetry views, and the control domains are shown on the Configuration view as
// inert value tiles that report a setting without being able to change it. So a
// healthy discovery withholds nothing, and a name appearing here is a hole in the
// layout to be closed rather than a policy being enforced.
export function withheldEntities(discovery) {
  const rendered = renderedEntityIds(buildDashboard(discovery));
  // Both sources are checked: the cloud catalog and the local-dongle catalog. Each item
  // is keyed by its own unique entity id, so a cloud key and a local key that happen to
  // share a name (pv1Power, gridFrequency, and the like) are still counted separately.
  const catalogs = [discovery.catalog ?? {}, discovery.local?.catalog ?? {}];
  const keys = catalogs
    .flatMap((catalog) => Object.values(catalog))
    .filter((item) => item.entityId && !rendered.has(item.entityId))
    .map((item) => item.key)
    .sort();
  return Object.freeze({
    keys,
    reason: "resolved by discovery but placed on no card; the page is built to render every entity it resolves",
  });
}

const LIVE_SUMMARY_KEYS = [
  "pvPower",
  "loadPower",
  "gridImportPower",
  "gridExportPower",
  "batteryPower",
  "batteryBankSoc",
  "connectionLost",
  "runtimeData",
  "transport",
  "cloudStatus",
  "offGrid",
  "operatingState",
];

function liveSummary(e) {
  if (!LIVE_SUMMARY_KEYS.every((key) => has(e, key))) return null;
  return `{% set unavailable = ['unknown', 'unavailable', 'none', ''] %}
{% set pv_raw = states('${e.pvPower}') %}
{% set load_raw = states('${e.loadPower}') %}
{% set import_raw = states('${e.gridImportPower}') %}
{% set export_raw = states('${e.gridExportPower}') %}
{% set battery_raw = states('${e.batteryPower}') %}
{% set soc_raw = states('${e.batteryBankSoc}') %}
{% set telemetry_ok = pv_raw | lower not in unavailable and load_raw | lower not in unavailable and import_raw | lower not in unavailable and export_raw | lower not in unavailable and battery_raw | lower not in unavailable and soc_raw | lower not in unavailable %}
{% set connection_ok = states('${e.connectionLost}') | lower in ['false', 'off'] and states('${e.runtimeData}') | lower in ['true', 'on'] %}
{% if not telemetry_ok or not connection_ok %}
## ⚠️ Telemetry needs attention
One or more live readings are unavailable. Values below are left unavailable—not treated as zero. **Connection:** {{ states('${e.transport}') }} · **Cloud:** {{ states('${e.cloudStatus}') }}
{% else %}
{% set pv = pv_raw | float %}
{% set load = load_raw | float %}
{% set imported = import_raw | float %}
{% set exported = export_raw | float %}
{% set battery = battery_raw | float %}
{% set soc = soc_raw | float %}
{% if is_state('${e.offGrid}', 'on') %}
## 🏝️ Operating off-grid
{% else %}
## ☀️ Solar system online
{% endif %}
Producing **{{ (pv / 1000) | round(1) }} kW** with **{{ (load / 1000) | round(1) }} kW** on EG4's metered AC balance. This is an equipment reading, not the whole-property load; use **Home Energy** for the Enphase-corrected total.
{% if exported > 50 %}Exporting **{{ (exported / 1000) | round(1) }} kW** to the grid.{% elif imported > 50 %}Importing **{{ (imported / 1000) | round(1) }} kW** from the grid.{% else %}Grid exchange is effectively neutral.{% endif %}
Battery is **{{ soc | round(0) }}%** and {% if battery > 50 %}charging at **{{ (battery / 1000) | round(1) }} kW**{% elif battery < -50 %}discharging at **{{ ((battery | abs) / 1000) | round(1) }} kW**{% else %}standing by{% endif %}. · **Mode:** {{ state_translated('${e.operatingState}') }}
{% endif %}`;
}

// Entities that resolved but are currently reporting nothing. This is a live filter, so
// it stays empty while the system is healthy.
function missingTelemetryCard(e) {
  const rows = entityRows(e, [
    ["pvPower", "Solar production"],
    ["loadPower", "EG4 metered load"],
    ["gridImportPower", "Grid import"],
    ["gridExportPower", "Grid export"],
    ["batteryPower", "Battery power"],
    ["batteryBankSoc", "Battery state of charge"],
    ["runtimeData", "Runtime data"],
  ]);
  if (!rows.length) return null;
  return {
    type: "entity-filter",
    state_filter: ["unknown", "unavailable"],
    show_empty: false,
    entities: rows,
    card: {
      type: "entities",
      title: "Unavailable telemetry",
      show_header_toggle: false,
      state_color: true,
    },
    grid_options: { columns: "full" },
  };
}

// Entities the contract expects but discovery could not resolve at all. These have no
// entity id, so no card can show their state; naming them here is the only way they stay
// visible instead of quietly disappearing from the page.
function unresolvedCard(discovery) {
  const unresolved = (discovery.unresolved ?? []).filter((item) => item.reporting);
  const configuration = (discovery.unresolved ?? []).filter((item) => !item.reporting);
  if (!unresolved.length && !configuration.length) return null;
  const lines = [];
  lines.push("## ⚠️ Entities this page expected but did not find");
  lines.push("The EG4 integration no longer publishes every entity this dashboard knows about. Nothing below is being hidden — it simply has no entity to show.");
  if (unresolved.length) {
    lines.push("");
    lines.push("**Missing telemetry**");
    for (const item of unresolved) {
      lines.push(`- ${safeText(item.originalName)} — ${safeText(item.device)} ${safeText(item.domain)}; ${safeText(item.reason)}`);
    }
  }
  if (configuration.length) {
    lines.push("");
    lines.push("**Missing configuration entities**");
    for (const item of configuration) {
      lines.push(`- ${safeText(item.originalName)} — ${safeText(item.device)} ${safeText(item.domain)}; ${safeText(item.reason)}`);
    }
  }
  return markdown(lines.join("\n"));
}

function batteryBankNote(discovery) {
  const link = devicePageLink("battery bank device page", discovery.battery?.deviceId);
  return markdown([
    "### Two modules, one reported bank",
    "",
    "Home Assistant shows a single battery device for this system. The EG4 cloud API aggregates both modules into one bank, so every figure on this view is the pair combined. **Battery Count**, listed below as *Modules in the bank*, is the only per-module fact the integration publishes here.",
    "",
    "There are no per-battery entities, no per-cell voltages, and no per-module thermal readings on this connection. The integration is capable of publishing them, but only over the local Modbus dongle transport; this config entry is cloud-only, so its per-battery array arrives empty. Adding the local connection is what would unlock per-module detail.",
    "",
    "The three temperatures on **Equipment** belong to the inverter, not to the modules.",
    ...(link ? ["", `Open the ${link} to see everything Home Assistant holds for the bank.`] : []),
  ].join("\n"));
}

function inverterTemperatureNote() {
  return markdown([
    "### These are inverter temperatures",
    "",
    "All three readings below come from the inverter itself. **Radiator 1** and **Radiator 2** are its two internal heatsinks — they are not one per battery module, and a gap between them says nothing about either module's health.",
    "",
    "Neither battery module reports a temperature over the cloud API, so this system has no per-module thermal reading to compare against.",
  ].join("\n"));
}

function configurationGroupOrder(left, right) {
  const leftIndex = CONFIGURATION_GROUP_ORDER.indexOf(left);
  const rightIndex = CONFIGURATION_GROUP_ORDER.indexOf(right);
  if (leftIndex !== rightIndex) return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
  return left.localeCompare(right);
}

// One configuration entity, shown as a tile that reports its live value and cannot
// change it. This reuses tile(), which is what makes the shape exact: no `features`
// key — `features` is what would mount the toggle, slider, or dropdown that actuates
// the entity — plus noControlActions(), which pins all three interactions. The pin
// matters most for the icon: Home Assistant's default icon tap on a toggleable domain
// is `toggle`, so an unpinned icon is a live switch. What is left renders a name, an
// icon, and a state. validateDashboard in src/deployer.mjs enforces this exact shape
// as the only way a control-domain entity may appear anywhere on the page.
function configurationTile(item, ambiguousNames = new Set()) {
  if (!item?.entityId) return null;
  // The integration publishes five of the mode switches twice under one name. Both are
  // shown, numbered, so the repetition reads as a fact about the integration rather
  // than as a duplicated tile.
  const instance = item.instances ? ` (${item.instance} of ${item.instances})` : "";
  // A name can also collide across devices -- the inverter and the station each publish
  // a "Refresh Data" button. Those carry no instance pin, so without the device name the
  // two tiles are indistinguishable. Qualify only the ones that actually collide, so the
  // common case stays short.
  const device = !item.instances && ambiguousNames.has(item.originalName)
    ? ` · ${safeText(item.device)}`
    : "";
  const icon = CONFIGURATION_DOMAIN_ICONS[item.domain] ?? CONFIGURATION_FALLBACK_ICON;
  return tile({ [item.key]: item.entityId }, item.key, `${safeText(item.originalName)}${instance}${device}`, icon);
}

// Every configuration entity the integration publishes, grouped by what it governs and
// carrying its value, so the whole setup can be read in one pass. One section per
// group, in the contract's own order, sorted by name inside the group.
function configurationValueSections(discovery) {
  const catalog = discovery.catalog ?? {};
  const groups = new Map();
  const nameCounts = new Map();
  for (const item of Object.values(catalog)) {
    if (item.reporting || !item.entityId || item.instances) continue;
    nameCounts.set(item.originalName, (nameCounts.get(item.originalName) ?? 0) + 1);
  }
  const ambiguousNames = new Set([...nameCounts].filter(([, n]) => n > 1).map(([name]) => name));
  for (const item of Object.values(catalog)) {
    if (item.reporting || !item.entityId) continue;
    const name = item.group ?? "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return [...groups.keys()].sort(configurationGroupOrder).map((name) => gridSection([
    heading(safeText(name), CONFIGURATION_GROUP_ICONS[name] ?? CONFIGURATION_FALLBACK_ICON, "subtitle"),
    ...groups.get(name)
      .slice()
      .sort((left, right) => left.originalName.localeCompare(right.originalName))
      .map((item) => configurationTile(item, ambiguousNames)),
  ]));
}

function configurationNote(discovery) {
  const inverterLink = devicePageLink("inverter device page", discovery.inverter?.deviceId);
  const stationLink = devicePageLink("station device page", discovery.station?.deviceId);
  const links = compact([inverterLink, stationLink]);
  return markdown([
    "### Configuration is read here, changed elsewhere",
    "",
    "This page is an instrument panel. Every card on it reads; none of them writes. The tiles below carry the live value of every configuration entity the EG4 integration publishes — charge and discharge limits, SOC cut-offs, power caps, operating and PV input modes, and the mode switches — so the whole setup can be audited at a glance instead of opened one entity at a time.",
    "",
    "Those tiles are deliberately inert. Each is a plain value tile with no control attached and every interaction pinned to more-info, so tapping one opens its details and cannot change it. Nothing on this page is a toggle, a slider, or a dropdown.",
    "",
    "Five tiles are numbered *1 of 2* and *2 of 2*. The integration registers those switches twice — once inverter-scoped, once accessory-scoped — and only the second copy ever reports. The first reads **Unavailable** permanently and carries a warning badge. That is a quirk of the integration's registration, not a fault in the inverter, and the second copy is the one telling you the truth.",
    "",
    "Change a setting deliberately, from the device page.",
    ...(links.length ? ["", `Open the ${links.join(" or the ")}.`] : []),
  ].join("\n"));
}

function disabledEntitiesNote() {
  return markdown([
    "### Registered but disabled by default",
    "",
    "The integration registers further entities that Home Assistant disables on creation: the per-device Last Polled diagnostics, the battery voltage set-points that pair with the SOC cut-offs above, the Share Battery switch, and the AC-charge, forced-charge, and forced-discharge schedule windows.",
    "",
    "A disabled entity holds no state at all, so no card can show one. Enabling any of them on its device page gives it state, after which the next deployment can surface it.",
  ].join("\n"));
}

// The cloud-vs-local explainer that heads the Battery Cells page. It states plainly that
// the page shows two independent integrations, that the local dongle exposes the per-cell
// detail the cloud does not, and that either can run alone — Home Assistant's source is
// simply whichever integration is enabled, so there is no runtime switch to flip. The last
// line reports whether the local dongle is currently detected, which is how a cloud-only
// installation learns what it is missing and how to get it.
function localSourceNote(discovery) {
  const present = discovery.local?.available;
  return markdown([
    "### Cloud and local, side by side",
    "",
    "This inverter can report through two independent Home Assistant integrations, and this dashboard shows whichever are installed:",
    "",
    "- **EG4 cloud** (`eg4_web_monitor`) — the account and plant view behind the Live, Energy, Solar, Battery, Grid, Trends, Equipment, Configuration, and Station pages. It aggregates the two battery modules into one bank and never returns per-cell detail.",
    "- **Local dongle** (`eg4_local`) — a direct read of the WiFi dongle on your own network. It surfaces the data the cloud hides: per-cell voltage max, min, and the max−min **delta** that reads pack balance and health, plus pack capacity, module count, and provisional cell temperatures and cycle count.",
    "",
    "Either can run on its own. There is no switch to flip on this page — Home Assistant's data source is whichever integration is enabled, and the page renders what is present. You choose cloud credentials, a local dongle IP, or both in the integrations' own setup.",
    "",
    present
      ? "**Local dongle: connected.** The per-cell cards below are live."
      : "**Local dongle: not detected.** The per-cell cards stay empty until the `eg4_local` integration is installed and pointed at the dongle. The rest of this dashboard keeps running from the cloud integration.",
  ].join("\n"));
}

function localProvisionalNote() {
  return markdown([
    "### About the provisional readings",
    "",
    "Fields tagged **(provisional)** are read correctly off the dongle, but their scale or meaning is reasoned from the LuxPower/EG4 register family rather than confirmed independently on this unit — the cell temperatures, cycle count, pack current, state of health, and remaining capacity. They are shown because hiding them would be worse, never as confirmed fact.",
    "",
    "The confirmed per-cell figures are the cell voltage max, min, and delta, the pack capacity, and the module count. The inverter's own \"battery probe\" register is not shown at all: the decoder demoted it as untrustworthy, and the reading that reflects the modules is the BMS cell temperature here.",
  ].join("\n"));
}

// Resolved local entities that are currently reporting nothing, mirroring the cloud
// missingTelemetryCard: a live filter that stays empty while the dongle is healthy.
function localMissingTelemetryCard(le) {
  const rows = entityRows(le, [
    ["cellVoltageDelta", "Cell voltage delta"],
    ["cellVoltageMax", "Max cell voltage"],
    ["cellVoltageMin", "Min cell voltage"],
    ["packCapacity", "Pack capacity"],
    ["batteryModules", "Battery modules"],
    ["localSoc", "State of charge"],
  ]);
  if (!rows.length) return null;
  return {
    type: "entity-filter",
    state_filter: ["unknown", "unavailable"],
    show_empty: false,
    entities: rows,
    card: {
      type: "entities",
      title: "Unavailable local telemetry",
      show_header_toggle: false,
      state_color: true,
    },
    grid_options: { columns: "full" },
  };
}

// The Battery Cells page: the per-cell BMS detail the cloud hides, built around the local
// dongle. The header is unconditional so a cloud-only installation still gets the
// cloud-vs-local explanation and learns the dongle is not connected; every data card is
// gated on a resolved local entity, so when the local integration is absent the data
// sections drop out and only the explainer remains — the page still builds.
function batteryCellsView(discovery) {
  const le = discovery.local?.entities ?? {};
  const live = Boolean(discovery.local?.available);
  return view({
    title: "Battery Cells",
    path: "cells",
    icon: "mdi:battery-heart-variant",
    badges: badges(le, [
      ["cellVoltageDelta", "Cell delta", "mdi:battery-sync"],
      ["cellVoltageMax", "Cell max", "mdi:battery-high"],
      ["cellVoltageMin", "Cell min", "mdi:battery-low"],
      ["batteryModules", "Modules", "mdi:battery-multiple"],
    ]),
    sections: [
      gridSection([
        heading("Per-cell battery detail (local dongle)", "mdi:battery-heart-variant"),
        localSourceNote(discovery),
        localMissingTelemetryCard(le),
      ]),
      gridSection([
        heading("Cell balance", "mdi:battery-sync"),
        has(le, "cellVoltageDelta")
          ? {
            type: "gauge",
            entity: le.cellVoltageDelta,
            name: "Cell voltage delta (max − min)",
            unit: "mV",
            min: 0,
            max: 200,
            needle: true,
            // Higher delta is worse: a tight pack sits low and green, a drifting or
            // failing one climbs into yellow and red. Thresholds are typical LiFePO4
            // balance bands, shown as guidance rather than a calibrated alarm.
            severity: { green: 0, yellow: 50, red: 100 },
            grid_options: { columns: "full", rows: 3 },
          }
          : null,
        ...tiles(le, [
          ["cellVoltageMax", "Max cell voltage", "mdi:battery-high"],
          ["cellVoltageMin", "Min cell voltage", "mdi:battery-low"],
        ]),
        live
          ? markdown("**Delta is the headline.** It is the highest cell's voltage minus the lowest across the whole pack. A small delta means the cells are balanced; a delta that grows over time — especially near full or empty — is the earliest sign of a weak cell or a balancing problem, and it is exactly what the cloud API does not report.")
          : null,
      ]),
      gridSection([
        heading("Cell voltages and capacity", "mdi:battery-heart-variant"),
        entitiesCard("Confirmed per-cell", entityRows(le, [
          ["cellVoltageMax", "Max cell voltage", "mdi:battery-high"],
          ["cellVoltageMin", "Min cell voltage", "mdi:battery-low"],
          ["cellVoltageDelta", "Cell voltage delta (max − min)", "mdi:battery-sync"],
          ["packCapacity", "Pack capacity", "mdi:battery"],
          ["batteryModules", "Battery modules", "mdi:battery-multiple"],
        ])),
      ]),
      gridSection([
        heading("Provisional BMS detail", "mdi:alert-outline"),
        live ? localProvisionalNote() : null,
        entitiesCard("Provisional readings", entityRows(le, [
          ["cellTempMax", "Max cell temperature (provisional)", "mdi:thermometer-high"],
          ["cellTempMin", "Min cell temperature (provisional)", "mdi:thermometer-low"],
          ["bmsPackCurrent", "BMS pack current (provisional)", "mdi:current-dc"],
          ["cycleCount", "Cycle count (provisional)", "mdi:battery-sync-outline"],
          ["stateOfHealth", "State of health (provisional)", "mdi:heart-pulse"],
          ["remainingCapacity", "Remaining capacity (provisional)", "mdi:battery-70"],
        ])),
      ]),
      gridSection([
        heading("Cell trend · 24 hours", "mdi:chart-line"),
        historyGraph("Cell voltage max, min, and delta", 24, entityRows(le, [
          ["cellVoltageMax", "Max cell voltage"],
          ["cellVoltageMin", "Min cell voltage"],
          ["cellVoltageDelta", "Delta (max − min)"],
        ]), 6),
      ]),
    ],
  });
}

// The standalone local-inverter page: everything the dongle reports besides the per-cell
// block, so a local-only installation has a full inverter view of its own. It is built
// only when the local dongle is present — every card, including the header note, is gated,
// so with no local integration the whole view drops rather than showing an empty shell.
function localInverterView(discovery) {
  const le = discovery.local?.entities ?? {};
  if (!discovery.local?.available) return null;
  return view({
    title: "Local Inverter",
    path: "local",
    icon: "mdi:lan-connect",
    badges: badges(le, [
      ["localSoc", "Battery", "mdi:home-battery"],
      ["inverterPower", "Inverter", "mdi:flash"],
      ["gridFrequency", "Frequency", "mdi:current-ac"],
    ]),
    sections: [
      gridSection([
        heading("Local dongle (direct Modbus)", "mdi:lan-connect"),
        markdown("These readings come straight from the WiFi dongle on your network over Modbus, independent of the EG4 cloud. On this firmware the dongle exposes live telemetry but not the hold/settings registers, so this page reports and never controls — the same read-only rule as the rest of the dashboard."),
      ]),
      gridSection([
        heading("Solar strings", "mdi:solar-panel-large"),
        distribution("String contribution", [
          series(le, "pv1Power", "String 1", "#f9a825"),
          series(le, "pv2Power", "String 2", "#fbc02d"),
          series(le, "pv3Power", "String 3", "#fdd835"),
        ]),
        ...tiles(le, [
          ["pv1Power", "String 1 power", "mdi:solar-panel"],
          ["pv2Power", "String 2 power", "mdi:solar-panel"],
          ["pv3Power", "String 3 power", "mdi:solar-panel"],
        ]),
        entitiesCard("String voltages", entityRows(le, [
          ["pv1Voltage", "String 1 voltage", "mdi:sine-wave"],
          ["pv2Voltage", "String 2 voltage", "mdi:sine-wave"],
          ["pv3Voltage", "String 3 voltage", "mdi:sine-wave"],
        ])),
      ]),
      gridSection([
        heading("Battery", "mdi:home-battery"),
        has(le, "localSoc")
          ? {
            type: "gauge",
            entity: le.localSoc,
            name: "State of charge",
            min: 0,
            max: 100,
            needle: true,
            severity: { red: 0, yellow: 20, green: 50 },
            grid_options: { columns: "full", rows: 3 },
          }
          : null,
        ...tiles(le, [
          ["batteryVoltage", "Battery voltage", "mdi:sine-wave"],
          ["batteryChargePower", "Charge power", "mdi:battery-arrow-up"],
          ["batteryDischargePower", "Discharge power", "mdi:battery-arrow-down"],
        ]),
        markdown("Per-cell voltage, delta, capacity, and the provisional cell temperatures live on the **Battery Cells** page — that is the detail the cloud cannot see."),
      ]),
      gridSection([
        heading("Grid & AC", "mdi:transmission-tower"),
        entitiesCard("AC and grid", entityRows(le, [
          ["inverterPower", "Inverter power", "mdi:flash"],
          ["powerToGrid", "Power to grid (export)", "mdi:transmission-tower-export"],
          ["powerToUser", "Power to user (import)", "mdi:transmission-tower-import"],
          ["gridVoltage", "Grid voltage (L1–L2)", "mdi:sine-wave"],
          ["gridFrequency", "Grid frequency", "mdi:current-ac"],
          ["powerFactor", "Power factor", "mdi:angle-acute"],
        ])),
        markdown("This 18kPV is split-phase; the dongle's grid-voltage R register is the L1–L2 service reading, and the unused S and T legs are not surfaced here."),
      ]),
      gridSection([
        heading("Temperatures", "mdi:thermometer-lines"),
        markdown("These three are the inverter's own sensors — its internal temperature and its two heatsinks. They are inverter readings, not module ones; the reading that reflects the modules is the per-cell BMS figure on the **Battery Cells** page. The inverter-side battery probe is not shown, because the decoder found it untrustworthy on this unit."),
        ...tiles(le, [
          ["internalTemperature", "Inverter internal", "mdi:thermometer"],
          ["radiator1Temperature", "Radiator 1 (heatsink)", "mdi:radiator"],
          ["radiator2Temperature", "Radiator 2 (heatsink)", "mdi:radiator"],
        ]),
      ]),
      gridSection([
        heading("Energy", "mdi:counter"),
        entitiesCard("Today", entityRows(le, [
          ["chargeEnergyToday", "Battery charged", "mdi:battery-arrow-up"],
          ["dischargeEnergyToday", "Battery discharged", "mdi:battery-arrow-down"],
          ["exportEnergyToday", "Exported", "mdi:transmission-tower-export"],
          ["importEnergyToday", "Imported", "mdi:transmission-tower-import"],
        ])),
        entitiesCard("Lifetime", entityRows(le, [
          ["chargeEnergyTotal", "Battery charged", "mdi:battery-arrow-up"],
          ["dischargeEnergyTotal", "Battery discharged", "mdi:battery-arrow-down"],
          ["exportEnergyTotal", "Exported", "mdi:transmission-tower-export"],
          ["importEnergyTotal", "Imported", "mdi:transmission-tower-import"],
        ])),
      ]),
      gridSection([
        heading("Status and identity", "mdi:identifier"),
        entitiesCard("Inverter", entityRows(le, [
          ["inverterState", "Inverter state (provisional)", "mdi:state-machine"],
          ["runtime", "Runtime", "mdi:timer-outline"],
          ["faultCode", "Fault code", "mdi:alert-circle-outline"],
          ["warningCode", "Warning code", "mdi:alert-outline"],
          ["inverterSerial", "Inverter serial", "mdi:barcode"],
        ]), { stateColor: true }),
      ]),
    ],
  });
}

export function buildDashboard(discovery) {
  const e = discovery.entities;
  const views = compact([
    view({
      title: "Live",
      path: "live",
      icon: "mdi:solar-power",
      badges: badges(e, [
        ["pvPower", "Solar", "mdi:solar-power"],
        ["loadPower", "Home", "mdi:home-lightning-bolt"],
        ["batteryBankSoc", "Battery", "mdi:home-battery"],
        ["gridPower", "Grid", "mdi:transmission-tower"],
        ["operatingState", "Mode", "mdi:state-machine"],
      ]),
      sections: [
        gridSection([
          heading("Live energy flow", "mdi:transmission-tower-import"),
          markdown(liveSummary(e)),
          unresolvedCard(discovery),
          missingTelemetryCard(e),
          distribution("Current power readings", [
            series(e, "pvPower", "Solar production", "#f9a825"),
            series(e, "loadPower", "EG4 metered load", "#1e88e5"),
            series(e, "gridImportPower", "Grid import", "#7e57c2"),
            series(e, "gridExportPower", "Grid export", "#8e24aa"),
            series(e, "batteryPower", "Battery (+ charge / − discharge)", "#00897b"),
          ]),
          heading("Primary power", "mdi:flash", "subtitle"),
          ...tiles(e, [
            ["pvPower", "Solar production", "mdi:solar-power"],
            ["loadPower", "EG4 metered load", "mdi:meter-electric-outline"],
            ["gridImportPower", "Grid import", "mdi:transmission-tower-import"],
            ["gridExportPower", "Grid export", "mdi:transmission-tower-export"],
          ]),
        ]),
        gridSection([
          heading("Battery", "mdi:home-battery"),
          has(e, "batteryBankSoc")
            ? {
              type: "gauge",
              entity: e.batteryBankSoc,
              name: "State of charge",
              min: 0,
              max: 100,
              needle: true,
              severity: { red: 0, yellow: 20, green: 50 },
              grid_options: { columns: "full", rows: 3 },
            }
            : null,
          ...tiles(e, [
            ["batteryPower", "Battery power (+ charge / − discharge)", "mdi:battery-charging"],
            ["batteryBankStatus", "Battery status", "mdi:battery-heart"],
          ]),
          heading("Today", "mdi:calendar-today", "subtitle"),
          ...tiles(e, [
            ["yieldToday", "Solar generated", "mdi:white-balance-sunny"],
            ["consumptionToday", "EG4 metered consumption", "mdi:meter-electric-outline"],
            ["gridImportToday", "Imported", "mdi:transmission-tower-import"],
            ["gridExportToday", "Exported", "mdi:transmission-tower-export"],
          ]),
          heading("Last 24 hours", "mdi:chart-areaspline", "subtitle"),
          historyGraph("Power history", 24, entityRows(e, [
            ["pvPower", "Solar"],
            ["loadPower", "EG4 metered load"],
            ["gridImportPower", "Grid import"],
            ["gridExportPower", "Grid export"],
            ["batteryPower", "Battery (+ charge / − discharge)"],
          ]), 6),
        ]),
      ],
    }),

    view({
      title: "Energy",
      path: "energy",
      icon: "mdi:chart-sankey-variant",
      sections: [
        gridSection([
          heading("Energy balance", "mdi:chart-donut"),
          { type: "energy-date-selection", collection_key: ENERGY_COLLECTION, grid_options: { columns: "full" } },
          { type: "energy-distribution", title: "Where energy flowed", collection_key: ENERGY_COLLECTION, link_dashboard: false, grid_options: { columns: "full", rows: 5 } },
          { type: "energy-grid-balance", collection_key: ENERGY_COLLECTION, grid_options: { columns: 6, rows: 3 } },
          { type: "energy-self-sufficiency-gauge", collection_key: ENERGY_COLLECTION, grid_options: { columns: 6, rows: 3 } },
          { type: "energy-solar-consumed-gauge", collection_key: ENERGY_COLLECTION, grid_options: { columns: "full", rows: 3 } },
        ]),
        gridSection([
          heading("Production and use", "mdi:chart-areaspline"),
          { type: "energy-usage-graph", title: "Home energy", collection_key: ENERGY_COLLECTION, show_legend: false, grid_options: { columns: "full", rows: 6 } },
          { type: "energy-solar-graph", title: "Solar production", collection_key: ENERGY_COLLECTION, grid_options: { columns: "full", rows: 6 } },
          historyGraph("Today's power detail", 24, entityRows(e, [
            ["pvPower", "Solar"],
            ["loadPower", "EG4 metered load"],
            ["gridImportPower", "Grid import"],
            ["gridExportPower", "Grid export"],
            ["batteryPower", "Battery (+ charge / − discharge)"],
          ]), 6),
        ]),
        gridSection([
          heading("Flow detail", "mdi:chart-sankey"),
          { type: "energy-sankey", title: "Energy flow", collection_key: ENERGY_COLLECTION, layout: "auto", group_by_area: false, group_by_floor: false, grid_options: { columns: "full", rows: 7 } },
        ]),
        gridSection([
          heading("Lifetime totals", "mdi:counter"),
          entitiesCard("Lifetime energy", entityRows(e, [
            ["yieldLifetime", "Solar generated", "mdi:solar-power"],
            ["consumptionLifetime", "EG4 metered consumption", "mdi:meter-electric-outline"],
            ["loadEnergyLifetime", "Load energy", "mdi:home-lightning-bolt"],
            ["gridImportLifetime", "Grid imported", "mdi:transmission-tower-import"],
            ["gridExportLifetime", "Grid exported", "mdi:transmission-tower-export"],
            ["chargingLifetime", "Battery charged", "mdi:battery-arrow-up"],
            ["dischargingLifetime", "Battery discharged", "mdi:battery-arrow-down"],
          ])),
        ]),
      ],
    }),

    view({
      title: "Solar",
      path: "solar",
      icon: "mdi:solar-panel-large",
      badges: badges(e, [
        ["pvPower", "Array total", "mdi:solar-power"],
        ["yieldToday", "Today", "mdi:white-balance-sunny"],
      ]),
      sections: [
        gridSection([
          heading("Array output", "mdi:solar-panel-large"),
          distribution("Current string contribution", [
            series(e, "pv1Power", "String 1", "#f9a825"),
            series(e, "pv2Power", "String 2", "#fbc02d"),
            series(e, "pv3Power", "String 3", "#fdd835"),
          ]),
          ...tiles(e, [
            ["pvPower", "Array total", "mdi:solar-power"],
            ["pv1Power", "String 1", "mdi:solar-panel"],
            ["pv2Power", "String 2", "mdi:solar-panel"],
            ["pv3Power", "String 3", "mdi:solar-panel"],
          ]),
        ]),
        gridSection([
          heading("String telemetry", "mdi:current-dc"),
          entitiesCard("String 1", entityRows(e, [
            ["pv1Power", "Power", "mdi:solar-panel"],
            ["pv1Voltage", "Voltage", "mdi:sine-wave"],
            ["pv1Current", "Current", "mdi:current-dc"],
          ])),
          entitiesCard("String 2", entityRows(e, [
            ["pv2Power", "Power", "mdi:solar-panel"],
            ["pv2Voltage", "Voltage", "mdi:sine-wave"],
            ["pv2Current", "Current", "mdi:current-dc"],
          ])),
          entitiesCard("String 3", entityRows(e, [
            ["pv3Power", "Power", "mdi:solar-panel"],
            ["pv3Voltage", "Voltage", "mdi:sine-wave"],
            ["pv3Current", "Current", "mdi:current-dc"],
          ])),
        ]),
        gridSection([
          heading("Solar energy", "mdi:counter"),
          entitiesCard("Generated", entityRows(e, [
            ["yieldToday", "Today", "mdi:white-balance-sunny"],
            ["yieldLifetime", "Lifetime", "mdi:counter"],
          ])),
          historyGraph("String power · 24 hours", 24, entityRows(e, [
            ["pv1Power", "String 1"],
            ["pv2Power", "String 2"],
            ["pv3Power", "String 3"],
          ]), 6),
          statisticsGraph("Solar generated · 30 days", entityRows(e, [["yieldLifetime", "Solar generated"]])),
        ]),
      ],
    }),

    view({
      title: "Battery",
      path: "battery",
      icon: "mdi:home-battery",
      badges: badges(e, [
        ["batteryBankSoc", "Bank SOC", "mdi:home-battery"],
        ["batteryBankPower", "Bank power", "mdi:battery-charging"],
        ["batteryBankStatus", "Status", "mdi:battery-heart"],
      ]),
      sections: [
        gridSection([
          heading("Bank state", "mdi:home-battery"),
          batteryBankNote(discovery),
          has(e, "batteryBankSoc")
            ? {
              type: "gauge",
              entity: e.batteryBankSoc,
              name: "Bank state of charge",
              min: 0,
              max: 100,
              needle: true,
              severity: { red: 0, yellow: 20, green: 50 },
              grid_options: { columns: "full", rows: 3 },
            }
            : null,
          ...tiles(e, [
            ["batteryBankPower", "Bank power", "mdi:battery-charging"],
            ["batteryBankVoltage", "Bank voltage", "mdi:sine-wave"],
            ["batteryBankCurrent", "Bank current", "mdi:current-dc"],
            ["batteryBankChargeRate", "Charge rate", "mdi:speedometer"],
          ]),
        ]),
        gridSection([
          heading("Capacity and modules", "mdi:battery-multiple"),
          entitiesCard("Reported capacity", entityRows(e, [
            ["batteryBankCapacityPercent", "Capacity percent", "mdi:percent-outline"],
            ["batteryBankRemainingCapacity", "Remaining capacity", "mdi:battery-70"],
            ["batteryBankCurrentCapacity", "Current capacity", "mdi:battery-80"],
            ["batteryBankFullCapacity", "Full capacity", "mdi:battery"],
            ["batteryBankMaxCapacity", "Maximum capacity", "mdi:battery-plus"],
            ["batteryCount", "Modules in the bank", "mdi:battery-multiple"],
            ["batteryBankStatus", "Bank status", "mdi:battery-heart"],
          ])),
          entitiesCard("BMS permissions", entityRows(e, [
            ["bmsChargeAllowed", "Charge allowed", "mdi:battery-arrow-up"],
            ["bmsDischargeAllowed", "Discharge allowed", "mdi:battery-arrow-down"],
            ["bmsForceChargeRequest", "Force-charge requested", "mdi:battery-alert"],
          ]), { stateColor: true }),
        ]),
        gridSection([
          heading("Measured at the inverter", "mdi:current-dc"),
          markdown("Power, voltage, state of charge, and status here are the inverter's own view of the battery's DC terminals, measured independently of what the BMS reports above — a persistent disagreement between the two is itself a signal. Quick charge remaining counts down only while a manual quick charge is running."),
          entitiesCard("Inverter DC side", entityRows(e, [
            ["batteryPower", "Battery power (+ charge / − discharge)", "mdi:battery-charging"],
            ["batteryVoltage", "Battery voltage", "mdi:sine-wave"],
            ["inverterSoc", "State of charge", "mdi:battery-high"],
            ["batteryStatus", "Battery status", "mdi:battery-heart"],
            ["quickChargeRemaining", "Quick charge remaining", "mdi:timer-sand"],
          ])),
        ]),
        gridSection([
          heading("Battery energy", "mdi:counter"),
          ...tiles(e, [
            ["chargingToday", "Charged today", "mdi:battery-arrow-up"],
            ["dischargingToday", "Discharged today", "mdi:battery-arrow-down"],
          ]),
          entitiesCard("Lifetime", entityRows(e, [
            ["chargingLifetime", "Charged", "mdi:battery-arrow-up"],
            ["dischargingLifetime", "Discharged", "mdi:battery-arrow-down"],
          ])),
          historyGraph("Bank state of charge · 7 days", 168, entityRows(e, [["batteryBankSoc", "Bank SOC"]]), 5),
          statisticsGraph("Battery energy · 30 days", entityRows(e, [
            ["chargingLifetime", "Charged"],
            ["dischargingLifetime", "Discharged"],
          ]), { gridRows: 6 }),
        ]),
      ],
    }),

    batteryCellsView(discovery),

    localInverterView(discovery),

    view({
      title: "Grid & AC",
      path: "grid",
      icon: "mdi:transmission-tower",
      badges: badges(e, [
        ["gridPower", "Net grid", "mdi:transmission-tower"],
        ["gridVoltage", "Voltage", "mdi:sine-wave"],
        ["gridFrequency", "Frequency", "mdi:current-ac"],
        ["offGrid", "Off-grid", "mdi:transmission-tower-off"],
      ]),
      sections: [
        gridSection([
          heading("Grid exchange", "mdi:transmission-tower-import"),
          ...tiles(e, [
            ["gridPower", "Net grid power", "mdi:transmission-tower"],
            ["gridImportPower", "Import", "mdi:transmission-tower-import"],
            ["gridExportPower", "Export", "mdi:transmission-tower-export"],
          ]),
          entitiesCard("Grid energy", entityRows(e, [
            ["gridImportToday", "Imported today", "mdi:transmission-tower-import"],
            ["gridImportLifetime", "Imported lifetime", "mdi:counter"],
            ["gridExportToday", "Exported today", "mdi:transmission-tower-export"],
            ["gridExportLifetime", "Exported lifetime", "mdi:counter"],
          ])),
        ]),
        gridSection([
          heading("Grid quality", "mdi:sine-wave"),
          entitiesCard("Service measurements", entityRows(e, [
            ["gridVoltage", "Grid voltage", "mdi:sine-wave"],
            ["gridVoltageR", "Grid voltage R", "mdi:sine-wave"],
            ["gridVoltageS", "Grid voltage S", "mdi:sine-wave"],
            ["gridVoltageT", "Grid voltage T", "mdi:sine-wave"],
            ["gridFrequency", "Grid frequency", "mdi:current-ac"],
            ["gridType", "Grid type", "mdi:transmission-tower"],
            ["powerFactor", "Power factor", "mdi:angle-acute"],
            ["offGrid", "Off-grid", "mdi:transmission-tower-off"],
          ]), { stateColor: true }),
          markdown("This 18KPV is a split-phase unit. The R, S, and T readings exist because the integration publishes a three-phase register set for the whole EG4 family; on a split-phase installation the unused legs report zero rather than going unavailable."),
        ]),
        gridSection([
          heading("AC output and load", "mdi:meter-electric-outline"),
          entitiesCard("AC bus", entityRows(e, [
            ["acPower", "AC power", "mdi:flash"],
            ["acVoltage", "AC voltage", "mdi:sine-wave"],
            ["outputPower", "Output power", "mdi:transmission-tower-export"],
            ["totalLoadPower", "Total load power", "mdi:home-lightning-bolt"],
            ["loadPower", "EG4 metered load", "mdi:meter-electric-outline"],
            ["acCouplePower", "AC couple power", "mdi:flash-outline"],
          ])),
          entitiesCard("Load and consumption energy", entityRows(e, [
            ["loadEnergyToday", "Load energy today", "mdi:home-lightning-bolt"],
            ["loadEnergyLifetime", "Load energy lifetime", "mdi:counter"],
            ["consumptionToday", "EG4 metered consumption today", "mdi:meter-electric-outline"],
            ["consumptionLifetime", "EG4 metered consumption lifetime", "mdi:counter"],
          ])),
          markdown("EG4's **Consumption Power** and its energy counters are derived from this inverter's own AC bus. They are not whole-property load: the separate Enphase array is not accounted for. Use the **Home Energy** dashboard for the corrected whole-home figure."),
        ]),
        gridSection([
          heading("Conversion stage", "mdi:flash-triangle-outline"),
          entitiesCard("Internal power stage", entityRows(e, [
            ["rectifierPower", "Rectifier power", "mdi:current-ac"],
            ["bus1Voltage", "DC bus 1 voltage", "mdi:sine-wave"],
            ["bus2Voltage", "DC bus 2 voltage", "mdi:sine-wave"],
          ])),
          markdown("These are internal to the inverter. Rectifier power is the AC-to-DC path used when charging from grid or generator, and the two bus voltages are its internal DC rails — neither is a grid or battery measurement."),
        ]),
        gridSection([
          heading("Protected loads (EPS)", "mdi:power-plug-battery"),
          entitiesCard("EPS output", entityRows(e, [
            ["epsPower", "EPS power", "mdi:power-plug-battery"],
            ["epsPowerL1", "EPS power L1", "mdi:power-plug-battery-outline"],
            ["epsPowerL2", "EPS power L2", "mdi:power-plug-battery-outline"],
            ["epsVoltage", "EPS voltage", "mdi:sine-wave"],
            ["epsVoltageR", "EPS voltage R", "mdi:sine-wave"],
            ["epsVoltageS", "EPS voltage S", "mdi:sine-wave"],
            ["epsVoltageT", "EPS voltage T", "mdi:sine-wave"],
            ["epsFrequency", "EPS frequency", "mdi:current-ac"],
          ])),
        ]),
        gridSection([
          heading("Generator input", "mdi:engine"),
          entitiesCard("Generator", entityRows(e, [
            ["generatorPower", "Generator power", "mdi:engine"],
            ["generatorVoltage", "Generator voltage", "mdi:sine-wave"],
            ["generatorFrequency", "Generator frequency", "mdi:current-ac"],
          ])),
          markdown("No generator is connected to this installation. The registers still exist, so these read zero rather than unavailable."),
        ]),
      ],
    }),

    view({
      title: "Trends",
      path: "performance",
      icon: "mdi:chart-line",
      sections: [
        gridSection([
          heading("Power and energy", "mdi:flash"),
          historyGraph("Power · 48 hours", 48, entityRows(e, [
            ["pvPower", "Solar"],
            ["loadPower", "EG4 metered load"],
            ["gridImportPower", "Grid import"],
            ["gridExportPower", "Grid export"],
            ["batteryPower", "Battery"],
          ]), 7),
          statisticsGraph("Daily energy · 30 days", entityRows(e, [
            ["yieldLifetime", "Solar generated"],
            ["consumptionLifetime", "EG4 metered consumption"],
            ["gridImportLifetime", "Grid import"],
            ["gridExportLifetime", "Grid export"],
          ])),
        ]),
        gridSection([
          heading("Thermal and grid quality", "mdi:thermometer-lines"),
          historyGraph("Inverter temperature · 72 hours", 72, entityRows(e, [
            ["internalTemperature", "Inverter internal"],
            ["radiator1Temperature", "Inverter radiator 1"],
            ["radiator2Temperature", "Inverter radiator 2"],
          ]), 5),
          historyGraph("Grid voltage and frequency · 24 hours", 24, entityRows(e, [
            ["gridVoltage", "Grid voltage"],
            ["gridFrequency", "Grid frequency"],
          ]), 5),
          historyGraph("Battery bank · 7 days", 168, entityRows(e, [
            ["batteryBankSoc", "Bank SOC"],
            ["batteryBankVoltage", "Bank voltage"],
          ]), 5),
        ]),
      ],
    }),

    view({
      title: "Equipment",
      path: "system",
      icon: "mdi:solar-power-variant-outline",
      badges: badges(e, [
        ["operatingState", "State", "mdi:state-machine"],
        ["transport", "Transport", "mdi:access-point-network"],
        ["internalTemperature", "Inverter temp", "mdi:thermometer"],
      ]),
      sections: [
        gridSection([
          heading("Health and connectivity", "mdi:heart-pulse"),
          unresolvedCard(discovery),
          missingTelemetryCard(e),
          entitiesCard("Connection", entityRows(e, [
            ["cloudStatus", "Cloud status", "mdi:cloud-check"],
            ["connectionLost", "Connection lost", "mdi:lan-disconnect"],
            ["runtimeData", "Runtime data", "mdi:database-check"],
            ["transport", "Transport", "mdi:access-point-network"],
            ["dongleConnectivity", "Dongle connectivity", "mdi:wifi"],
            ["offGrid", "Off-grid", "mdi:transmission-tower-off"],
          ]), { stateColor: true }),
        ]),
        gridSection([
          heading("Inverter temperatures", "mdi:thermometer-lines"),
          inverterTemperatureNote(),
          ...tiles(e, [
            ["internalTemperature", "Inverter internal", "mdi:thermometer"],
            ["radiator1Temperature", "Inverter radiator 1 (heatsink)", "mdi:radiator"],
            ["radiator2Temperature", "Inverter radiator 2 (heatsink)", "mdi:radiator"],
          ]),
        ]),
        gridSection([
          heading("Identity and status", "mdi:identifier"),
          entitiesCard("Inverter", entityRows(e, [
            ["operatingState", "Operating state", "mdi:state-machine"],
            ["statusCode", "Status code", "mdi:identifier"],
            ["inverterFamily", "Inverter family", "mdi:family-tree"],
            ["deviceTypeCode", "Device type code", "mdi:barcode"],
            ["powerRating", "Power rating", "mdi:lightning-bolt-outline"],
          ]), { stateColor: true }),
        ]),
        gridSection([
          heading("Firmware", "mdi:chip"),
          entitiesCard("Reported version", entityRows(e, [["firmwareVersion", "Firmware version", "mdi:chip"]])),
          tile(e, "firmwareUpdate", "Firmware update", "mdi:package-down", "full"),
          markdown("The firmware entity is shown for awareness only. This dashboard never installs anything; a firmware update is performed deliberately from the inverter's own device page."),
        ]),
      ],
    }),

    view({
      title: "Configuration",
      path: "settings",
      icon: "mdi:tune-variant",
      sections: [
        gridSection([
          heading("Configuration entities", "mdi:tune-variant"),
          configurationNote(discovery),
        ]),
        ...configurationValueSections(discovery),
        gridSection([
          heading("Not registered for use", "mdi:eye-off-outline"),
          disabledEntitiesNote(),
        ]),
      ],
    }),

    view({
      title: "Station",
      path: "station",
      icon: "mdi:map-marker-radius",
      badges: badges(e, [
        ["apiRequestRate", "API rate", "mdi:api"],
        ["apiRequestsToday", "Requests today", "mdi:counter"],
      ]),
      sections: [
        gridSection([
          heading("Plant", "mdi:map-marker-radius"),
          entitiesCard("Registration", entityRows(e, [
            ["stationName", "Station name", "mdi:map-marker-radius"],
            ["stationAddress", "Address", "mdi:map-marker"],
            ["stationCountry", "Country", "mdi:earth"],
            ["stationTimezone", "Timezone", "mdi:clock-outline"],
            ["stationCreated", "Created", "mdi:calendar-plus"],
          ])),
        ]),
        gridSection([
          heading("Cloud API budget", "mdi:api"),
          ...tiles(e, [
            ["apiRequestRate", "Request rate", "mdi:api"],
            ["apiPeakRequestRate", "Peak request rate", "mdi:speedometer"],
            ["apiRequestsToday", "Requests today", "mdi:counter"],
          ]),
          historyGraph("Request rate · 24 hours", 24, entityRows(e, [
            ["apiRequestRate", "Requests per hour"],
            ["apiPeakRequestRate", "Peak requests per minute"],
          ]), 5),
          markdown("Every reading on this dashboard arrives over the EG4 cloud API, which is rate limited. These counters are the early warning that polling is too aggressive: a rising peak rate shows up here before readings start going unavailable elsewhere."),
        ]),
      ],
    }),
  ]);

  // The page must exist even if discovery resolved nothing at all, because the report of
  // what is missing is the most useful thing it could show in that state.
  if (!views.length) {
    return {
      views: [{
        title: "Live",
        path: "live",
        icon: "mdi:solar-power",
        type: "sections",
        max_columns: 2,
        dense_section_placement: true,
        sections: [{
          type: "grid",
          cards: compact([
            heading("EG4 telemetry unavailable", "mdi:alert"),
            unresolvedCard(discovery) ?? markdown("Discovery resolved no EG4 entities at all."),
          ]),
        }],
      }],
    };
  }

  return { views };
}

export const dashboardMetadata = Object.freeze({
  urlPath: "eg4-energy",
  title: "EG4 Solar & Battery",
  icon: "mdi:solar-power",
  showInSidebar: true,
  requireAdmin: false,
});
