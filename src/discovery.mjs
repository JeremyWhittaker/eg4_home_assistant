const ENTITY_ID_PATTERN = /^[a-z_]+\.[a-z0-9_]+$/;

const INVERTER_ENTITIES = Object.freeze({
  offGrid: ["binary_sensor", "Off-Grid"],
  pvPower: ["sensor", "PV Total Power"],
  loadPower: ["sensor", "Consumption Power"],
  gridImportPower: ["sensor", "Grid Import Power"],
  gridExportPower: ["sensor", "Grid Export Power"],
  gridPower: ["sensor", "Grid Power"],
  batteryPower: ["sensor", "Battery Power"],
  inverterSoc: ["sensor", "State of Charge"],
  batteryStatus: ["sensor", "Battery Status"],
  batteryVoltage: ["sensor", "Battery Voltage"],
  operatingState: ["sensor", "Operating State"],
  cloudStatus: ["sensor", "Cloud Status"],
  connectionLost: ["sensor", "Connection Lost"],
  runtimeData: ["sensor", "Has Runtime Data"],
  transport: ["sensor", "Connection Transport"],
  yieldToday: ["sensor", "Yield"],
  yieldLifetime: ["sensor", "Yield (Lifetime)"],
  consumptionToday: ["sensor", "Consumption"],
  consumptionLifetime: ["sensor", "Consumption (Lifetime)"],
  gridImportToday: ["sensor", "Grid Import"],
  gridImportLifetime: ["sensor", "Grid Import (Lifetime)"],
  gridExportToday: ["sensor", "Grid Export"],
  gridExportLifetime: ["sensor", "Grid Export (Lifetime)"],
  chargingToday: ["sensor", "Charging"],
  chargingLifetime: ["sensor", "Charging (Lifetime)"],
  dischargingToday: ["sensor", "Discharging"],
  dischargingLifetime: ["sensor", "Discharging (Lifetime)"],
  pv1Power: ["sensor", "PV1 Power"],
  pv2Power: ["sensor", "PV2 Power"],
  pv3Power: ["sensor", "PV3 Power"],
  pv1Voltage: ["sensor", "PV1 Voltage"],
  pv2Voltage: ["sensor", "PV2 Voltage"],
  pv3Voltage: ["sensor", "PV3 Voltage"],
  pv1Current: ["sensor", "PV1 Current"],
  pv2Current: ["sensor", "PV2 Current"],
  pv3Current: ["sensor", "PV3 Current"],
  gridVoltage: ["sensor", "Grid Voltage"],
  gridFrequency: ["sensor", "Grid Frequency"],
  acPower: ["sensor", "AC Power"],
  acVoltage: ["sensor", "AC Voltage"],
  outputPower: ["sensor", "Output Power"],
  totalLoadPower: ["sensor", "Total Load Power"],
  epsPower: ["sensor", "EPS Power"],
  generatorPower: ["sensor", "Generator Power"],
  internalTemperature: ["sensor", "Internal Temperature"],
  radiator1Temperature: ["sensor", "Radiator 1 Temperature"],
  radiator2Temperature: ["sensor", "Radiator 2 Temperature"],
  powerFactor: ["sensor", "Power Factor"],
  powerRating: ["sensor", "Power Rating"],
  firmwareVersion: ["sensor", "Firmware Version"],
  statusCode: ["sensor", "Status Code"],
});

const BATTERY_ENTITIES = Object.freeze({
  batteryBankSoc: ["sensor", "Battery Bank SOC"],
  batteryBankStatus: ["sensor", "Battery Bank Status"],
  batteryBankVoltage: ["sensor", "Battery Bank Voltage"],
  batteryBankCurrent: ["sensor", "Battery Bank Current"],
  batteryBankPower: ["sensor", "Battery Bank Power"],
  batteryCount: ["sensor", "Battery Count"],
  batteryCapacity: ["sensor", "Battery Bank Current Capacity"],
  batteryFullCapacity: ["sensor", "Battery Bank Full Capacity"],
  batteryRemainingCapacity: ["sensor", "Battery Bank Remaining Capacity"],
  batteryChargeRate: ["sensor", "Battery Bank Charge Rate"],
  bmsChargeAllowed: ["sensor", "BMS Charge Allowed"],
  bmsDischargeAllowed: ["sensor", "BMS Discharge Allowed"],
  bmsForceChargeRequest: ["sensor", "BMS Force Charge Request"],
});

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isEg4Device(device) {
  return normalize(device.manufacturer) === "eg4 electronics" && device.disabled_by == null;
}

function isInverter(device) {
  const model = normalize(device.model);
  return isEg4Device(device) && model !== "station" && !model.includes("battery bank");
}

function stateIds(states) {
  return new Set(states.map((state) => state.entity_id));
}

function resolveEntity(registry, liveStateIds, deviceId, key, [domain, originalName]) {
  const matches = registry.filter((entity) =>
    entity.device_id === deviceId
    && entity.disabled_by == null
    && entity.entity_id?.startsWith(`${domain}.`)
    && normalize(entity.original_name) === normalize(originalName)
  );
  if (matches.length !== 1) {
    const detail = matches.map((entity) => entity.entity_id).join(", ") || "none";
    throw new Error(`Expected one enabled ${originalName} entity for ${key}; found ${matches.length}: ${detail}`);
  }
  const entityId = matches[0].entity_id;
  if (!ENTITY_ID_PATTERN.test(entityId)) {
    throw new Error(`Discovered invalid entity id for ${key}: ${entityId}`);
  }
  if (!liveStateIds.has(entityId)) {
    throw new Error(`Discovered ${key} is absent from live state: ${entityId}`);
  }
  return entityId;
}

function resolveMap(specification, registry, liveStateIds, deviceId) {
  return Object.fromEntries(
    Object.entries(specification).map(([key, spec]) => [
      key,
      resolveEntity(registry, liveStateIds, deviceId, key, spec),
    ]),
  );
}

export function discoverEg4({ devices, entities, states, selector = "" }) {
  if (!Array.isArray(devices) || !Array.isArray(entities) || !Array.isArray(states)) {
    throw new TypeError("devices, entities, and states must be arrays");
  }

  const candidates = devices.filter((device) => {
    if (!isInverter(device)) return false;
    const hasIntegrationEntity = entities.some((entity) =>
      entity.device_id === device.id && entity.platform === "eg4_web_monitor"
    );
    if (!hasIntegrationEntity) return false;
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

  const batteryCandidates = devices.filter((device) =>
    isEg4Device(device)
    && normalize(device.model).includes("battery bank")
    && device.via_device_id === inverter.id
  );
  if (batteryCandidates.length !== 1) {
    throw new Error(`Expected one EG4 battery bank linked to the selected inverter; found ${batteryCandidates.length}`);
  }
  const battery = batteryCandidates[0];
  const liveStateIds = stateIds(states);
  const entityMap = {
    ...resolveMap(INVERTER_ENTITIES, entities, liveStateIds, inverter.id),
    ...resolveMap(BATTERY_ENTITIES, entities, liveStateIds, battery.id),
  };

  return {
    inverter: {
      deviceId: inverter.id,
      model: inverter.model || "EG4 inverter",
      firmware: inverter.sw_version || null,
      areaId: inverter.area_id || null,
    },
    battery: {
      deviceId: battery.id,
      model: battery.model || "EG4 battery bank",
      areaId: battery.area_id || null,
    },
    entities: Object.freeze(entityMap),
  };
}

export const discoveryContract = Object.freeze({
  inverter: INVERTER_ENTITIES,
  battery: BATTERY_ENTITIES,
});

