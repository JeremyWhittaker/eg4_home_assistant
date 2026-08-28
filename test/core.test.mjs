import { readFileSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildDashboard, dashboardMetadata } from "../src/dashboard.mjs";
import { discoveryContract, discoverEg4 } from "../src/discovery.mjs";
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
  assert.ok(!stableString(dashboard).includes('"type":"power-sankey"'));
  assert.ok(!stableString(dashboard).includes('"type":"power-sources-graph"'));
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

  const controlDashboard = buildDashboard(discoverEg4(data));
  controlDashboard.views[0].sections[0].cards.push({ type: "tile", entity: "switch.fixture_control" });
  assert.throws(
    () => validateDashboard(controlDashboard, [...data.states, { entity_id: "switch.fixture_control", state: "off", attributes: {} }]),
    /control entities/,
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
