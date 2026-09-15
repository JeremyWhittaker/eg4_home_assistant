// Every EG4 entity is resolved from the Home Assistant device relationship plus the
// integration's own semantic original name. No serial number, station address, or
// entity id literal appears in this repository, so the same contract resolves on any
// EG4 Web Monitor installation.
//
// A specification is [domain, originalName] or [domain, originalName, options].
// Options carry two things:
//   index/of  the integration publishes several identically named entities on one
//             device (five of the mode switches are published twice). Those are
//             pinned by sorted entity id so a given key always means the same
//             register across restarts.
//   group     a layout hint used only by the Configuration view, which groups the
//             configuration entities by what they govern. Telemetry cards are laid out
//             by hand, so telemetry specs carry none.

const ENTITY_ID_PATTERN = /^[a-z_]+\.[a-z0-9_]+$/;

// Domains whose entities only ever report. Anything outside this set can actuate the
// inverter, so the dashboard may show its value but never in a card shape that could
// send it a command; see configurationTile in src/dashboard.mjs.
export const REPORTING_DOMAINS = Object.freeze(new Set(["sensor", "binary_sensor", "update"]));

const INVERTER_ENTITIES = Object.freeze({
  // Solar strings. The 18KPV reports power, voltage, and current per MPPT input.
  pvPower: ["sensor", "PV Total Power"],
  pv1Power: ["sensor", "PV1 Power"],
  pv2Power: ["sensor", "PV2 Power"],
  pv3Power: ["sensor", "PV3 Power"],
  pv1Voltage: ["sensor", "PV1 Voltage"],
  pv2Voltage: ["sensor", "PV2 Voltage"],
  pv3Voltage: ["sensor", "PV3 Voltage"],
  pv1Current: ["sensor", "PV1 Current"],
  pv2Current: ["sensor", "PV2 Current"],
  pv3Current: ["sensor", "PV3 Current"],
  yieldToday: ["sensor", "Yield"],
  yieldLifetime: ["sensor", "Yield (Lifetime)"],

  // Load and AC output. "Consumption Power" is derived from the inverter's own AC bus
  // and is not whole-property load; the dashboard labels it accordingly.
  loadPower: ["sensor", "Consumption Power"],
  consumptionToday: ["sensor", "Consumption"],
  consumptionLifetime: ["sensor", "Consumption (Lifetime)"],
  loadEnergyToday: ["sensor", "Load Energy"],
  loadEnergyLifetime: ["sensor", "Load Energy (Lifetime)"],
  totalLoadPower: ["sensor", "Total Load Power"],
  outputPower: ["sensor", "Output Power"],
  acPower: ["sensor", "AC Power"],
  acVoltage: ["sensor", "AC Voltage"],
  acCouplePower: ["sensor", "AC Couple Power"],

  // Conversion stage. Rectifier power and the two DC bus rails are internal to the
  // inverter, not grid measurements.
  rectifierPower: ["sensor", "Rectifier Power"],
  bus1Voltage: ["sensor", "Bus 1 Voltage"],
  bus2Voltage: ["sensor", "Bus 2 Voltage"],

  // Grid CT and grid quality.
  gridPower: ["sensor", "Grid Power"],
  gridImportPower: ["sensor", "Grid Import Power"],
  gridExportPower: ["sensor", "Grid Export Power"],
  gridImportToday: ["sensor", "Grid Import"],
  gridImportLifetime: ["sensor", "Grid Import (Lifetime)"],
  gridExportToday: ["sensor", "Grid Export"],
  gridExportLifetime: ["sensor", "Grid Export (Lifetime)"],
  gridVoltage: ["sensor", "Grid Voltage"],
  gridVoltageR: ["sensor", "Grid Voltage R"],
  gridVoltageS: ["sensor", "Grid Voltage S"],
  gridVoltageT: ["sensor", "Grid Voltage T"],
  gridFrequency: ["sensor", "Grid Frequency"],
  gridType: ["sensor", "Grid Type"],
  powerFactor: ["sensor", "Power Factor"],

  // Protected loads (EPS) and generator input.
  epsPower: ["sensor", "EPS Power"],
  epsPowerL1: ["sensor", "EPS Power L1"],
  epsPowerL2: ["sensor", "EPS Power L2"],
  epsVoltage: ["sensor", "EPS Voltage"],
  epsVoltageR: ["sensor", "EPS Voltage R"],
  epsVoltageS: ["sensor", "EPS Voltage S"],
  epsVoltageT: ["sensor", "EPS Voltage T"],
  epsFrequency: ["sensor", "EPS Frequency"],
  generatorPower: ["sensor", "Generator Power"],
  generatorVoltage: ["sensor", "Generator Voltage"],
  generatorFrequency: ["sensor", "Generator Frequency"],

  // The inverter's own view of the battery, measured at its DC terminals. These are
  // separate readings from the battery bank device's BMS-reported values.
  batteryPower: ["sensor", "Battery Power"],
  batteryVoltage: ["sensor", "Battery Voltage"],
  batteryStatus: ["sensor", "Battery Status"],
  inverterSoc: ["sensor", "State of Charge"],
  chargingToday: ["sensor", "Charging"],
  chargingLifetime: ["sensor", "Charging (Lifetime)"],
  dischargingToday: ["sensor", "Discharging"],
  dischargingLifetime: ["sensor", "Discharging (Lifetime)"],
  quickChargeRemaining: ["sensor", "Quick Charge Remaining"],

  // Thermal. All three are the inverter's own temperatures. Radiator 1 and radiator 2
  // are its two heatsinks, not one per battery module; no battery module publishes a
  // temperature over the cloud transport at all.
  internalTemperature: ["sensor", "Internal Temperature"],
  radiator1Temperature: ["sensor", "Radiator 1 Temperature"],
  radiator2Temperature: ["sensor", "Radiator 2 Temperature"],

  // Health, identity, and firmware.
  operatingState: ["sensor", "Operating State"],
  statusCode: ["sensor", "Status Code"],
  cloudStatus: ["sensor", "Cloud Status"],
  connectionLost: ["sensor", "Connection Lost"],
  transport: ["sensor", "Connection Transport"],
  runtimeData: ["sensor", "Has Runtime Data"],
  firmwareVersion: ["sensor", "Firmware Version"],
  inverterFamily: ["sensor", "Inverter Family"],
  deviceTypeCode: ["sensor", "Device Type Code"],
  powerRating: ["sensor", "Power Rating"],
  offGrid: ["binary_sensor", "Off-Grid"],
  dongleConnectivity: ["binary_sensor", "Dongle Connectivity"],
  firmwareUpdate: ["update", "Firmware"],

  // Configuration entities. The Configuration view shows each one's value on an inert
  // tile — no control feature, every interaction pinned — which is the only card shape
  // that can name a control domain without putting an actuator on a read-only page.
  batteryChargeCurrent: ["number", "Battery Charge Current", { group: "Battery limits" }],
  batteryDischargeCurrent: ["number", "Battery Discharge Current", { group: "Battery limits" }],
  onGridSocCutOff: ["number", "On-Grid SOC Cut-Off", { group: "Battery limits" }],
  offGridSocCutOff: ["number", "Off-Grid SOC Cut-Off", { group: "Battery limits" }],
  systemChargeSocLimit: ["number", "System Charge SOC Limit", { group: "Battery limits" }],
  startDischargePowerThreshold: ["number", "Start Discharge Power Threshold", { group: "Battery limits" }],

  acChargePower: ["number", "AC Charge Power", { group: "Charging" }],
  acChargeSocLimit: ["number", "AC Charge SOC Limit", { group: "Charging" }],
  pvChargePower: ["number", "PV Charge Power", { group: "Charging" }],
  pvStartVoltage: ["number", "PV Start Voltage", { group: "Charging" }],
  quickChargeDuration: ["number", "Quick Charge Duration", { group: "Charging" }],
  batteryChargeControl: ["select", "Battery Charge Control", { group: "Charging" }],
  acChargeMode: ["switch", "AC Charge Mode", { index: 0, of: 2, group: "Charging" }],
  acChargeModeSecondary: ["switch", "AC Charge Mode", { index: 1, of: 2, group: "Charging" }],
  pvChargePriorityMode: ["switch", "PV Charge Priority Mode", { index: 0, of: 2, group: "Charging" }],
  pvChargePriorityModeSecondary: ["switch", "PV Charge Priority Mode", { index: 1, of: 2, group: "Charging" }],
  quickChargeSwitch: ["switch", "Quick Charge", { group: "Charging" }],
  chargeLast: ["switch", "Charge Last", { group: "Charging" }],

  forcedDischargePower: ["number", "Forced Discharge Power", { group: "Discharge and export" }],
  forcedDischargeSocLimit: ["number", "Forced Discharge SOC Limit", { group: "Discharge and export" }],
  gridSellBackPower: ["number", "Grid Sell Back Power", { group: "Discharge and export" }],
  gridPeakShavingPower: ["number", "Grid Peak Shaving Power", { group: "Discharge and export" }],
  batteryDischargeControl: ["select", "Battery Discharge Control", { group: "Discharge and export" }],
  forcedDischargeMode: ["switch", "Forced Discharge Mode", { index: 0, of: 2, group: "Discharge and export" }],
  forcedDischargeModeSecondary: ["switch", "Forced Discharge Mode", { index: 1, of: 2, group: "Discharge and export" }],
  gridPeakShavingMode: ["switch", "Grid Peak Shaving Mode", { index: 0, of: 2, group: "Discharge and export" }],
  gridPeakShavingModeSecondary: ["switch", "Grid Peak Shaving Mode", { index: 1, of: 2, group: "Discharge and export" }],
  gridSellBack: ["switch", "Grid Sell Back", { group: "Discharge and export" }],
  exportPvOnly: ["switch", "Export PV Only", { group: "Discharge and export" }],
  fastZeroExport: ["switch", "Fast Zero Export", { group: "Discharge and export" }],

  batteryBackupMode: ["switch", "Battery Backup Mode", { index: 0, of: 2, group: "Backup and off-grid" }],
  batteryBackupModeSecondary: ["switch", "Battery Backup Mode", { index: 1, of: 2, group: "Backup and off-grid" }],
  epsBatteryBackup: ["switch", "EPS Battery Backup", { group: "Backup and off-grid" }],
  offGridMode: ["switch", "Off Grid Mode", { group: "Backup and off-grid" }],

  operatingMode: ["select", "Operating Mode", { group: "Operating mode" }],
  pvInputMode: ["select", "PV Input Mode", { group: "Operating mode" }],

  refreshData: ["button", "Refresh Data", { group: "Actions" }],
});

// The integration models Jeremy's two modules as one aggregate bank. Battery Count is
// the only per-module fact it publishes; there are no per-battery, per-cell, or
// battery temperature entities on the cloud transport.
const BATTERY_ENTITIES = Object.freeze({
  batteryBankSoc: ["sensor", "Battery Bank SOC"],
  batteryBankStatus: ["sensor", "Battery Bank Status"],
  batteryBankVoltage: ["sensor", "Battery Bank Voltage"],
  batteryBankCurrent: ["sensor", "Battery Bank Current"],
  batteryBankPower: ["sensor", "Battery Bank Power"],
  batteryBankChargeRate: ["sensor", "Battery Bank Charge Rate"],
  batteryBankCapacityPercent: ["sensor", "Battery Bank Capacity Percent"],
  batteryBankMaxCapacity: ["sensor", "Battery Bank Max Capacity"],
  batteryBankFullCapacity: ["sensor", "Battery Bank Full Capacity"],
  batteryBankRemainingCapacity: ["sensor", "Battery Bank Remaining Capacity"],
  batteryBankCurrentCapacity: ["sensor", "Battery Bank Current Capacity"],
  batteryCount: ["sensor", "Battery Count"],
  bmsChargeAllowed: ["sensor", "BMS Charge Allowed"],
  bmsDischargeAllowed: ["sensor", "BMS Discharge Allowed"],
  bmsForceChargeRequest: ["sensor", "BMS Force Charge Request"],
});

const STATION_ENTITIES = Object.freeze({
  stationName: ["sensor", "Station Name"],
  stationAddress: ["sensor", "Address"],
  stationTimezone: ["sensor", "Timezone"],
  stationCountry: ["sensor", "Country"],
  stationCreated: ["sensor", "Created"],
  apiRequestRate: ["sensor", "API Request Rate"],
  apiPeakRequestRate: ["sensor", "API Peak Request Rate"],
  apiRequestsToday: ["sensor", "API Requests Today"],
  daylightSavingTime: ["switch", "Daylight Saving Time", { group: "Station" }],
  stationRefreshData: ["button", "Refresh Data", { group: "Actions" }],
});

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isEg4Device(device) {
  return normalize(device.manufacturer) === "eg4 electronics" && device.disabled_by == null;
}

function isStation(device) {
  return isEg4Device(device) && normalize(device.model) === "station";
}

function isInverter(device) {
  const model = normalize(device.model);
  return isEg4Device(device) && model !== "station" && !model.includes("battery bank");
}

function stateIds(states) {
  return new Set(states.map((state) => state.entity_id));
}

function hasIntegrationEntity(entities, deviceId) {
  return entities.some((entity) => entity.device_id === deviceId && entity.platform === "eg4_web_monitor");
}

// Resolution never throws for an individual entity. With 137 entities in the contract
// the chance that the integration renames or drops one is real, and a hard failure
// would take the whole page down instead of reporting the single gap. Every failure is
// returned as a reason so the dashboard can show it. Reasons never contain an entity
// id, because an id that is absent from live state would fail the deployer's own
// reference check when rendered into a card.
function resolveEntity(registry, liveStateIds, deviceId, spec) {
  const [domain, originalName, options = {}] = spec;
  const expected = options.of ?? 1;
  const index = options.index ?? 0;
  const matches = registry
    .filter((entity) =>
      entity.device_id === deviceId
      && entity.disabled_by == null
      && entity.entity_id?.startsWith(`${domain}.`)
      && normalize(entity.original_name) === normalize(originalName)
    )
    .map((entity) => entity.entity_id)
    .sort();

  if (matches.length !== expected) {
    return {
      reason: expected === 1
        ? `expected one enabled entity on this device, found ${matches.length}`
        : `expected ${expected} identically named enabled entities on this device, found ${matches.length}`,
    };
  }
  const entityId = matches[index];
  if (!ENTITY_ID_PATTERN.test(entityId)) {
    return { reason: "the discovered entity id is not a valid Home Assistant id" };
  }
  if (!liveStateIds.has(entityId)) {
    return { reason: "the entity is registered but absent from live state" };
  }
  return { entityId };
}

function resolveMap(specification, registry, liveStateIds, device, deviceLabel) {
  const entities = {};
  const catalog = {};
  const unresolved = [];
  for (const [key, spec] of Object.entries(specification)) {
    const [domain, originalName, options = {}] = spec;
    const record = {
      key,
      domain,
      originalName,
      device: deviceLabel,
      group: options.group ?? null,
      // Where the integration publishes several identically named entities, these say
      // which one this key means, so a listing of names is not ambiguous.
      instance: options.of ? (options.index ?? 0) + 1 : null,
      instances: options.of ?? null,
      reporting: REPORTING_DOMAINS.has(domain),
    };
    const outcome = device
      ? resolveEntity(registry, liveStateIds, device.id, spec)
      : { reason: `the ${deviceLabel} device was not found in the Home Assistant device registry` };
    if (outcome.entityId) {
      entities[key] = outcome.entityId;
      catalog[key] = Object.freeze({ ...record, entityId: outcome.entityId });
    } else {
      catalog[key] = Object.freeze({ ...record, entityId: null, reason: outcome.reason });
      unresolved.push(Object.freeze({ ...record, reason: outcome.reason }));
    }
  }
  return { entities, catalog, unresolved };
}

// A device is selected only when exactly one candidate matches. Ambiguity is never
// guessed at: for the inverter it is fatal, because the wrong inverter would silently
// produce a plausible but wrong page. For the battery bank and the station it is
// reported through the unresolved list so the rest of the page still builds.
function selectSingle(candidates) {
  return candidates.length === 1 ? candidates[0] : null;
}

export function discoverEg4({ devices, entities, states, selector = "" }) {
  if (!Array.isArray(devices) || !Array.isArray(entities) || !Array.isArray(states)) {
    throw new TypeError("devices, entities, and states must be arrays");
  }

  const candidates = devices.filter((device) => {
    if (!isInverter(device)) return false;
    if (!hasIntegrationEntity(entities, device.id)) return false;
    if (!selector) return true;
    return [device.id, device.name, device.name_by_user]
      .filter(Boolean)
      .some((value) => normalize(value) === normalize(selector));
  });

  if (candidates.length !== 1) {
    const hint = selector
      ? `selector ${JSON.stringify(selector)}`
      : "set EG4_INVERTER_DEVICE_ID to the intended Home Assistant device id";
    throw new Error(`Expected exactly one enabled EG4 inverter (${hint}); found ${candidates.length}`);
  }
  const inverter = candidates[0];

  const battery = selectSingle(devices.filter((device) =>
    isEg4Device(device)
    && normalize(device.model).includes("battery bank")
    && device.via_device_id === inverter.id
  ));

  // The station device carries the plant metadata and the API budget counters. It is
  // linked to the inverter where the integration sets via_device; otherwise a single
  // unambiguous station device is accepted.
  const stationCandidates = devices.filter((device) => isStation(device) && hasIntegrationEntity(entities, device.id));
  const station = stationCandidates.find((device) => device.id === inverter.via_device_id)
    ?? selectSingle(stationCandidates)
    ?? null;

  const liveStateIds = stateIds(states);
  const resolved = [
    resolveMap(INVERTER_ENTITIES, entities, liveStateIds, inverter, "inverter"),
    resolveMap(BATTERY_ENTITIES, entities, liveStateIds, battery, "battery bank"),
    resolveMap(STATION_ENTITIES, entities, liveStateIds, station, "station"),
  ];

  const entityMap = Object.assign({}, ...resolved.map((part) => part.entities));
  const catalog = Object.assign({}, ...resolved.map((part) => part.catalog));
  const unresolved = resolved.flatMap((part) => part.unresolved);

  return {
    inverter: {
      deviceId: inverter.id,
      model: inverter.model || "EG4 inverter",
      firmware: inverter.sw_version || null,
      areaId: inverter.area_id || null,
    },
    battery: battery
      ? { deviceId: battery.id, model: battery.model || "EG4 battery bank", areaId: battery.area_id || null }
      : null,
    station: station
      ? { deviceId: station.id, model: station.model || "EG4 station", areaId: station.area_id || null }
      : null,
    entities: Object.freeze(entityMap),
    catalog: Object.freeze(catalog),
    unresolved: Object.freeze(unresolved),
  };
}

export const discoveryContract = Object.freeze({
  inverter: INVERTER_ENTITIES,
  battery: BATTERY_ENTITIES,
  station: STATION_ENTITIES,
});
