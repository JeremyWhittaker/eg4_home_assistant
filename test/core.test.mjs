import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboard, dashboardMetadata, withheldEntities } from "../src/dashboard.mjs";
import { LOCAL_PLATFORM, REPORTING_DOMAINS, discoveryContract, discoverEg4, localContract } from "../src/discovery.mjs";
import {
  applyDashboard,
  createBackup,
  collectEntityReferences,
  collectDashboardTemplates,
  loadBackup,
  planDashboard,
  restoreBackup,
  stableString,
  validateDashboard,
  validateDashboardTemplates,
  verifyEnergyPreferences,
} from "../src/deployer.mjs";

const SOURCE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// The live 2026-09-15 registry audit: 165 EG4 entities, 137 of them enabled. The
// dashboard never sees the other 28, because Home Assistant disables them on creation
// and a disabled entity has no state at all.
const ENABLED_ENTITY_COUNT = 137;

// 98 of those only report. The other 39 — 15 `number`, 18 `switch`, 4 `select`, and 2
// `button` — can actuate the inverter, and appear on the page only as inert tiles.
const CONTROL_ENTITY_COUNT = 39;

const DISABLED_ENTITIES = [
  ["inverter", "sensor", "Last Polled"],
  ["battery", "sensor", "Last Polled"],
  ["station", "sensor", "Last Polled"],
  ["inverter", "number", "AC Charge Start Voltage"],
  ["inverter", "number", "AC Charge End Voltage"],
  ["inverter", "number", "On-Grid Cut-Off Voltage"],
  ["inverter", "number", "Off-Grid Cut-Off Voltage"],
  ["inverter", "number", "Stop Discharge Voltage"],
  ["inverter", "number", "System Charge Voltage Limit"],
  ["inverter", "switch", "Share Battery"],
  // A disabled entity that shadows a resolved one, proving resolution filters on the
  // registry flag rather than on the name alone.
  ["inverter", "sensor", "PV Total Power"],
  ...["AC Charge", "Forced Charge", "Forced Discharge"].flatMap((family) =>
    ["Start", "End"].flatMap((edge) =>
      [1, 2, 3].map((slot) => ["inverter", "time", `${family} ${edge} Time ${slot}`]),
    ),
  ),
];

function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// The registry fixture is generated from the discovery contract itself, so it mirrors
// the live installation without any entity id or serial being written down here.
function registryEntities(deviceId, specification, prefix, platform = "eg4_web_monitor") {
  const required = new Map();
  for (const spec of Object.values(specification)) {
    const [domain, originalName, options = {}] = spec;
    const slot = `${domain}|${originalName}`;
    const count = Math.max(required.get(slot)?.count ?? 0, options.of ?? 1);
    required.set(slot, { domain, originalName, count });
  }
  const entities = [];
  for (const { domain, originalName, count } of required.values()) {
    for (let index = 0; index < count; index += 1) {
      entities.push({
        entity_id: `${domain}.${prefix}_${slugify(originalName)}${index ? `_${index + 1}` : ""}`,
        device_id: deviceId,
        disabled_by: null,
        platform,
        original_name: originalName,
      });
    }
  }
  return entities;
}

function fixture({ local = true } = {}) {
  const stationId = "station-device";
  const inverterId = "inverter-device";
  const batteryId = "battery-device";
  const localId = "local-dongle-device";
  const devices = [
    { id: stationId, manufacturer: "EG4 Electronics", model: "Station", name: "Station House Inverter", disabled_by: null },
    { id: inverterId, manufacturer: "EG4 Electronics", model: "18KPV", name: "18KPV fixture", sw_version: "FAAB-TEST", via_device_id: stationId, disabled_by: null },
    { id: batteryId, manufacturer: "EG4 Electronics", model: "18KPV Battery Bank", name: "Battery Bank fixture", via_device_id: inverterId, disabled_by: null },
  ];
  const entities = [
    ...registryEntities(inverterId, discoveryContract.inverter, "inv"),
    ...registryEntities(batteryId, discoveryContract.battery, "bank"),
    ...registryEntities(stationId, discoveryContract.station, "plant"),
  ];
  // The local-dongle integration is a separate platform on its own device. It is present
  // only when local === true, so a test can model a cloud-only installation by omitting it.
  // Its entity ids come out as sensor.eg4_local_<slug>, the deterministic id the sibling
  // integration is contracted to publish, generated here from the contract's own names so
  // no id is written down literally.
  if (local) {
    devices.push({ id: localId, manufacturer: "EG4 Electronics", model: "EG4 18kPV (local dongle)", name: "EG4 18kPV (local dongle)", via_device_id: inverterId, disabled_by: null });
    entities.push(...registryEntities(localId, localContract, "eg4_local", LOCAL_PLATFORM));
  }
  const deviceIds = { inverter: inverterId, battery: batteryId, station: stationId };
  const prefixes = { inverter: "inv", battery: "bank", station: "plant" };
  const disabled = DISABLED_ENTITIES.map(([device, domain, originalName]) => ({
    entity_id: `${domain}.${prefixes[device]}_${slugify(originalName)}_disabled`,
    device_id: deviceIds[device],
    disabled_by: "integration",
    platform: "eg4_web_monitor",
    original_name: originalName,
  }));
  // Disabled entities never reach the state machine, which is exactly why the page
  // cannot show them.
  const states = entities.map((entity) => ({ entity_id: entity.entity_id, state: "1", attributes: {} }));
  return { devices, entities: [...entities, ...disabled], disabled, states, inverterId, batteryId, stationId, localId };
}

function contractSize() {
  return Object.values(discoveryContract)
    .reduce((total, specification) => total + Object.keys(specification).length, 0);
}

// Every place the config binds a name to an entity: tiles, badges, and the rows of an
// entities, history-graph, or statistics-graph card all use the same two keys.
function collectEntityLabels(value, labels = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectEntityLabels(child, labels);
    return labels;
  }
  if (!value || typeof value !== "object") return labels;
  if (typeof value.entity === "string") {
    labels.push({ entity: value.entity, name: typeof value.name === "string" ? value.name : null });
  }
  for (const child of Object.values(value)) collectEntityLabels(child, labels);
  return labels;
}

function collectActions(value, actions = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectActions(child, actions);
    return actions;
  }
  if (!value || typeof value !== "object") return actions;
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith("_action") && child && typeof child === "object" && typeof child.action === "string") {
      actions.push(child.action);
    }
    collectActions(child, actions);
  }
  return actions;
}

function collectCards(value, cards = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectCards(child, cards);
    return cards;
  }
  if (!value || typeof value !== "object") return cards;
  if (typeof value.type === "string") cards.push(value);
  for (const child of Object.values(value)) collectCards(child, cards);
  return cards;
}

// The only card shape in which the page may name a control entity: a tile with no
// `features` — the key that would mount a toggle, slider, or dropdown — and all three
// interactions pinned, so neither the card nor its icon can send a command.
function assertInertTile(card, label) {
  assert.equal(card.type, "tile", `${label} is not a tile`);
  assert.ok(!("features" in card), `${label} carries features and can actuate`);
  assert.deepEqual(card.tap_action, { action: "more-info" }, `${label} is tappable`);
  assert.deepEqual(card.hold_action, { action: "none" }, `${label} responds to hold`);
  assert.deepEqual(card.icon_tap_action, { action: "more-info" }, `${label} icon is tappable`);
}

function countMentions(text, entityId) {
  // Whole-token, so a shorter id is not counted inside a longer one that extends it.
  return (text.match(new RegExp(`\\b${entityId.replace(/\./g, "\\.")}\\b`, "g")) ?? []).length;
}

function sourceFiles() {
  return readdirSync(SOURCE_DIRECTORY)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => ({ name, text: readFileSync(join(SOURCE_DIRECTORY, name), "utf8") }));
}

test("discovers the station, inverter, and battery bank and resolves the whole contract", () => {
  const data = fixture();
  const discovered = discoverEg4(data);
  assert.equal(discovered.inverter.deviceId, data.inverterId);
  assert.equal(discovered.battery.deviceId, data.batteryId);
  assert.equal(discovered.station.deviceId, data.stationId);
  assert.deepEqual(discovered.unresolved, []);
  assert.equal(Object.keys(discovered.entities).length, contractSize());
  assert.equal(new Set(Object.values(discovered.entities)).size, contractSize());
  // Guards the live audit figure: the contract is meant to cover every enabled entity
  // the integration publishes, so a silent shrink is a regression.
  assert.equal(contractSize(), ENABLED_ENTITY_COUNT);
});

test("identically named switches resolve to distinct, stably ordered entities", () => {
  const discovered = discoverEg4(fixture());
  const pairs = [
    ["acChargeMode", "acChargeModeSecondary"],
    ["batteryBackupMode", "batteryBackupModeSecondary"],
    ["forcedDischargeMode", "forcedDischargeModeSecondary"],
    ["gridPeakShavingMode", "gridPeakShavingModeSecondary"],
    ["pvChargePriorityMode", "pvChargePriorityModeSecondary"],
  ];
  for (const [first, second] of pairs) {
    const left = discovered.entities[first];
    const right = discovered.entities[second];
    assert.ok(left && right, `${first} and ${second} must both resolve`);
    assert.notEqual(left, right);
    assert.ok(left < right, "the lower-indexed key must take the lower sorted entity id");
  }
});

test("discovery refuses an ambiguous inverter but tolerates a single missing entity", () => {
  const ambiguous = fixture();
  ambiguous.devices.push({ id: "second", manufacturer: "EG4 Electronics", model: "18KPV", disabled_by: null });
  ambiguous.entities.push({ entity_id: "sensor.second_status", device_id: "second", platform: "eg4_web_monitor", original_name: "Cloud Status", disabled_by: null });
  assert.throws(() => discoverEg4(ambiguous), /exactly one enabled EG4 inverter/);

  const missing = fixture();
  const dropped = discoverEg4(fixture()).entities.radiator2Temperature;
  missing.states = missing.states.filter((state) => state.entity_id !== dropped);
  const discovered = discoverEg4(missing);
  assert.equal(discovered.entities.radiator2Temperature, undefined);
  assert.equal(discovered.unresolved.length, 1);
  assert.equal(discovered.unresolved[0].originalName, "Radiator 2 Temperature");
  assert.match(discovered.unresolved[0].reason, /absent from live state/);
  assert.equal(Object.keys(discovered.entities).length, contractSize() - 1);
});

test("a dropped battery bank device leaves the rest of the page intact", () => {
  const data = fixture();
  data.devices = data.devices.filter((device) => device.id !== data.batteryId);
  const discovered = discoverEg4(data);
  assert.equal(discovered.battery, null);
  assert.equal(discovered.unresolved.length, Object.keys(discoveryContract.battery).length);
  assert.ok(discovered.unresolved.every((item) => /device was not found/.test(item.reason)));
  const dashboard = buildDashboard(discovered);
  assert.ok(dashboard.views.length > 1);
  assert.ok(!stableString(dashboard).includes("undefined"));
  validateDashboard(dashboard, data.states);
});

test("every enabled EG4 entity is rendered on the dashboard and nothing is withheld", (t) => {
  const data = fixture();
  const discovery = discoverEg4(data);
  const dashboard = buildDashboard(discovery);
  const references = collectEntityReferences(dashboard);

  const resolved = Object.entries(discovery.entities);
  assert.equal(resolved.length, ENABLED_ENTITY_COUNT, "discovery must resolve the whole contract");
  const unrendered = resolved.filter(([, entityId]) => !references.has(entityId)).map(([key]) => key);
  assert.deepEqual(unrendered, [], "every resolved entity must be referenced by some card");

  // The local dongle resolves its whole contract too, and every local entity is on a card.
  const localResolved = Object.entries(discovery.local.entities);
  assert.equal(localResolved.length, Object.keys(localContract).length, "the local contract must resolve fully");
  const localUnrendered = localResolved.filter(([, entityId]) => !references.has(entityId)).map(([key]) => key);
  assert.deepEqual(localUnrendered, [], "every resolved local entity must be referenced by some card");

  // Nothing is held back any more, cloud or local. The reporting domains are laid out
  // across the telemetry views; the control domains carry their values on the Configuration
  // view; the local sensors fill the Battery Cells and Local Inverter views.
  assert.deepEqual(withheldEntities(discovery).keys, [], "the page renders every entity it resolves");

  // Nothing is referenced that discovery did not resolve, across both sources.
  const resolvedIds = new Set([...Object.values(discovery.entities), ...Object.values(discovery.local.entities)]);
  assert.deepEqual([...references].filter((entityId) => !resolvedIds.has(entityId)), []);

  const controls = Object.values(discovery.catalog).filter((item) => !REPORTING_DOMAINS.has(item.domain));
  assert.equal(controls.length, CONTROL_ENTITY_COUNT);
  t.diagnostic(`entities cloud=${resolved.length} local=${localResolved.length} rendered=${resolved.length - unrendered.length + localResolved.length - localUnrendered.length} withheld=0 control=${controls.length}`);
});

test("every configuration entity shows its value on an inert tile", () => {
  const discovery = discoverEg4(fixture());
  const dashboard = buildDashboard(discovery);
  const references = collectEntityReferences(dashboard);
  const controls = Object.values(discovery.catalog).filter((item) => !REPORTING_DOMAINS.has(item.domain));
  assert.equal(controls.length, CONTROL_ENTITY_COUNT);

  const configuration = dashboard.views.find((candidate) => candidate.path === "settings");
  const tilesByEntity = new Map(
    collectCards(configuration).filter((card) => card.type === "tile").map((card) => [card.entity, card]),
  );
  for (const item of controls) {
    assert.ok(references.has(item.entityId), `${item.originalName} resolved but no card shows its value`);
    const card = tilesByEntity.get(item.entityId);
    assert.ok(card, `${item.originalName} has no tile on the Configuration view`);
    assert.ok(card.name.includes(item.originalName), `the ${item.originalName} tile is not named after the entity`);
    assertInertTile(card, `the ${item.originalName} tile`);
  }

  // The five twice-published mode switches stay told apart by name.
  const duplicated = controls.filter((item) => item.instances);
  assert.equal(duplicated.length, 10);
  for (const item of duplicated) {
    assert.ok(tilesByEntity.get(item.entityId).name.endsWith(`(${item.instance} of ${item.instances})`));
  }
});

test("every control-domain reference in the config is the entity of an inert tile", () => {
  const dashboard = buildDashboard(discoverEg4(fixture()));
  const rendered = stableString(dashboard);
  const cards = collectCards(dashboard);
  const controlIds = [...collectEntityReferences(dashboard)]
    .filter((entityId) => !REPORTING_DOMAINS.has(entityId.split(".", 1)[0]));
  assert.equal(controlIds.length, CONTROL_ENTITY_COUNT);

  for (const entityId of controlIds) {
    const holders = cards.filter((card) => card.entity === entityId);
    assert.equal(holders.length, 1, `${entityId} is bound by ${holders.length} cards`);
    assertInertTile(holders[0], entityId);
    // And it is named nowhere else in the configuration: the single textual occurrence
    // is the tile's own entity field.
    assert.equal(countMentions(rendered, entityId), 1, `${entityId} is named outside its tile`);
  }
});

test("no disabled entity is resolved or referenced", () => {
  const data = fixture();
  const discovery = discoverEg4(data);
  const references = collectEntityReferences(buildDashboard(discovery));
  const resolved = new Set(Object.values(discovery.entities));
  assert.ok(data.disabled.length > 0);
  for (const entity of data.disabled) {
    assert.ok(!resolved.has(entity.entity_id), `${entity.original_name} is disabled and must not resolve`);
    assert.ok(!references.has(entity.entity_id), `${entity.original_name} is disabled and must not be referenced`);
  }
  // The disabled decoy shares a name with a resolved entity; the enabled one still wins.
  assert.ok(resolved.has(discovery.entities.pvPower));
});

test("no inverter serial or entity id literal is written into src/", () => {
  const files = sourceFiles();
  assert.ok(files.length >= 4);
  for (const file of files) {
    const serialLike = file.text.match(/\b\d{6,}\b/g);
    assert.equal(serialLike, null, `${file.name} contains a serial-like literal: ${serialLike}`);
    const entityLike = file.text.match(/\b(?:sensor|binary_sensor|switch|number|select|button|time|update)\.[a-z0-9_]{2,}\b/g);
    assert.equal(entityLike, null, `${file.name} hardcodes an entity id: ${entityLike}`);
  }
});

test("dashboard is native-only, read-only, responsive, and references live entities", () => {
  const data = fixture();
  const discovery = discoverEg4(data);
  const dashboard = buildDashboard(discovery);
  const result = validateDashboard(dashboard, data.states);
  assert.deepEqual(
    dashboard.views.map((view) => view.path),
    ["live", "energy", "solar", "battery", "cells", "local", "grid", "performance", "system", "settings", "station"],
  );
  assert.ok(dashboard.views.every((view) => view.type === "sections"));
  assert.ok(dashboard.views.every((view) => view.sections.length > 0));
  assert.ok(dashboard.views.every((view) => view.sections.every((section) => section.cards.length > 0)));
  assert.ok(!stableString(dashboard).includes("custom:"));
  assert.ok(!stableString(dashboard).includes("undefined"));
  assert.ok(stableString(dashboard).includes('"type":"energy-sankey"'));
  assert.ok(stableString(dashboard).includes('"type":"distribution"'));
  assert.ok(result.references.length > 90);
  assert.equal(collectEntityReferences(dashboard).size, result.references.length);

  // Every card placed in a section declares its own width, so the layout is defined on
  // phone and desktop rather than inherited. Headings span the section by definition.
  for (const view of dashboard.views) {
    for (const section of view.sections) {
      for (const card of section.cards) {
        if (card.type === "heading") continue;
        assert.ok(card.grid_options, `${card.type} card on ${view.path} is missing grid_options`);
      }
    }
  }
});

test("the page cannot actuate anything it shows", () => {
  const dashboard = buildDashboard(discoverEg4(fixture()));
  const allowed = new Set(["more-info", "none"]);
  const actions = collectActions(dashboard);
  assert.ok(actions.length > 0);
  for (const action of actions) assert.ok(allowed.has(action), `action ${action} can mutate`);

  // Every card that binds directly to an entity neutralises all three interactions.
  for (const card of collectCards(dashboard)) {
    if (card.type !== "tile" && card.type !== "entity") continue;
    assert.deepEqual(card.tap_action, { action: "more-info" }, `${card.type} card is tappable`);
    assert.deepEqual(card.hold_action, { action: "none" }, `${card.type} card responds to hold`);
    assert.deepEqual(card.icon_tap_action, { action: "more-info" }, `${card.type} card icon is tappable`);
  }
});

test("an unresolved entity is reported on the page instead of vanishing", () => {
  const data = fixture();
  const dropped = discoverEg4(fixture()).entities.epsVoltageT;
  data.entities = data.entities.filter((entity) => entity.entity_id !== dropped);
  data.states = data.states.filter((state) => state.entity_id !== dropped);
  const discovery = discoverEg4(data);
  const dashboard = buildDashboard(discovery);

  assert.equal(discovery.entities.epsVoltageT, undefined);
  assert.equal(discovery.unresolved.length, 1);
  const rendered = stableString(dashboard);
  assert.ok(rendered.includes("EPS Voltage T"), "the missing entity must be named on the page");
  assert.ok(rendered.includes("did not find"), "the missing-telemetry report must be present");
  assert.ok(!rendered.includes("undefined"));
  // The report itself must stay deployable: it names entities, it never references them.
  validateDashboard(dashboard, data.states);
});

test("the three temperatures are presented as inverter temperatures, never battery ones", () => {
  const discovery = discoverEg4(fixture());
  const dashboard = buildDashboard(discovery);
  const temperatures = [
    discovery.entities.internalTemperature,
    discovery.entities.radiator1Temperature,
    discovery.entities.radiator2Temperature,
  ];
  const labels = collectEntityLabels(dashboard).filter((label) => temperatures.includes(label.entity) && label.name);
  assert.equal(labels.length >= temperatures.length, true);
  for (const label of labels) {
    assert.match(label.name, /inverter/i, `"${label.name}" does not say the reading is the inverter's`);
    assert.doesNotMatch(label.name, /batter/i, `"${label.name}" implies a battery reading`);
  }
  const rendered = stableString(dashboard);
  assert.doesNotMatch(rendered, /battery temperature/i);
  assert.ok(rendered.includes("not one per battery module"));
});

test("the battery view states plainly that two modules are reported as one bank", () => {
  const dashboard = buildDashboard(discoverEg4(fixture()));
  const battery = stableString(dashboard.views.find((view) => view.path === "battery"));
  assert.ok(battery.includes("Battery Count"));
  assert.ok(battery.includes("aggregates both modules into one bank"));
  assert.ok(battery.includes("no per-battery entities"));
  assert.ok(battery.includes("local Modbus dongle transport"));
});

test("the local dongle contract resolves and fills the Battery Cells and Local Inverter views", () => {
  const data = fixture();
  const discovery = discoverEg4(data);
  assert.ok(discovery.local.device, "the local dongle device must be discovered");
  assert.equal(discovery.local.device.deviceId, data.localId);
  assert.equal(discovery.local.available, true);
  assert.equal(Object.keys(discovery.local.entities).length, Object.keys(localContract).length);
  assert.deepEqual([...discovery.local.unresolved], []);

  const dashboard = buildDashboard(discovery);
  const paths = dashboard.views.map((view) => view.path);
  assert.ok(paths.includes("cells"), "the Battery Cells view is present");
  assert.ok(paths.includes("local"), "the Local Inverter view is present");

  const cells = dashboard.views.find((view) => view.path === "cells");
  // The headline is a gauge bound to the cell voltage delta.
  const gauge = collectCards(cells).find((card) => card.type === "gauge");
  assert.ok(gauge, "the cells view must carry a gauge");
  assert.equal(gauge.entity, discovery.local.entities.cellVoltageDelta);

  const cellsText = stableString(cells);
  assert.ok(cellsText.includes("Cloud and local, side by side"), "the cloud-vs-local header must be present");
  assert.ok(cellsText.includes("eg4_local"), "the local integration is named");
  assert.ok(cellsText.includes("the data the cloud hides"), "the page frames the local data as what the cloud hides");
  assert.ok(cellsText.includes("Local dongle: connected"));

  // The whole thing validates against live state, local references included.
  const result = validateDashboard(dashboard, data.states);
  assert.ok(result.references.includes(discovery.local.entities.cellVoltageDelta));
});

test("the dashboard builds cloud-only when the local dongle is absent", () => {
  const data = fixture({ local: false });
  const discovery = discoverEg4(data);
  assert.equal(discovery.local.device, null);
  assert.equal(discovery.local.available, false);
  assert.equal(Object.keys(discovery.local.entities).length, 0);
  assert.equal(discovery.local.unresolved.length, Object.keys(localContract).length);
  assert.ok(discovery.local.unresolved.every((item) => item.source === "local"));
  assert.ok(discovery.local.unresolved.every((item) => /local dongle device was not found/.test(item.reason)));
  // The cloud "did not find" report is not polluted by the local integration being absent.
  assert.deepEqual([...discovery.unresolved], []);

  const dashboard = buildDashboard(discovery);
  const paths = dashboard.views.map((view) => view.path);
  assert.deepEqual(
    paths,
    ["live", "energy", "solar", "battery", "cells", "grid", "performance", "system", "settings", "station"],
    "the Local Inverter view drops but the cloud page and the Battery Cells explainer stay",
  );

  const cells = stableString(dashboard.views.find((view) => view.path === "cells"));
  assert.ok(cells.includes("Cloud and local, side by side"));
  assert.ok(cells.includes("Local dongle: not detected"));

  const references = collectEntityReferences(dashboard);
  assert.ok(![...references].some((entityId) => entityId.startsWith("sensor.eg4_local_")), "no local entity is referenced when the dongle is absent");
  assert.ok(!stableString(dashboard).includes("undefined"));
  validateDashboard(dashboard, data.states);
});

test("provisional local BMS fields are labelled provisional and no battery-temperature claim is made", () => {
  const discovery = discoverEg4(fixture());
  const dashboard = buildDashboard(discovery);
  const labels = collectEntityLabels(dashboard);
  const provisionalKeys = Object.entries(localContract)
    .filter(([, spec]) => spec[2]?.provisional)
    .map(([key]) => key);
  assert.ok(provisionalKeys.length >= 7, "the contract carries several provisional local fields");
  for (const key of provisionalKeys) {
    const entityId = discovery.local.entities[key];
    const named = labels.filter((label) => label.entity === entityId && label.name);
    assert.ok(named.length > 0, `${key} must be named on some card`);
    assert.ok(named.some((label) => /provisional/i.test(label.name)), `${key} must be labelled provisional`);
  }
  // The untrustworthy inverter-side probe (reg67) is not in the contract, and nothing on
  // the page asserts a battery temperature.
  assert.equal(discovery.local.entities.batteryTemp, undefined);
  assert.doesNotMatch(stableString(dashboard), /battery temperature/i);
});

test("every dashboard LOCAL_ENTITIES original name is published by the eg4_local integration", () => {
  // Cross-contract guard. The dashboard resolves each local entity by its original_name,
  // which — with the integration's _attr_has_entity_name=True — equals the SensorSpec
  // `name` string in custom_components/eg4_local/entity_descriptions.py. If the sibling
  // integration renames or drops a spec the dashboard wants, that field silently fails to
  // resolve on a live system (exactly the drift this guard exists to catch). We assert the
  // set of dashboard original names is a SUBSET of the integration's published names, so
  // the integration may carry extras (e.g. reg67 probe) but must never be missing one the
  // dashboard depends on. Comparison is normalized (trim + lowercase) to mirror the
  // resolver in discovery.mjs, which matches on normalize(original_name).
  const specPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "custom_components",
    "eg4_local",
    "entity_descriptions.py",
  );
  const source = readFileSync(specPath, "utf8");
  const norm = (value) => String(value).trim().toLowerCase();

  // Capture the second string literal of every SensorSpec("<key>", "<name>", ...) call —
  // that second literal is the entity name the integration publishes.
  const integrationNames = new Set();
  const specPattern = /SensorSpec\(\s*"(?:[^"\\]|\\.)*"\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  for (let match; (match = specPattern.exec(source)); ) {
    integrationNames.add(norm(match[1]));
  }
  assert.ok(
    integrationNames.size >= 40,
    `expected to parse the integration's SensorSpec names, found only ${integrationNames.size} — the regex or file path is wrong`,
  );

  const dashboardNames = Object.values(localContract).map(([, originalName]) => originalName);
  const missing = dashboardNames.filter((originalName) => !integrationNames.has(norm(originalName)));
  assert.deepEqual(
    missing,
    [],
    `these dashboard LOCAL_ENTITIES original names have no matching eg4_local SensorSpec name (the integration would not publish them, so the dashboard cannot resolve them): ${missing.join(", ")}`,
  );
});

test("dashboard validation rejects missing entities and mutating actions", () => {
  const data = fixture();
  const discovery = discoverEg4(data);
  const dashboard = buildDashboard(discovery);
  assert.throws(
    () => validateDashboard(dashboard, data.states.filter((state) => state.entity_id !== discovery.entities.pvPower)),
    /missing live entities/,
  );
  dashboard.views[0].sections[0].cards.push({ type: "tile", entity: discovery.entities.pvPower, tap_action: { action: "toggle" } });
  assert.throws(() => validateDashboard(dashboard, data.states), /mutating action/);

  const controlDashboard = buildDashboard(discovery);
  controlDashboard.views[0].sections[0].cards.push({ type: "tile", entity: "switch.fixture_control" });
  assert.throws(
    () => validateDashboard(controlDashboard, [...data.states, { entity_id: "switch.fixture_control", state: "off", attributes: {} }]),
    /control entities/,
  );
});

test("validateDashboard admits an inert control tile and rejects every other shape", () => {
  // Cloud-only, so the reference counts below are exactly the 137 cloud entities plus the
  // one extra control this test injects — the local sensors are exercised elsewhere.
  const data = fixture({ local: false });
  const discovery = discoverEg4(data);
  // A control entity that is not part of the contract, so each case below is the only
  // thing under test rather than a variation on the 39 tiles the page already carries.
  const control = "switch.fixture_control";
  const states = [...data.states, { entity_id: control, state: "off", attributes: {} }];
  const inertTile = () => ({
    type: "tile",
    entity: control,
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    icon_tap_action: { action: "more-info" },
  });
  const withCards = (...cards) => {
    const dashboard = buildDashboard(discovery);
    dashboard.views[0].sections[0].cards.push(...cards);
    return dashboard;
  };

  // The real generated configuration: 137 references, 39 of them control entities on
  // inert tiles, and it validates.
  const accepted = validateDashboard(buildDashboard(discovery), data.states);
  assert.equal(accepted.references.length, ENABLED_ENTITY_COUNT);

  // The inert shape itself is admitted.
  assert.equal(validateDashboard(withCards(inertTile()), states).references.length, ENABLED_ENTITY_COUNT + 1);

  // A control entity on anything but a tile.
  assert.throws(
    () => validateDashboard(withCards({ type: "entities", entities: [{ entity: control }] }), states),
    /only as the entity of an inert tile/,
  );
  // A tile that carries features is a live control whatever its actions say. (The card
  // allowlist would also reject the feature; the control rule runs first and names it.)
  assert.throws(
    () => validateDashboard(withCards({ ...inertTile(), features: [{ type: "toggle" }] }), states),
    /only as the entity of an inert tile/,
  );
  // An unpinned icon tap is a toggle on a toggleable domain, even though nothing in the
  // card says so.
  assert.throws(
    () => validateDashboard(withCards({ type: "tile", entity: control, tap_action: { action: "more-info" }, hold_action: { action: "none" } }), states),
    /only as the entity of an inert tile/,
  );
  // A good tile does not launder a second mention somewhere else.
  assert.throws(
    () => validateDashboard(withCards(inertTile(), { type: "markdown", content: `Set ${control} on the device page.` }), states),
    /only as the entity of an inert tile/,
  );
  assert.throws(
    () => validateDashboard(withCards(inertTile(), { type: "entities", entities: [{ entity: control }] }), states),
    /only as the entity of an inert tile/,
  );
});

test("dashboard templates are discovered and rendered through Home Assistant", async () => {
  const dashboard = buildDashboard(discoverEg4(fixture()));
  const templates = collectDashboardTemplates(dashboard);
  assert.equal(templates.length, 1);
  assert.ok(templates[0].includes("soc_raw | float"));
  const calls = [];
  const client = {
    async request(path, options) {
      calls.push({ path, options });
      return "rendered";
    },
  };
  assert.deepEqual(await validateDashboardTemplates(client, dashboard), { templateCount: 1 });
  assert.equal(calls[0].path, "/api/template");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.responseType, "text");
});

test("Energy preferences must use the selected EG4 lifetime counters", () => {
  const data = fixture();
  const e = discoverEg4(data).entities;
  const preferences = {
    energy_sources: [
      { type: "grid", stat_energy_from: e.gridImportLifetime, stat_energy_to: e.gridExportLifetime },
      { type: "solar", stat_energy_from: e.yieldLifetime },
      { type: "battery", stat_energy_from: e.dischargingLifetime, stat_energy_to: e.chargingLifetime },
    ],
  };
  assert.deepEqual(verifyEnergyPreferences(preferences, e).sourceTypes, ["grid", "solar", "battery"]);
  preferences.energy_sources.pop();
  assert.throws(() => verifyEnergyPreferences(preferences, e), /missing battery source/);
});

class FakeWs {
  constructor({ failOn } = {}) {
    this.calls = [];
    this.failOn = failOn;
    this.failed = false;
  }
  async call(command) {
    this.calls.push(structuredClone(command));
    if (this.failOn && command.type === this.failOn && !this.failed) {
      this.failed = true;
      throw new Error("injected failure");
    }
    if (command.type === "lovelace/dashboards/create") return { id: "eg4_energy" };
    return null;
  }
}

test("deployment creates, updates, skips unchanged, and rolls back a failed create", async () => {
  const metadata = dashboardMetadata;
  const candidate = { views: [{ title: "Live", path: "live" }] };
  assert.equal(planDashboard({ existing: null, existingConfig: null, candidate, metadata }).action, "create");

  const createWs = new FakeWs();
  const created = await applyDashboard({ ws: createWs, existing: null, existingConfig: null, candidate, metadata });
  assert.equal(created.dashboardId, "eg4_energy");
  assert.deepEqual(createWs.calls.map((call) => call.type), ["lovelace/dashboards/create", "lovelace/config/save"]);

  const existing = { id: "eg4_energy", url_path: metadata.urlPath, mode: "storage", title: metadata.title, icon: metadata.icon, show_in_sidebar: true, require_admin: false };
  const unchanged = await applyDashboard({ ws: new FakeWs(), existing, existingConfig: candidate, candidate, metadata });
  assert.equal(unchanged.action, "unchanged");

  const updateWs = new FakeWs();
  await applyDashboard({ ws: updateWs, existing, existingConfig: { views: [] }, candidate, metadata });
  assert.deepEqual(updateWs.calls.map((call) => call.type), ["lovelace/config/save"]);

  const failing = new FakeWs({ failOn: "lovelace/config/save" });
  await assert.rejects(
    applyDashboard({ ws: failing, existing: null, existingConfig: null, candidate, metadata }),
    /automatic rollback completed/,
  );
  assert.deepEqual(failing.calls.map((call) => call.type), ["lovelace/dashboards/create", "lovelace/config/save", "lovelace/dashboards/delete"]);
});

test("post-save verification failure rolls back an existing dashboard", async () => {
  const metadata = dashboardMetadata;
  const previous = { views: [{ title: "Previous", path: "previous" }] };
  const candidate = { views: [{ title: "Live", path: "live" }] };
  const existing = {
    id: "eg4_energy",
    url_path: metadata.urlPath,
    mode: "storage",
    title: "Old title",
    icon: "mdi:old",
    show_in_sidebar: false,
    require_admin: true,
  };
  const ws = new FakeWs();
  await assert.rejects(
    applyDashboard({
      ws,
      existing,
      existingConfig: previous,
      candidate,
      metadata,
      verify: async () => { throw new Error("round-trip mismatch"); },
    }),
    /automatic rollback completed/,
  );
  assert.deepEqual(ws.calls.map((call) => call.type), [
    "lovelace/config/save",
    "lovelace/dashboards/update",
    "lovelace/config/save",
    "lovelace/dashboards/update",
  ]);
  assert.deepEqual(ws.calls[2].config, previous);
  assert.equal(ws.calls[3].title, "Old title");
});

test("backup is private, checksummed, token-free, and restore refuses drift", async () => {
  const candidate = { views: [{ title: "Live", path: "live" }] };
  const created = createBackup({
    baseUrl: "https://ha.invalid",
    haVersion: "2026.8.3",
    metadata: dashboardMetadata,
    existing: null,
    existingConfig: null,
    candidate,
  });
  try {
    assert.equal(statSync(created.path).mode & 0o777, 0o600);
    assert.ok(!readFileSync(created.path, "utf8").includes("super-secret-token"));
    const backup = loadBackup(created.path);
    const driftedWs = {
      async call(command) {
        if (command.type === "lovelace/dashboards/list") {
          return [{ id: "eg4_energy", url_path: backup.dashboard_path, mode: "storage", ...backup.deployed.metadata }];
        }
        if (command.type === "lovelace/config") return { views: [{ title: "Operator edit", path: "edited" }] };
        throw new Error(`unexpected command ${command.type}`);
      },
    };
    await assert.rejects(restoreBackup({ ws: driftedWs, backup }), /has drifted/);
  } finally {
    rmSync(dirname(created.path), { recursive: true, force: true });
  }
});

test("same-path YAML dashboard is rejected before mutation", () => {
  assert.throws(
    () => planDashboard({
      existing: { url_path: dashboardMetadata.urlPath, mode: "yaml" },
      existingConfig: null,
      candidate: { views: [] },
      metadata: dashboardMetadata,
    }),
    /refusing to replace/,
  );
});
