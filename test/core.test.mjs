import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboard, dashboardMetadata } from "../src/dashboard.mjs";
import { discoveryContract, discoverEg4 } from "../src/discovery.mjs";
import {
  applyDashboard,
  collectEntityReferences,
  planDashboard,
  stableString,
  validateDashboard,
  verifyEnergyPreferences,
} from "../src/deployer.mjs";

function fixture() {
  const inverterId = "inverter-device";
  const batteryId = "battery-device";
  const devices = [
    { id: "station", manufacturer: "EG4 Electronics", model: "Station", disabled_by: null },
    { id: inverterId, manufacturer: "EG4 Electronics", model: "18KPV", name: "18KPV 1234567890", sw_version: "FAAB-TEST", disabled_by: null },
    { id: batteryId, manufacturer: "EG4 Electronics", model: "18KPV Battery Bank", name: "Battery Bank 1234567890", via_device_id: inverterId, disabled_by: null },
  ];
  const entities = [];
  let sequence = 0;
  for (const [deviceId, specification] of [[inverterId, discoveryContract.inverter], [batteryId, discoveryContract.battery]]) {
    for (const [key, [domain, originalName]] of Object.entries(specification)) {
      sequence += 1;
      entities.push({
        entity_id: `${domain}.fixture_${String(sequence).padStart(3, "0")}_${key.toLowerCase()}`,
        device_id: deviceId,
        disabled_by: null,
        platform: "eg4_web_monitor",
        original_name: originalName,
      });
    }
  }
  const states = entities.map((entity) => ({ entity_id: entity.entity_id, state: "1", attributes: {} }));
  return { devices, entities, states, inverterId, batteryId };
}

test("discovers exactly one inverter, linked battery, and the semantic entity map", () => {
  const data = fixture();
  const discovered = discoverEg4(data);
  assert.equal(discovered.inverter.deviceId, data.inverterId);
  assert.equal(discovered.battery.deviceId, data.batteryId);
  assert.equal(Object.keys(discovered.entities).length, Object.keys(discoveryContract.inverter).length + Object.keys(discoveryContract.battery).length);
});

test("discovery refuses ambiguity and missing live state", () => {
  const ambiguous = fixture();
  ambiguous.devices.push({ id: "second", manufacturer: "EG4 Electronics", model: "18KPV", disabled_by: null });
  ambiguous.entities.push({ entity_id: "sensor.second_status", device_id: "second", platform: "eg4_web_monitor", original_name: "Cloud Status", disabled_by: null });
  assert.throws(() => discoverEg4(ambiguous), /exactly one enabled EG4 inverter/);

  const missing = fixture();
  missing.states.shift();
  assert.throws(() => discoverEg4(missing), /absent from live state/);
});

test("dashboard is native-only, monitoring-only, responsive, and references live entities", () => {
  const data = fixture();
  const discovery = discoverEg4(data);
  const dashboard = buildDashboard(discovery);
  const result = validateDashboard(dashboard, data.states);
  assert.deepEqual(dashboard.views.map((view) => view.path), ["live", "energy", "performance", "system"]);
  assert.ok(dashboard.views.every((view) => view.type === "sections"));
  assert.ok(stableString(dashboard).includes('"type":"power-sankey"'));
  assert.ok(stableString(dashboard).includes('"type":"energy-sankey"'));
  assert.ok(stableString(dashboard).includes('"type":"distribution"'));
  assert.ok(!stableString(dashboard).includes("custom:"));
  assert.ok(!stableString(dashboard).includes('"action":"toggle"'));
  assert.ok(result.references.length > 40);
  assert.equal(collectEntityReferences(dashboard).size, result.references.length);
});

test("dashboard validation rejects missing entities and mutating actions", () => {
  const data = fixture();
  const dashboard = buildDashboard(discoverEg4(data));
  assert.throws(() => validateDashboard(dashboard, data.states.slice(1)), /missing live entities/);
  dashboard.views[0].sections[0].cards.push({ type: "tile", entity: data.states[0].entity_id, tap_action: { action: "toggle" } });
  assert.throws(() => validateDashboard(dashboard, data.states), /mutating action/);
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
  }
  async call(command) {
    this.calls.push(structuredClone(command));
    if (this.failOn && command.type === this.failOn) throw new Error("injected failure");
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

