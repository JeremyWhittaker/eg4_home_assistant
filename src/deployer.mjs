import { createHash } from "node:crypto";
import { mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALLOWED_TYPES = new Set([
  "sections", "grid", "heading", "markdown", "tile", "gauge", "history-graph",
  "statistics-graph", "distribution", "entities", "entity-filter", "entity",
  "power-sankey", "power-sources-graph", "energy-date-selection", "energy-distribution",
  "energy-grid-balance", "energy-self-sufficiency-gauge", "energy-solar-consumed-gauge",
  "energy-usage-graph", "energy-solar-graph", "energy-sources-table", "energy-sankey",
]);
const ENTITY_REFERENCE_PATTERN = /\b(?:binary_sensor|sensor)\.[a-z0-9_]+\b/g;
const CONTROL_DOMAINS = new Set(["automation", "button", "input_boolean", "input_button", "input_datetime", "input_number", "input_select", "input_text", "number", "script", "select", "switch", "time"]);
const WRITE_ACTIONS = new Set(["call-service", "perform-action", "toggle"]);
const METADATA_FIELDS = ["title", "icon", "show_in_sidebar", "require_admin"];

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableString(value) {
  return JSON.stringify(stableValue(value));
}

export function checksum(value) {
  return createHash("sha256").update(stableString(value)).digest("hex");
}

export function collectEntityReferences(value, references = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(ENTITY_REFERENCE_PATTERN)) references.add(match[0]);
  } else if (Array.isArray(value)) {
    for (const child of value) collectEntityReferences(child, references);
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectEntityReferences(child, references);
  }
  return references;
}

export function validateDashboard(config, liveStates) {
  if (!config || !Array.isArray(config.views) || config.views.length === 0) {
    throw new Error("Dashboard must contain at least one view");
  }
  const paths = config.views.map((view) => view.path);
  if (paths.some((path) => typeof path !== "string" || !path)) throw new Error("Every dashboard view needs a path");
  if (new Set(paths).size !== paths.length) throw new Error("Dashboard view paths must be unique");

  const liveIds = new Set(liveStates.map((state) => state.entity_id));
  const references = collectEntityReferences(config);
  const missing = [...references].filter((entityId) => !liveIds.has(entityId));
  if (missing.length) throw new Error(`Dashboard references missing live entities: ${missing.join(", ")}`);
  const controlled = [...references].filter((entityId) => CONTROL_DOMAINS.has(entityId.split(".", 1)[0]));
  if (controlled.length) throw new Error(`Read-only dashboard must not reference control entities: ${controlled.join(", ")}`);

  let cardCount = 0;
  function inspect(value) {
    if (Array.isArray(value)) {
      for (const child of value) inspect(child);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.type === "string") {
      cardCount += 1;
      if (value.type.startsWith("custom:") || !ALLOWED_TYPES.has(value.type)) {
        throw new Error(`Dashboard uses unsupported card or layout type: ${value.type}`);
      }
    }
    if (typeof value.action === "string" && WRITE_ACTIONS.has(value.action)) {
      throw new Error(`Read-only dashboard contains a mutating action: ${value.action}`);
    }
    for (const child of Object.values(value)) inspect(child);
  }
  inspect(config);
  return { references: [...references].sort(), cardCount, viewCount: config.views.length };
}

function metadataPayload(metadata) {
  return {
    title: metadata.title,
    icon: metadata.icon,
    show_in_sidebar: metadata.showInSidebar,
    require_admin: metadata.requireAdmin,
  };
}

function metadataMatches(current, desired) {
  const payload = metadataPayload(desired);
  return METADATA_FIELDS.every((field) => (current?.[field] ?? null) === (payload[field] ?? null));
}

export function planDashboard({ existing, existingConfig, candidate, metadata }) {
  if (existing && existing.mode !== "storage") {
    throw new Error(`Dashboard ${metadata.urlPath} exists in ${existing.mode} mode; refusing to replace it`);
  }
  if (!existing) return { action: "create", configChanged: true, metadataChanged: true };
  const configChanged = stableString(existingConfig) !== stableString(candidate);
  const metadataChanged = !metadataMatches(existing, metadata);
  return {
    action: configChanged || metadataChanged ? "update" : "unchanged",
    configChanged,
    metadataChanged,
  };
}

export function createBackup({ baseUrl, haVersion, metadata, existing, existingConfig, candidate }) {
  const directory = mkdtempSync(join(tmpdir(), "eg4-ha-dashboard-"));
  const path = join(directory, "backup.json");
  const backup = {
    schema: "eg4-ha-dashboard-backup/1",
    created_at: new Date().toISOString(),
    home_assistant: { base_url: baseUrl, version: haVersion },
    dashboard_path: metadata.urlPath,
    prior: existing ? { metadata: existing, config: existingConfig, checksum: checksum(existingConfig) } : null,
    deployed: {
      metadata: metadataPayload(metadata),
      config: candidate,
      checksum: checksum(candidate),
    },
  };
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(backup, null, 2)}\n`, { encoding: "utf8" });
  } finally {
    closeSync(descriptor);
  }
  return { path, backup };
}

async function restorePrior(ws, { createdId, existing, existingConfig }) {
  if (!existing) {
    if (createdId) await ws.call({ type: "lovelace/dashboards/delete", dashboard_id: createdId });
    return;
  }
  await ws.call({ type: "lovelace/config/save", url_path: existing.url_path, config: existingConfig });
  await ws.call({
    type: "lovelace/dashboards/update",
    dashboard_id: existing.id,
    title: existing.title,
    icon: existing.icon ?? null,
    show_in_sidebar: existing.show_in_sidebar,
    require_admin: existing.require_admin,
  });
}

export async function applyDashboard({ ws, existing, existingConfig, candidate, metadata }) {
  const plan = planDashboard({ existing, existingConfig, candidate, metadata });
  if (plan.action === "unchanged") return { ...plan, dashboardId: existing.id };
  let createdId = null;
  try {
    if (!existing) {
      const created = await ws.call({
        type: "lovelace/dashboards/create",
        url_path: metadata.urlPath,
        mode: "storage",
        ...metadataPayload(metadata),
      });
      createdId = created.id;
      await ws.call({ type: "lovelace/config/save", url_path: metadata.urlPath, config: candidate });
      return { ...plan, dashboardId: createdId };
    }
    if (plan.configChanged) {
      await ws.call({ type: "lovelace/config/save", url_path: metadata.urlPath, config: candidate });
    }
    if (plan.metadataChanged) {
      await ws.call({
        type: "lovelace/dashboards/update",
        dashboard_id: existing.id,
        ...metadataPayload(metadata),
      });
    }
    return { ...plan, dashboardId: existing.id };
  } catch (error) {
    try {
      await restorePrior(ws, { createdId, existing, existingConfig });
    } catch (rollbackError) {
      throw new Error(`${error.message}; automatic rollback also failed: ${rollbackError.message}`, { cause: error });
    }
    throw new Error(`${error.message}; automatic rollback completed`, { cause: error });
  }
}

export async function verifyDashboard({ ws, metadata, candidate }) {
  const dashboards = await ws.call({ type: "lovelace/dashboards/list" });
  const current = dashboards.find((dashboard) => dashboard.url_path === metadata.urlPath);
  if (!current || current.mode !== "storage") throw new Error("Dashboard was not registered in storage mode after deployment");
  if (!metadataMatches(current, metadata)) throw new Error("Dashboard metadata did not round-trip exactly");
  const currentConfig = await ws.call({ type: "lovelace/config", url_path: metadata.urlPath, force: true });
  if (stableString(currentConfig) !== stableString(candidate)) throw new Error("Dashboard configuration did not round-trip exactly");
  return { dashboard: current, config: currentConfig };
}

export function loadBackup(path) {
  const backup = JSON.parse(readFileSync(path, "utf8"));
  if (backup.schema !== "eg4-ha-dashboard-backup/1" || !backup.dashboard_path || !backup.deployed?.config) {
    throw new Error("Backup is not an EG4 dashboard backup/1 document");
  }
  if (checksum(backup.deployed.config) !== backup.deployed.checksum) throw new Error("Backup deployed config checksum does not match");
  if (backup.prior && checksum(backup.prior.config) !== backup.prior.checksum) throw new Error("Backup prior config checksum does not match");
  return backup;
}

export async function restoreBackup({ ws, backup, force = false }) {
  const dashboards = await ws.call({ type: "lovelace/dashboards/list" });
  const current = dashboards.find((dashboard) => dashboard.url_path === backup.dashboard_path);
  let currentConfig = null;
  if (current?.mode === "storage") {
    currentConfig = await ws.call({ type: "lovelace/config", url_path: backup.dashboard_path, force: true });
  }
  const deployedMatches = current
    && current.mode === "storage"
    && checksum(currentConfig) === backup.deployed.checksum
    && METADATA_FIELDS.every((field) => (current[field] ?? null) === (backup.deployed.metadata[field] ?? null));
  const priorMatches = backup.prior
    && current
    && current.mode === "storage"
    && checksum(currentConfig) === backup.prior.checksum;
  if (priorMatches) return { action: "already-restored" };
  if (!deployedMatches && !force) {
    throw new Error("Current dashboard has drifted since this backup; refusing to overwrite it without --force-restore");
  }
  if (!backup.prior) {
    if (!current) return { action: "already-restored" };
    if (current.mode !== "storage") throw new Error("Current same-path dashboard is not storage mode; refusing to delete it");
    await ws.call({ type: "lovelace/dashboards/delete", dashboard_id: current.id });
    return { action: "deleted-created-dashboard" };
  }
  if (!current || current.mode !== "storage") throw new Error("Cannot restore prior dashboard because the storage dashboard is missing");
  await ws.call({ type: "lovelace/config/save", url_path: backup.dashboard_path, config: backup.prior.config });
  const prior = backup.prior.metadata;
  await ws.call({
    type: "lovelace/dashboards/update",
    dashboard_id: current.id,
    title: prior.title,
    icon: prior.icon ?? null,
    show_in_sidebar: prior.show_in_sidebar,
    require_admin: prior.require_admin,
  });
  return { action: "restored-prior-dashboard" };
}

export function verifyEnergyPreferences(preferences, entities) {
  const sources = preferences?.energy_sources ?? [];
  const required = new Map([
    ["grid", [entities.gridImportLifetime, entities.gridExportLifetime]],
    ["solar", [entities.yieldLifetime]],
    ["battery", [entities.dischargingLifetime, entities.chargingLifetime]],
  ]);
  const errors = [];
  for (const [type, expected] of required) {
    const source = sources.find((candidate) => candidate.type === type);
    if (!source) {
      errors.push(`missing ${type} source`);
      continue;
    }
    const configured = new Set([source.stat_energy_from, source.stat_energy_to].filter(Boolean));
    for (const entityId of expected) {
      if (!configured.has(entityId)) errors.push(`${type} source does not reference ${entityId}`);
    }
  }
  if (errors.length) throw new Error(`Home Assistant Energy configuration is not bound to the selected EG4: ${errors.join("; ")}`);
  return { sourceTypes: [...required.keys()] };
}

